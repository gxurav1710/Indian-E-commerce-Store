import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

/**
 * Interface and implementations for WhatsApp Transport Adapter
 * Supports 'mock' (offline testing/demo) and 'baileys' (live production multi-device WebSockets)
 */

export class MockWhatsAppAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.status = 'DISCONNECTED';
    this.phoneNumber = null;
    this.qrCode = null;
    this.outboundMessages = [];
  }

  async initialize() {
    this.status = 'QR_READY';
    this.phoneNumber = null;
    const raw = `MOCK_PAIR_${Date.now()}`;
    let dataUrl = raw;
    try {
      const qrcode = await import('qrcode');
      dataUrl = await (qrcode.default || qrcode).toDataURL(raw, {
        width: 320,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' }
      });
    } catch {}
    this.qrCode = { raw, dataUrl };
    this.emit('qr', this.qrCode);
    this.emit('status', 'QR_READY');
    return true;
  }

  async waitForQrCode(timeoutMs = 4000) {
    if (this.qrCode && this.status === 'QR_READY') return this.qrCode;
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(this.qrCode), timeoutMs);
      this.once('qr', qr => {
        clearTimeout(timer);
        resolve(qr);
      });
    });
  }

  async disconnect(options = { cleanSession: true }) {
    this.status = 'DISCONNECTED';
    this.phoneNumber = null;
    this.qrCode = null;

    if (options?.cleanSession !== false) {
      try {
        const dirs = [
          path.resolve(rootDir, 'data/berry_auth'),
          path.resolve(rootDir, 'data/baileys_auth')
        ];
        for (const d of dirs) {
          if (fs.existsSync(d)) {
            fs.rmSync(d, { recursive: true, force: true });
            fs.mkdirSync(d, { recursive: true });
          }
        }
        const sFiles = [
          path.resolve(rootDir, 'data/whatsapp_session.json'),
          path.resolve(rootDir, 'data/berry_store.db'),
          path.resolve(rootDir, 'data/berry_store.db-wal'),
          path.resolve(rootDir, 'data/berry_store.db-shm')
        ];
        for (const sf of sFiles) {
          if (fs.existsSync(sf)) fs.rmSync(sf, { force: true });
        }
      } catch {}
    }

    this.emit('disconnected');
    this.emit('status', this.status);
    return true;
  }

  getStatus() {
    return this.status;
  }

  getQrCode() {
    return this.qrCode;
  }

  getClientInfo() {
    return {
      phoneNumber: this.phoneNumber,
      platform: 'mock-simulated-device'
    };
  }

  async sendMessage(to, text) {
    const record = {
      id: `WAM_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      to,
      text,
      timestamp: new Date().toISOString()
    };
    this.outboundMessages.push(record);
    this.emit('sent', record);

    console.log(`[MockWhatsApp] Delivered message to ${to}: "${text.slice(0, 80)}..."`);
    return { success: true, messageId: record.id };
  }

  /**
   * Simulates an incoming customer message to the bot
   */
  async simulateIncomingMessage(from, text) {
    const msg = {
      id: `INC_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      from,
      text,
      timestamp: Date.now()
    };
    this.emit('message', msg);
    return msg;
  }
}

export function extractMessageText(msg) {
  if (!msg || !msg.message) return null;
  const m = msg.message;
  if (m.conversation) return m.conversation.trim();
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text.trim();
  if (m.imageMessage?.caption) return m.imageMessage.caption.trim();
  if (m.videoMessage?.caption) return m.videoMessage.caption.trim();
  if (m.documentMessage?.caption) return m.documentMessage.caption.trim();
  if (m.buttonsResponseMessage?.selectedButtonId) return m.buttonsResponseMessage.selectedButtonId.trim();
  if (m.templateButtonReplyMessage?.selectedId) return m.templateButtonReplyMessage.selectedId.trim();
  return null;
}

export class NativeBaileysAdapter extends EventEmitter {
  constructor(sessionDataPath = './data/baileys_auth') {
    super();
    this.sessionDataPath = path.resolve(sessionDataPath);
    this.status = 'DISCONNECTED';
    this.qrCode = null;
    this.phoneNumber = null;
    this.processedMessageIds = new Set();
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.sock = null;

    if (!fs.existsSync(this.sessionDataPath)) {
      fs.mkdirSync(this.sessionDataPath, { recursive: true });
    }

    // Check for existing saved session info ONLY if creds.json actually exists
    const credsPath = path.join(this.sessionDataPath, 'creds.json');
    if (fs.existsSync(credsPath)) {
      const infoPath = path.join(this.sessionDataPath, 'session-info.json');
      if (fs.existsSync(infoPath)) {
        try {
          const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
          if (info.phoneNumber) this.phoneNumber = info.phoneNumber;
        } catch {}
      }
    } else {
      this.phoneNumber = null;
      this.status = 'DISCONNECTED';
    }
  }

  async initialize() {
    if (this.isConnecting) {
      return true;
    }
    this.isConnecting = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Gracefully clean up any previous socket instance
    if (this.sock) {
      try {
        this.sock.ev?.removeAllListeners();
        this.sock.end?.();
      } catch {}
      this.sock = null;
    }

    this.status = 'INITIALIZING';
    this.emit('status', this.status);

    try {
      // Dynamic import of baileys to allow zero-crash fallback if dependencies not yet installed
      const baileys = await import('@whiskeysockets/baileys');
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = baileys;
      let pino = null;
      try {
        const pinoMod = await import('pino');
        pino = pinoMod.default || pinoMod;
      } catch {}

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDataPath);

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        browser: Browsers?.appropriate ? Browsers.appropriate('Desktop') : ['VIENTA', 'Chrome', '128.0.6613.120'],
        logger: pino ? pino({ level: 'warn' }) : undefined,
        getMessage: async key => ({ conversation: 'VIENTA' })
      });
      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async update => {
        if (this.sock !== sock) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          this.status = 'QR_READY';
          console.log('\n=============================================================================');
          console.log('  📷 SCAN THIS QR CODE WITH WHATSAPP ON YOUR PHONE TO CONNECT');
          console.log('  (Open WhatsApp > Linked Devices > Link a Device > Point Camera)');
          console.log('=============================================================================');
          try {
            const qrcodeTerminal = await import('qrcode-terminal');
            (qrcodeTerminal.default || qrcodeTerminal).generate(qr, { small: true });
          } catch (qrErr) {
            console.log('[BaileysAdapter] QR Code available at: http://localhost:4002');
          }
          console.log('=============================================================================\n');
          this.emit('qr', qr);
          this.emit('status', this.status);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403;
          const shouldReconnect = !isLoggedOut;

          this.isConnecting = false;
          console.log(`[BaileysAdapter] 🔴 Connection closed. Code: ${statusCode}, shouldReconnect: ${shouldReconnect}`);

          if (isLoggedOut) {
            this.status = 'DISCONNECTED';
            this.phoneNumber = null;
            this.qrCode = null;
            try {
              fs.rmSync(this.sessionDataPath, { recursive: true, force: true });
              fs.mkdirSync(this.sessionDataPath, { recursive: true });
            } catch {}
            this.emit('disconnected');
            this.emit('status', this.status);
          } else {
            this.status = 'DISCONNECTED';
            this.emit('disconnected');

            if (shouldReconnect) {
              this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
              const delayMs = Math.min(this.reconnectAttempts * 1500, 10000);
              console.log(`[BaileysAdapter] 🔄 Scheduling auto-reconnect in ${delayMs}ms (attempt ${this.reconnectAttempts})...`);
              if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
              this.reconnectTimer = setTimeout(() => {
                this.initialize().catch(err => {
                  console.error('[BaileysAdapter] Error during auto-reconnect:', err.message);
                });
              }, delayMs);
            }
          }
        } else if (connection === 'open') {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.status = 'CONNECTED';
          this.qrCode = null; // ALWAYS clear QR code once connection is active!

          const rawId = sock.user?.id || sock.user?.lid || '';
          const detected = rawId ? (rawId.includes(':') ? rawId.split(':')[0] : rawId.split('@')[0]) : null;
          this.phoneNumber = detected ? `+${detected.replace(/\D/g, '')}` : (this.phoneNumber || process.env.WHATSAPP_BOT_PHONE || '+919876543211');

          // Persist session identity to avoid losing authenticated state across restarts
          try {
            const infoPath = path.join(this.sessionDataPath, 'session-info.json');
            fs.writeFileSync(infoPath, JSON.stringify({
              status: 'CONNECTED',
              phoneNumber: this.phoneNumber,
              pushname: sock.user?.name || 'WhatsApp User',
              platform: 'baileys-multi-device',
              updatedAt: new Date().toISOString()
            }, null, 2));

            const globalSessionPath = path.resolve('./data/whatsapp_session.json');
            fs.writeFileSync(globalSessionPath, JSON.stringify({
              status: 'CONNECTED',
              phoneNumber: this.phoneNumber,
              platform: 'official-whatsapp-web',
              updatedAt: new Date().toISOString()
            }, null, 2));
          } catch {}

          console.log(`[BaileysAdapter] 🟢 Connected and authenticated as ${this.phoneNumber}!`);
          this.emit('ready', { phoneNumber: this.phoneNumber, platform: 'baileys-multi-device' });
          this.emit('status', this.status);
        }
      });

      // Active Inbound Message Listener (messages.upsert)
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return;

        for (const msg of messages) {
          if (!msg || !msg.message) continue;

          // CRITICAL: Ignore any message sent by the bot itself!
          if (msg.key?.fromMe) {
            continue;
          }

          const text = extractMessageText(msg);
          if (!text) continue;

          // Ignore outgoing bot responses and templates to prevent loops
          if (text.includes('Authentication') || text.includes('verification code') || text.includes('secure link') || text.includes('WhatsApp Authentication')) {
            continue;
          }

          const msgId = msg.key.id || `${msg.key.remoteJid}_${msg.messageTimestamp}`;
          if (this.processedMessageIds.has(msgId)) continue;
          this.processedMessageIds.add(msgId);
          if (this.processedMessageIds.size > 500) {
            const first = this.processedMessageIds.values().next().value;
            if (first) this.processedMessageIds.delete(first);
          }

          const rawSenderJid = msg.key.participant || msg.key.remoteJid;
          if (!rawSenderJid || rawSenderJid.endsWith('@g.us') || rawSenderJid === 'status@broadcast') {
            continue;
          }

          const rawPhone = rawSenderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
          const senderPhone = rawPhone ? `+${rawPhone}` : rawSenderJid;

          console.log(`[BaileysWorker] 📩 Received incoming message from ${senderPhone}: "${text}"`);
          this.emit('message', {
            from: senderPhone,
            text: text.trim(),
            timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now(),
            messageId: msg.key.id
          });
        }
      });

      // Listen for message status receipts (ACK from WhatsApp servers & recipient phones)
      sock.ev.on('messages.update', updates => {
        for (const update of updates) {
          if (update.update?.status) {
            console.log(`[BaileysWorker] 📬 Message ACK update for ${update.key?.id} (to: ${update.key?.remoteJid}): status=${update.update.status}`);
          }
        }
      });

      this.isConnecting = false;
      return true;
    } catch (err) {
      console.warn('[BaileysAdapter] Baileys native socket failed or module not present. Initializing pairing QR:', err.message);
      this.isConnecting = false;
      this.status = 'QR_READY';
      this.phoneNumber = null;
      let dataUrl = null;
      try {
        const qrcode = await import('qrcode');
        dataUrl = await (qrcode.default || qrcode).toDataURL(`BAILEYS_PAIR_${Date.now()}`, { width: 320, margin: 2 });
      } catch {}
      this.qrCode = { raw: `BAILEYS_PAIR_${Date.now()}`, dataUrl };
      this.emit('qr', this.qrCode);
      this.emit('status', this.status);
      return false;
    }
  }

  async disconnect(options = { cleanSession: true }) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      try {
        this.sock.ev?.removeAllListeners();
        this.sock.end?.();
      } catch {}
      this.sock = null;
    }
    this.status = 'DISCONNECTED';
    this.qrCode = null;
    this.phoneNumber = null;
    this.isConnecting = false;

    if (options?.cleanSession !== false) {
      try {
        if (fs.existsSync(this.sessionDataPath)) {
          fs.rmSync(this.sessionDataPath, { recursive: true, force: true });
          fs.mkdirSync(this.sessionDataPath, { recursive: true });
        }
        const sFile = path.resolve(rootDir, 'data/whatsapp_session.json');
        if (fs.existsSync(sFile)) fs.rmSync(sFile, { force: true });
      } catch {}
    }

    this.emit('disconnected');
    this.emit('status', this.status);
    return true;
  }

  getStatus() {
    if (this.status === 'CONNECTED') return 'CONNECTED';
    if (this.qrCode) return 'QR_READY';
    return this.status;
  }
  getQrCode() { return this.status === 'CONNECTED' ? null : this.qrCode; }
  getClientInfo() {
    return {
      phoneNumber: this.phoneNumber,
      platform: 'baileys-multi-device'
    };
  }
  normalizePhoneJid(to) {
    if (!to) return null;
    if (to.includes('@')) return to;
    let clean = String(to).replace(/[^0-9]/g, '');
    if (clean.length === 10) clean = '91' + clean;
    else if (clean.length === 11 && clean.startsWith('0')) clean = '91' + clean.slice(1);
    return `${clean}@s.whatsapp.net`;
  }

  async sendMessage(to, text, meta = {}) {
    const jid = this.normalizePhoneJid(to);
    if (!jid) {
      return { success: false, error: 'Invalid recipient phone number' };
    }

    if (this.sock && this.status === 'CONNECTED') {
      try {
        const sendOpts = { getUrlInfo: () => Promise.resolve(undefined) };
        let sendResult = null;

        if (meta?.mediaUrl) {
          const urlClean = meta.mediaUrl.split('?')[0];
          const assetBasename = path.basename(urlClean);
          const ext = path.extname(assetBasename).toLowerCase();

          // Resolve buffer: Check local file on disk first, OR download via fetch into Buffer
          let mediaBuffer = null;
          const candidatePaths = [
            path.resolve(process.cwd(), 'data/broadcast_assets', assetBasename),
            path.resolve(rootDir, 'data/broadcast_assets', assetBasename)
          ];
          for (const cp of candidatePaths) {
            if (fs.existsSync(cp)) {
              try {
                mediaBuffer = fs.readFileSync(cp);
                break;
              } catch {}
            }
          }

          // If not found locally on disk, download into in-memory Buffer to guarantee native media attachment
          if (!mediaBuffer && meta.mediaUrl.startsWith('http')) {
            try {
              const fetchRes = await fetch(meta.mediaUrl, { signal: AbortSignal.timeout(15000) });
              if (fetchRes.ok) {
                mediaBuffer = Buffer.from(await fetchRes.arrayBuffer());
              }
            } catch (fetchErr) {
              console.warn(`[BaileysAdapter] Could not download mediaUrl buffer: ${fetchErr.message}`);
            }
          }

          const mediaPayload = mediaBuffer || { url: meta.mediaUrl };
          const isVideo = meta.mediaType === 'video' || ['.mp4', '.webm', '.mov', '.mkv'].includes(ext);
          const isDoc = meta.mediaType === 'document' || ['.pdf', '.doc', '.docx', '.csv', '.xlsx', '.txt'].includes(ext);
          const isAudio = meta.mediaType === 'audio' || ['.mp3', '.ogg', '.wav', '.m4a'].includes(ext);

          if (isDoc) {
            const mimeType = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
            sendResult = await this.sock.sendMessage(jid, {
              document: mediaPayload,
              mimetype: mimeType,
              fileName: assetBasename,
              caption: text
            }, sendOpts);
          } else if (isAudio) {
            sendResult = await this.sock.sendMessage(jid, {
              audio: mediaPayload,
              mimetype: 'audio/mp4',
              ptt: false
            }, sendOpts);
          } else if (isVideo) {
            sendResult = await this.sock.sendMessage(jid, {
              video: mediaPayload,
              caption: text
            }, sendOpts);
          } else {
            sendResult = await this.sock.sendMessage(jid, {
              image: mediaPayload,
              caption: text
            }, sendOpts);
          }
        } else {
          // Regular text message (OTP, lifecycle update, auth link, order status)
          sendResult = await this.sock.sendMessage(jid, { text }, sendOpts);
        }

        const msgId = sendResult?.key?.id;
        console.log(`[BaileysAdapter] 🟢 Message sent to ${jid} (ID: ${msgId}, status: ${sendResult?.status})`);
        return { success: true, delivered: true, messageId: msgId, transport: 'baileys_live' };
      } catch (err) {
        console.warn(`[BaileysAdapter] Live socket transmission error for ${to}:`, err.message);
        return { success: false, delivered: false, error: err.message };
      }
    }

    console.log(`[BaileysAdapter] (Device not yet paired - status: ${this.status}). Outbound message to ${to}: "${text.slice(0, 60)}..."`);
    return { success: true, delivered: false, status: this.status, note: 'Pair device via WhatsApp Console QR code to enable live transmission' };
  }
}

export function createWhatsAppAdapter(mode = 'mock', sessionPath = './data/baileys_auth') {
  if (mode === 'baileys') {
    return new NativeBaileysAdapter(sessionPath);
  }
  return new MockWhatsAppAdapter();
}
