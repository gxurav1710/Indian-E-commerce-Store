import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BerryAdapter } from './berry-adapter.js';
import { createWhatsAppAdapter } from './adapter.js';
import { PORTS, URLS } from '../../../packages/common/src/ports.js';
import { defaultLogger } from '../../../packages/common/src/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

export class WhatsAppWorkerServer {
  /**
   * @param {{ port?: number, adapterMode?: string, sessionPath?: string, authApiUrl?: string }} [options={}]
   */
  constructor(options = {}) {
    this.port = options.port || PORTS.WHATSAPP_WORKER || 4001;
    this.authApiUrl = options.authApiUrl || process.env.WHATSAPP_AUTH_INTERNAL_URL || `http://127.0.0.1:${PORTS.WHATSAPP_AUTH_API || 4000}`;
    this.workerSecret = process.env.WORKER_INTERNAL_SECRET || 'worker_secret_key_change_me_in_prod_abcde';
    this.logger = defaultLogger;

    const mode = options.adapterMode || process.env.WHATSAPP_ADAPTER || 'berry';
    const sessionPath = options.sessionPath || process.env.WHATSAPP_SESSION_PATH || path.resolve(rootDir, 'data/berry_auth');
    const databasePath = process.env.BERRY_SQLITE_PATH || path.resolve(rootDir, 'data/berry_store.db');

    if (mode === 'mock') {
      this.adapter = createWhatsAppAdapter('mock', sessionPath);
    } else {
      this.adapter = new BerryAdapter({
        sessionId: 'vienta_berry_session',
        sessionPath,
        databasePath,
        logger: this.logger
      });
    }

    this.setupAdapterEvents();
  }

  setupAdapterEvents() {
    this.adapter.on('ready', info => {
      this.logger.info(`[WhatsAppWorker] BerryProtocol CONNECTED as ${info.phoneNumber} (${info.platform})`, { category: 'whatsapp' });
      this.notifyAuthApiStatus('CONNECTED', info.phoneNumber);
    });

    this.adapter.on('qr', qr => {
      this.logger.info('[WhatsAppWorker] BerryProtocol QR Code generated for pairing', { category: 'whatsapp' });
      const qrPayload = typeof qr === 'object' ? (qr.dataUrl || qr.raw) : qr;
      this.notifyAuthApiStatus('QR_READY', null, qrPayload);
    });

    this.adapter.on('disconnected', () => {
      this.logger.warn('[WhatsAppWorker] BerryProtocol Adapter disconnected', { category: 'whatsapp' });
      this.notifyAuthApiStatus('DISCONNECTED');
    });

    // When an incoming message arrives, forward to Auth API webhook for challenge verification
    this.adapter.on('message', async msg => {
      try {
        await fetch(`${this.authApiUrl}/api/v1/internal/whatsapp/webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.workerSecret}`
          },
          body: JSON.stringify(msg)
        });
      } catch (err) {
        this.logger.error(`Failed to forward incoming WhatsApp message to Auth API: ${err.message}`);
      }
    });
  }

  async notifyAuthApiStatus(status, phoneNumber = null, qrCode = null) {
    try {
      await fetch(`${this.authApiUrl}/api/v1/internal/whatsapp/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.workerSecret}`
        },
        body: JSON.stringify({ status, phoneNumber, qrCode })
      });
    } catch {}
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const readJsonBody = () => new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try { resolve(body ? JSON.parse(body) : {}); }
          catch (e) { reject(e); }
        });
      });

      const jsonResponse = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      // 1. GET /health
      if (pathname === '/health' && method === 'GET') {
        jsonResponse(200, {
          status: 'healthy',
          service: 'whatsapp-worker',
          engine: 'BerryProtocol',
          adapter: this.adapter.getStatus(),
          timestamp: new Date().toISOString()
        });
        return;
      }

      // 2. GET /health/deep
      if (pathname === '/health/deep' && method === 'GET') {
        const status = this.adapter.getStatus();
        const clientInfo = this.adapter.getClientInfo();

        jsonResponse(200, {
          status: status === 'CONNECTED' || status === 'QR_READY' ? 'healthy' : 'degraded',
          service: 'whatsapp-worker',
          engine: 'BerryProtocol',
          adapterStatus: status,
          clientInfo,
          authApiUrl: this.authApiUrl,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // 3. POST /api/v1/messages/send or /internal/send (Used by Notification Service, Commerce API & Auth)
      if ((pathname === '/api/v1/messages/send' || pathname === '/internal/send') && method === 'POST') {
        const body = await readJsonBody();
        const { to, message, source, mediaUrl, mediaType, fileName, buttons } = body;

        if (!to || !message) {
          jsonResponse(400, { error: 'to and message are required' });
          return;
        }

        // Strict Guardrail: Never send real messages to test/dummy phone numbers or in test mode
        const cleanTo = String(to || '').replace(/[^0-9]/g, '');
        const dummyPrefixes = ['91987654321', '987654321', '91123456789', '123456789', '910000000000', '0000000000', '919999999999'];
        if (dummyPrefixes.some(prefix => cleanTo.startsWith(prefix)) || process.env.NODE_ENV === 'test' || process.env.WHATSAPP_MOCK_DISPATCH === 'true') {
          this.logger.info(`[WhatsAppWorker] Intercepted test/dummy recipient ${to}. Simulated success without live dispatch.`);
          jsonResponse(200, { success: true, delivered: true, simulated: true, mode: 'mock_test_safeguard' });
          return;
        }

        try {
          const result = await this.adapter.sendMessage(to, message, { mediaUrl, mediaType, fileName, buttons });
          jsonResponse(200, { success: true, ...result });
        } catch (err) {
          jsonResponse(200, { success: true, delivered: false, error: err.message, status: this.adapter.getStatus() });
        }
        return;
      }

      // 4. GET /api/v1/status or /internal/status
      if ((pathname === '/api/v1/status' || pathname === '/internal/status') && method === 'GET') {
        const qr = this.adapter.getQrCode();
        jsonResponse(200, {
          success: true,
          status: this.adapter.getStatus(),
          clientInfo: this.adapter.getClientInfo(),
          qrCode: qr?.dataUrl || qr?.raw || (typeof qr === 'string' ? qr : null),
          qrData: qr,
          adapterMode: 'berry',
          engine: 'BerryProtocol v0.1.10'
        });
        return;
      }

      // 5. GET /api/v1/qr or /internal/qr
      if ((pathname === '/api/v1/qr' || pathname === '/internal/qr') && method === 'GET') {
        const qr = this.adapter.getQrCode();
        jsonResponse(200, {
          success: true,
          qrCode: qr?.dataUrl || qr?.raw || (typeof qr === 'string' ? qr : null),
          dataUrl: qr?.dataUrl || null,
          raw: qr?.raw || (typeof qr === 'string' ? qr : null),
          available: !!qr,
          status: this.adapter.getStatus()
        });
        return;
      }

      // 5b. POST /api/v1/pairing/start or /internal/start-pairing or /internal/reconnect
      if ((pathname === '/api/v1/pairing/start' || pathname === '/internal/start-pairing' || pathname === '/internal/reconnect') && method === 'POST') {
        try {
          if (this.adapter.getStatus() !== 'QR_READY' || !this.adapter.getQrCode()) {
            await this.adapter.initialize();
          }
          let qr = null;
          if (typeof this.adapter.waitForQrCode === 'function') {
            qr = await this.adapter.waitForQrCode(4000);
          } else {
            qr = this.adapter.getQrCode();
          }
          const qrPayload = qr?.dataUrl || qr?.raw || (typeof qr === 'string' ? qr : null);
          jsonResponse(200, {
            success: true,
            status: this.adapter.getStatus(),
            qrCode: qrPayload,
            dataUrl: qr?.dataUrl || qrPayload,
            raw: qr?.raw || qrPayload
          });
        } catch (err) {
          jsonResponse(500, { success: false, error: err.message });
        }
        return;
      }

      // 5c. POST /api/v1/pairing/logout or /internal/logout - Disconnect Device & Clean Session
      if ((pathname === '/api/v1/pairing/logout' || pathname === '/internal/logout') && method === 'POST') {
        try {
          this.logger.info('[WhatsAppWorker] Disconnect requested: wiping session credentials and initiating new pairing QR code...', { category: 'whatsapp' });

          // 1. Wipe credentials and disconnect active socket
          if (typeof this.adapter.disconnect === 'function') {
            await this.adapter.disconnect({ cleanSession: true });
          }

          // 2. Immediately spin up fresh pairing loop for next QR code
          await this.adapter.initialize();

          // 3. Await fresh QR code
          let qr = null;
          if (typeof this.adapter.waitForQrCode === 'function') {
            qr = await this.adapter.waitForQrCode(4000);
          } else {
            qr = this.adapter.getQrCode();
          }

          const qrPayload = qr?.dataUrl || qr?.raw || (typeof qr === 'string' ? qr : null);
          const currentStatus = this.adapter.getStatus();

          // Notify internal Auth API
          this.notifyAuthApiStatus(currentStatus, null, qrPayload);

          jsonResponse(200, {
            success: true,
            status: currentStatus,
            qrCode: qrPayload,
            dataUrl: qr?.dataUrl || qrPayload,
            raw: qr?.raw || qrPayload,
            message: 'Session files successfully cleaned. New QR code ready for pairing.'
          });
        } catch (err) {
          this.logger.error(`[WhatsAppWorker] Logout/pairing reset error: ${err.message}`);
          jsonResponse(500, { success: false, error: err.message });
        }
        return;
      }

      // 6. POST /api/v1/simulate/message or /internal/simulate (Offline test/demo endpoint)
      if ((pathname === '/api/v1/simulate/message' || pathname === '/internal/simulate') && method === 'POST') {
        const body = await readJsonBody();
        const { from, text } = body;

        this.adapter.emit('message', {
          from: from || '+918796266491',
          text: text || 'AUTH-123456',
          timestamp: Date.now()
        });

        jsonResponse(200, { success: true, simulated: { from, text } });
        return;
      }

      jsonResponse(404, { error: 'Endpoint not found' });
    });
  }

  async start() {
    await this.adapter.initialize();
    const server = this.createServer();
    return new Promise((resolve, reject) => {
      server.listen(this.port, () => {
        console.log(`[WhatsAppWorker] BerryProtocol daemon running on http://localhost:${this.port}`);
        resolve(server);
      });
      server.on('error', reject);
    });
  }
}
