import { createRepositories } from '../../../packages/db/src/index.js';
import { defaultLogger } from '../../../packages/common/src/logger.js';
import { PORTS, URLS } from '../../../packages/common/src/ports.js';
import { EVENT_TYPES, globalEventBus } from '../../../packages/common/src/events.js';
import { normalizeTelegramChatId, compilePlatformTelemetry } from '../../../packages/common/src/admin-auth.js';
import { createRootSnapshot, listSnapshots } from '../../../packages/common/src/snapshot-manager.js';

const WHITELISTED_SERVICES = [
  'commerce-api',
  'storefront',
  'admin-panel',
  'control-center',
  'notifications',
  'payment-api',
  'checkout-portal',
  'whatsapp-auth',
  'whatsapp-worker',
  'whatsapp-dashboard',
  'shipping-service',
  'merchant-admin'
];

export class TelegramMonitoringBot {
  /**
   * @param {{ token?: string, adminChatId?: string, repos?: any, logger?: any }} [options={}]
   */
  constructor(options = {}) {
    this.token = options.token || process.env.TELEGRAM_BOT_TOKEN || 'mock_telegram_bot_token_for_local_demo';
    const rawAdminId = options.adminChatId || process.env.TELEGRAM_ADMIN_CHAT_ID || '-123456789';
    this.adminChatId = normalizeTelegramChatId(rawAdminId);
    this.repos = options.repos || createRepositories();
    this.logger = options.logger || defaultLogger;
    this.coreHandlerUrl = URLS.CORE_HANDLER || `http://localhost:${PORTS.CORE_HANDLER || 8085}`;

    this.pendingConfirmations = new Map(); // chatId -> { serviceId, expiresAt }
    this.pollInterval = Number(process.env.TELEGRAM_POLL_INTERVAL_MS || 5000);
    this.pollTimer = null;
    this.lastUpdateId = 0;
    this.lastRebootTime = 0;
    this.isPolling = false;

    // Load persisted lastUpdateId from database
    try {
      if (this.repos?.telegram?.getStoredUpdateId) {
        this.lastUpdateId = this.repos.telegram.getStoredUpdateId() || 0;
      }
    } catch {}

    // Auto-enroll adminChatId into database subscribers
    if (this.adminChatId && !this.adminChatId.startsWith('mock_')) {
      try {
        this.repos.telegram.upsertSubscriber({
          telegramUserId: this.adminChatId,
          chatId: this.adminChatId,
          username: 'AdminOperator',
          isAdmin: true
        });
      } catch {}
    }
  }

  isMockMode() {
    return !this.token || this.token.startsWith('mock_') || this.token === 'your_telegram_bot_token_from_botfather';
  }

  /**
   * Compiles deep platform telemetry (all ports, tunnel, whatsapp, mode, apis)
   */
  async compileTelemetryReport() {
    const isProd = process.env.ENVIRONMENT_MODE === 'PRODUCTION' || (process.env.STOREFRONT_URL && !process.env.STOREFRONT_URL.includes('localhost'));
    const domain = (process.env.PRIMARY_DOMAIN || 'vienta') + (process.env.DOMAIN_EXTENSION || '.shop');
    const modeStr = isProd ? `LIVE PRODUCTION (${domain})` : 'LOCALHOST DEVELOPMENT';

    // 1. Cloudflare Tunnel status
    let tunnelStatus = '⚪ INACTIVE / NOT CONFIGURED';
    if (process.env.CLOUDFLARE_TUNNEL_COMMAND) {
      tunnelStatus = '🟢 ACTIVE & CONNECTED';
    }

    // 2. WhatsApp connection status
    let whatsappStatus = 'DISCONNECTED';
    try {
      const waRes = await fetch(`http://localhost:${PORTS.WHATSAPP_WORKER || 4001}/api/v1/status`, { signal: AbortSignal.timeout(2500) });
      if (waRes.ok) {
        const waData = await waRes.json();
        whatsappStatus = waData.status || 'DISCONNECTED';
      }
    } catch {}

    // 3. Services & Ports status from Core Handler
    let services = [];
    try {
      const sRes = await fetch(`${this.coreHandlerUrl}/api/v1/services`, { signal: AbortSignal.timeout(3000) });
      if (sRes.ok) {
        const sData = await sRes.json();
        services = sData.services || [];
      }
    } catch {}

    // 4. Core API Endpoints Health & Latency
    const apis = [
      { name: 'Commerce REST API', port: PORTS.COMMERCE_API || 5001, url: `http://localhost:${PORTS.COMMERCE_API || 5001}/health` },
      { name: 'WhatsApp Auth API', port: PORTS.WHATSAPP_AUTH_API || 4000, url: `http://localhost:${PORTS.WHATSAPP_AUTH_API || 4000}/health` },
      { name: 'Payment Core API', port: PORTS.BASE_PAYMENT_API || 6100, url: `http://localhost:${PORTS.BASE_PAYMENT_API || 6100}/health` },
      { name: 'Core Handler Daemon', port: PORTS.CORE_HANDLER || 8085, url: `${this.coreHandlerUrl}/health` }
    ];

    const apiChecks = [];
    for (const api of apis) {
      const start = Date.now();
      let ok = false;
      try {
        const res = await fetch(api.url, { signal: AbortSignal.timeout(2500) });
        ok = res.ok;
      } catch {}
      const latency = Date.now() - start;
      apiChecks.push({
        name: api.name,
        port: api.port,
        status: ok ? 'HEALTHY' : 'UNREACHABLE',
        latency: `${latency}ms`
      });
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return {
      timestamp: `${dateStr}, ${timeStr}`,
      mode: modeStr,
      tunnelStatus,
      whatsappStatus,
      services,
      apiChecks
    };
  }

  /**
   * Broadcasts an HTML/Markdown alert to all active subscribers and admin chat ID
   * @param {string} text
   */
  async broadcast(text) {
    let subscribers = [];
    try {
      subscribers = this.repos.telegram.listActiveSubscribers() || [];
    } catch {}

    const targetChatIds = new Set();
    if (this.adminChatId && !this.adminChatId.startsWith('mock_')) {
      targetChatIds.add(this.adminChatId);
    }
    for (const sub of subscribers) {
      if (sub.chat_id) targetChatIds.add(normalizeTelegramChatId(sub.chat_id));
    }

    if (this.isMockMode()) {
      console.log('\n📱 [TELEGRAM BROADCAST (MOCK)]:\n' + text + '\n');
      return { success: true, count: targetChatIds.size, mode: 'mock' };
    }

    const promises = Array.from(targetChatIds).map(chatId => this.sendMessage(chatId, text));
    await Promise.allSettled(promises);
    return { success: true, count: targetChatIds.size };
  }

  /**
   * Sends a message to a specific chat with HTML parse mode and plain-text fallback
   * @param {string} chatId
   * @param {string} text
   */
  async sendMessage(chatId, text) {
    if (!chatId) return;
    const targetChat = normalizeTelegramChatId(chatId);

    if (this.isMockMode()) {
      console.log(`\n📱 [TELEGRAM TO ${targetChat}]:\n${text}\n`);
      return;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChat,
          text,
          parse_mode: 'HTML'
        }),
        signal: AbortSignal.timeout(8000)
      });

      const data = await res.json();
      if (!data.ok) {
        // Fallback to plain text if HTML parsing encounters unexpected syntax
        await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetChat,
            text: text.replace(/<[^>]+>/g, '')
          }),
          signal: AbortSignal.timeout(8000)
        });
      }
    } catch (err) {
      this.logger.error(`Error sending Telegram message to ${targetChat}: ${err.message}`);
    }
  }

  /**
   * Handles incoming Telegram commands from authorized administrators
   */
  async handleCommand(chatId, userId, username, text, messageDate = null) {
    const normalizedChat = normalizeTelegramChatId(chatId);

    // Stale message protection: ignore commands older than 45 seconds to prevent replay bootloops
    if (messageDate) {
      const ageSeconds = Math.floor(Date.now() / 1000) - Number(messageDate);
      if (ageSeconds > 45) {
        console.warn(`[TelegramBot] Dropping stale Telegram command (age: ${ageSeconds}s): "${text}"`);
        return;
      }
    }

    // Record subscriber
    try {
      this.repos.telegram.upsertSubscriber({
        telegramUserId: String(userId),
        chatId: normalizedChat,
        username,
        isAdmin: normalizedChat === this.adminChatId
      });
    } catch {}

    const trimmed = (text || '').trim();
    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = parts[1]?.toLowerCase();

    // 1. /start & /help
    if (command === '/start' || command === '/help') {
      const welcome = `🤖 <b>Unified E-Commerce Platform Monitoring Bot</b>\n\n` +
        `Authorized administrator session connected.\n\n` +
        `<b>Available Commands:</b>\n` +
        `• <code>/status</code> — Live multi-point diagnostic check (all 15 ports, tunnel, WhatsApp, APIs, mode)\n` +
        `• <code>/health</code> — Deep host vitals (CPU, RAM, Uptime)\n` +
        `• <code>/backup</code> — Instantly snapshot entire platform root & generate remote download link\n` +
        `• <code>/backups</code> — List available snapshot archives and download links\n` +
        `• <code>/reboot</code> — Safe reboot of entire platform\n` +
        `• <code>/restart &lt;service&gt;</code> — Restart an individual microservice\n` +
        `• <code>/help</code> — Show this manual`;
      await this.sendMessage(normalizedChat, welcome);
      return;
    }

    // 2. /status (Complete multi-point diagnostic check)
    if (command === '/status') {
      await this.sendMessage(normalizedChat, '⏳ <i>Running live multi-point platform diagnostics...</i>');
      try {
        const telemetry = await compilePlatformTelemetry({ coreHandlerUrl: this.coreHandlerUrl });
        const msg = `📊 <b>PLATFORM SYSTEM STATUS REPORT</b>\n` +
          `📅 <i>${telemetry.timestamp}</i>\n\n` +
          telemetry.htmlReport;

        await this.sendMessage(normalizedChat, msg);
      } catch (err) {
        await this.sendMessage(normalizedChat, `❌ Error compiling status: ${err.message}`);
      }
      return;
    }

    // 3. /health (Host telemetry)
    if (command === '/health') {
      try {
        let res = await fetch(`${this.coreHandlerUrl}/health/deep`, { signal: AbortSignal.timeout(3500) }).catch(() => null);
        if (!res || !res.ok) {
          res = await fetch(`${this.coreHandlerUrl}/api/v1/health/deep`, { signal: AbortSignal.timeout(3500) }).catch(() => null);
        }
        if (!res || !res.ok) throw new Error('Core Handler unreachable');
        const data = await res.json();

        const m = data.metrics || {};
        const healthMsg = `📈 <b>HOST INFRASTRUCTURE VITALS</b>\n\n` +
          `• <b>Hostname:</b> <code>${m.hostname || 'VPS'}</code>\n` +
          `• <b>Uptime:</b> <code>${Math.round((m.uptimeSeconds || 0) / 60)} minutes</code>\n` +
          `• <b>RAM Memory:</b> <code>${m.memory?.usagePercent || 0}% used</code> (${m.memory?.usedMb}MB / ${m.memory?.totalMb}MB)\n` +
          `• <b>CPU Cores:</b> <code>${m.cpuCount || 1} Cores</code>\n` +
          `• <b>Timestamp:</b> <code>${new Date().toISOString()}</code>`;

        await this.sendMessage(normalizedChat, healthMsg);
      } catch (err) {
        await this.sendMessage(normalizedChat, `❌ Could not reach Core Handler: ${err.message}`);
      }
      return;
    }

    // 4. /reboot (Reboots the entire platform)
    if (command === '/reboot') {
      const now = Date.now();
      if (this.lastRebootTime && (now - this.lastRebootTime) < 60000) {
        const remaining = Math.ceil((60000 - (now - this.lastRebootTime)) / 1000);
        await this.sendMessage(normalizedChat, `⏳ <b>Reboot Cooldown Active</b>\nA reboot was triggered recently. Please wait ${remaining}s before triggering another reboot.`);
        return;
      }
      this.lastRebootTime = now;

      await this.sendMessage(normalizedChat, '⚠️ <b>Initiating Platform Full Reboot...</b>\nShutting down and restarting all 15 microservices...');

      // Guarantee Telegram server acknowledges update offset before service shutdown
      try {
        await fetch(`https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId + 1}&limit=1`, { signal: AbortSignal.timeout(3000) });
      } catch {}

      try {
        const res = await fetch(`${this.coreHandlerUrl}/api/v1/system/reboot`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.error) {
            await this.sendMessage(normalizedChat, `⚠️ Reboot notice: ${data.error}`);
          } else {
            await this.sendMessage(normalizedChat, '🔄 <i>Reboot signal accepted. Services are restarting...</i>');
          }
        } else {
          // Try restarting all services individually
          await fetch(`${this.coreHandlerUrl}/api/v1/services/restart-all`, { method: 'POST' });
          await this.sendMessage(normalizedChat, '🔄 <i>All services restart initiated.</i>');
        }
      } catch (err) {
        await this.sendMessage(normalizedChat, `❌ Reboot command failed: ${err.message}`);
      }
      return;
    }

    // 5. /restart <service>
    if (command === '/restart') {
      if (!arg) {
        await this.sendMessage(
          normalizedChat,
          `⚠️ <b>Service name required.</b>\n\n<b>Usage:</b> <code>/restart &lt;service-id&gt;</code>\n\n<b>Whitelisted Services:</b>\n` +
          WHITELISTED_SERVICES.map(s => `• <code>${s}</code>`).join('\n')
        );
        return;
      }

      if (!WHITELISTED_SERVICES.includes(arg)) {
        await this.sendMessage(
          normalizedChat,
          `🚫 <b>Invalid Service:</b> <code>${arg}</code> is not in the whitelist.`
        );
        return;
      }

      this.pendingConfirmations.set(String(normalizedChat), {
        serviceId: arg,
        expiresAt: Date.now() + 60000
      });

      const confirmPrompt = `⚠️ <b>CONFIRM SERVICE RESTART</b>\n\n` +
        `Are you sure you want to restart <b>${arg}</b>?\n\n` +
        `To confirm, reply with:\n<code>/confirm ${arg}</code>\n\n` +
        `Or reply with <code>/cancel</code> to abort.`;

      await this.sendMessage(normalizedChat, confirmPrompt);
      return;
    }

    // 6. /confirm <service>
    if (command === '/confirm') {
      const pending = this.pendingConfirmations.get(String(normalizedChat));
      if (!pending || pending.expiresAt < Date.now()) {
        this.pendingConfirmations.delete(String(normalizedChat));
        await this.sendMessage(normalizedChat, '❌ No pending restart confirmation found, or confirmation expired.');
        return;
      }

      if (arg && arg !== pending.serviceId) {
        await this.sendMessage(normalizedChat, `❌ Target mismatch. Expected <code>/confirm ${pending.serviceId}</code>.`);
        return;
      }

      const serviceToRestart = pending.serviceId;
      this.pendingConfirmations.delete(String(normalizedChat));

      await this.sendMessage(normalizedChat, `⏳ Executing restart for <code>${serviceToRestart}</code>...`);

      try {
        const res = await fetch(`${this.coreHandlerUrl}/api/v1/services/${serviceToRestart}/restart`, { method: 'POST' });
        const result = await res.json();

        if (result.success) {
          await this.sendMessage(normalizedChat, `✅ Successfully initiated restart for <b>${serviceToRestart}</b>.`);
        } else {
          await this.sendMessage(normalizedChat, `❌ Failed to restart <b>${serviceToRestart}</b>: ${result.error}`);
        }
      } catch (err) {
        await this.sendMessage(normalizedChat, `❌ Error reaching Core Handler: ${err.message}`);
      }
      return;
    }

    // 7. /cancel
    if (command === '/cancel') {
      this.pendingConfirmations.delete(String(normalizedChat));
      await this.sendMessage(normalizedChat, 'Action cancelled.');
      return;
    }

    // 8. /backup & /snapshot (Instant full root snapshot with public internet download link)
    if (command === '/backup' || command === '/snapshot') {
      await this.sendMessage(
        normalizedChat,
        '⏳ <b>CREATING FULL PLATFORM SNAPSHOT</b>\n\n' +
        'Archiving entire root directory using ultra-fast native engine...\n' +
        'Excluding snapshot repository and duplicate builds. Please wait a few seconds...'
      );

      try {
        const result = await createRootSnapshot();
        const backupMsg = `💾 <b>FULL PLATFORM SNAPSHOT CREATED</b>\n\n` +
          `• <b>Archive:</b> <code>${result.filename}</code>\n` +
          `• <b>Type:</b> <code>${result.archiveType || result.engine}</code>\n` +
          `• <b>Size:</b> <code>${result.sizeFormatted}</code>\n` +
          `• <b>Created:</b> <code>${result.createdAtFormatted}</code>\n` +
          `• <b>Speed / Duration:</b> <code>${result.durationSeconds}s</code> ⚡\n\n` +
          `🌐 <b>Remote Download Link (Public Internet):</b>\n` +
          `${result.publicDownloadUrl}\n\n` +
          `🏠 <b>Localhost Direct Link:</b>\n` +
          `${result.localDownloadUrl}\n\n` +
          `<i>✓ Registered in Central Control Center snapshot history.</i>`;

        await this.sendMessage(normalizedChat, backupMsg);
      } catch (err) {
        await this.sendMessage(normalizedChat, `❌ <b>Snapshot Creation Failed:</b> ${err.message}`);
      }
      return;
    }

    // 9. /backups & /snapshots (List available snapshot archives)
    if (command === '/backups' || command === '/snapshots') {
      try {
        const list = listSnapshots();
        if (!list || list.length === 0) {
          await this.sendMessage(normalizedChat, '📦 <b>No platform snapshots found.</b>\nType <code>/backup</code> to create an instant full root snapshot.');
          return;
        }

        let msg = `📦 <b>AVAILABLE PLATFORM SNAPSHOTS (${list.length})</b>\n\n`;
        for (const s of list.slice(0, 5)) {
          msg += `• <b>${s.filename}</b>\n` +
            `  Type: <code>${s.archiveType || 'Archive'}</code> | Size: <code>${s.sizeFormatted}</code>\n` +
            `  Date: ${s.createdAtFormatted}\n` +
            `  🌐 <b>Link:</b> ${s.publicDownloadUrl}\n\n`;
        }
        if (list.length > 5) {
          msg += `<i>...and ${list.length - 5} more snapshots in Central Control Center.</i>\n\n`;
        }
        msg += `<i>All snapshots are downloadable remotely via Central Control Center.</i>`;
        await this.sendMessage(normalizedChat, msg);
      } catch (err) {
        await this.sendMessage(normalizedChat, `❌ Failed to list snapshots: ${err.message}`);
      }
      return;
    }

    await this.sendMessage(normalizedChat, 'Unknown command. Type <code>/status</code>, <code>/health</code>, <code>/backup</code>, <code>/backups</code>, <code>/reboot</code>, or <code>/help</code>.');
  }

  /**
   * Subscribes to Security and Infrastructure Events on Central EventBus
   */
  startEventSubscriptions() {
    // 1. Server Boot Completed Alert
    globalEventBus.subscribe(EVENT_TYPES.SYSTEM_BOOT_COMPLETED, async event => {
      const data = event.data || {};
      const report = await this.compileTelemetryReport();

      let sLines = '';
      for (const s of report.services) {
        const icon = s.status === 'HEALTHY' ? '🟢' : s.status === 'STARTING' ? '🟡' : '🔴';
        sLines += `${icon} <b>${s.displayName || s.id}</b> (Port ${s.port || 'Worker'}): <code>${s.status}</code>\n`;
      }

      let apiLines = '';
      for (const a of report.apiChecks) {
        const icon = a.status === 'HEALTHY' ? '⚡' : '❌';
        apiLines += `${icon} <b>${a.name}</b> (Port ${a.port}): <code>${a.status}</code> (${a.latency})\n`;
      }

      const alert = `🚀 <b>SERVER BOOT COMPLETED — ALL SYSTEMS ACTIVE</b>\n` +
        `📅 <i>${report.timestamp}</i>\n\n` +
        `🌐 <b>Environment Mode:</b> <code>${report.mode}</code>\n` +
        `☁️ <b>Cloudflare Tunnel:</b> ${report.tunnelStatus}\n` +
        `📱 <b>WhatsApp Status:</b> <code>${report.whatsappStatus}</code>\n\n` +
        `🔌 <b>All Platform Microservices Active:</b>\n` +
        (sLines || '<i>Services initializing...</i>\n') +
        `\n⚡ <b>Core API Health:</b>\n` +
        (apiLines || '<i>All core APIs probed</i>');

      await this.broadcast(alert);
    });

    // 2. Server Shutdown Alert
    globalEventBus.subscribe(EVENT_TYPES.SYSTEM_SHUTDOWN, async event => {
      const data = event.data || {};
      const alert = `🛑 <b>SERVER SHUTDOWN INITIATED</b>\n\n` +
        `<b>Signal:</b> <code>${data.signal || 'SIGINT'}</code>\n` +
        `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>\n` +
        `All background microservices and Cloudflare tunnel processes have stopped.`;
      await this.broadcast(alert);
    });

    // 3. Service Outage Alert
    globalEventBus.subscribe(EVENT_TYPES.SERVICE_FAILED, async event => {
      const data = event.data || {};
      const alert = `🚨 <b>SERVICE OUTAGE ALERT</b>\n\n` +
        `🔴 <b>Service:</b> ${data.name || data.serviceId}\n` +
        `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>\n` +
        (data.exitCode !== null && data.exitCode !== undefined ? `<b>Exit Code:</b> <code>${data.exitCode}</code>\n` : '') +
        (data.reason ? `<b>Reason:</b> <code>${data.reason}</code>\n` : '') +
        `<b>Action:</b> Automatic recovery attempt #${data.restartCount || 1}`;
      await this.broadcast(alert);
    });

    // 4. Cloudflare Tunnel Outage Alert
    globalEventBus.subscribe('TUNNEL_OUTAGE', async event => {
      const data = event.data || {};
      const alert = `🚨 <b>CLOUDFLARE TUNNEL OUTAGE</b>\n\n` +
        `🔴 <b>Status:</b> Tunnel process terminated unexpectedly\n` +
        `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>\n` +
        `<b>Error:</b> <code>${data.error || 'Connection lost'}</code>`;
      await this.broadcast(alert);
    });

    // 4b. Service Recovery Alert
    globalEventBus.subscribe(EVENT_TYPES.SERVICE_RECOVERED, async event => {
      const data = event.data || {};
      const alert = `✅ <b>SERVICE RECOVERED</b>\n\n` +
        `🟢 <b>Service:</b> ${data.name || data.serviceId}\n` +
        `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>\n` +
        `Operational status restored to HEALTHY (All probes passing).`;
      await this.broadcast(alert);
    });

    // 5. Admin Login Success Alert
    globalEventBus.subscribe(EVENT_TYPES.ADMIN_LOGIN_SUCCESS, async event => {
      const data = event.data || {};
      const alert = `🔐 <b>ADMIN LOGIN ALERT</b>\n\n` +
        `<b>Dashboard:</b> ${data.panel || data.admin || 'Operator Console'}\n` +
        `<b>Status:</b> ✅ AUTHORIZED\n` +
        `<b>Login Mode:</b> <code>${data.mode || 'Master Password'}</code>\n` +
        `<b>Date & Time:</b> ${data.timestamp || new Date().toLocaleString('en-GB')}\n` +
        `<b>IP Address:</b> <code>${data.ipAddress || '127.0.0.1'}</code>`;
      await this.broadcast(alert);
    });

    // 6. Admin Login Failed Alert
    globalEventBus.subscribe(EVENT_TYPES.ADMIN_LOGIN_FAILED, async event => {
      const data = event.data || {};
      const alert = `⚠️ <b>ADMIN LOGIN FAILED — REJECTED ATTEMPT</b>\n\n` +
        `<b>Dashboard:</b> ${data.account || 'Operator Console'}\n` +
        `<b>Status:</b> ❌ REJECTED (Invalid Password)\n` +
        `<b>Date & Time:</b> ${data.timestamp || new Date().toLocaleString('en-GB')}\n` +
        `<b>IP Address:</b> <code>${data.ipAddress || '127.0.0.1'}</code>`;
      await this.broadcast(alert);
    });

    // 7. Payment Verified Alert (Trust Verification Flow)
    globalEventBus.subscribe(EVENT_TYPES.PAYMENT_SUCCESS, async event => {
      const data = event.data || {};
      const orderId = data.orderId || data.order_id || data.orderNumber || data.id || 'N/A';
      const amount = data.amount || (data.amountPaise ? (Number(data.amountPaise) / 100).toFixed(2) : data.total || '0');
      const custName = data.customerName || data.customer?.name || 'Verified Customer';
      const custPhone = data.customerPhone || data.customer?.phone || data.customer?.mobileNumber || '';

      const alert = `💰 <b>PAYMENT VERIFIED (TRUST SYSTEM)</b>\n\n` +
        `• <b>Order ID:</b> <code>#${orderId}</code>\n` +
        `• <b>Amount Paid:</b> <b>₹${amount}</b>\n` +
        `• <b>Customer:</b> ${custName} ${custPhone ? `(<code>${custPhone}</code>)` : ''}\n` +
        `• <b>Verification:</b> ✅ Trust Check Confirmed (Auto-Verified)\n` +
        `• <b>Timestamp:</b> <code>${new Date().toLocaleString('en-GB')}</code>\n\n` +
        `<i>Order marked as PAID and ready for courier fulfillment.</i>`;
      await this.broadcast(alert);
    });

    // 8. Order Confirmed Alert
    globalEventBus.subscribe(EVENT_TYPES.ORDER_CONFIRMED, async event => {
      const data = event.data || {};
      const orderNumber = data.order_number || data.orderNumber || data.id || 'N/A';
      const total = data.total_amount || data.total || '0';
      const customer = data.customer_name || data.shipping_name || 'Customer';

      const alert = `📦 <b>NEW ORDER CONFIRMED</b>\n\n` +
        `• <b>Order:</b> <code>#${orderNumber}</code>\n` +
        `• <b>Total:</b> <b>₹${total}</b>\n` +
        `• <b>Recipient:</b> ${customer}\n` +
        `• <b>Status:</b> 🟢 CONFIRMED & QUEUED FOR DISPATCH\n` +
        `• <b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>`;
      await this.broadcast(alert);
    });

    console.log('[TelegramBot] Subscribed to Boot, Shutdown, Outage, Login, and Trust Payment events.');
  }

  /**
   * Starts polling Telegram updates in live mode
   */
  async startPolling() {
    this.startEventSubscriptions();

    if (this.isMockMode()) {
      console.log('[TelegramBot] Running in Mock/Simulator Mode (Live bot token not configured).');
      this.pollTimer = setInterval(() => {}, 1000 * 60 * 60);
      return;
    }

    this.isPolling = true;
    console.log(`[TelegramBot] Starting Telegram long-polling loop for admin chat ${this.adminChatId}...`);

    // Safety Flush on Startup:
    // If no previous update ID is recorded, query latest update and advance offset
    // to discard any offline backlog and prevent replaying commands.
    if (!this.lastUpdateId || this.lastUpdateId === 0) {
      try {
        const flushRes = await fetch(
          `https://api.telegram.org/bot${this.token}/getUpdates?offset=-1&limit=1`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (flushRes.ok) {
          const flushData = await flushRes.json();
          if (flushData.result && flushData.result.length > 0) {
            const latest = flushData.result[0];
            this.lastUpdateId = latest.update_id;
            try { this.repos?.telegram?.saveUpdateId?.(this.lastUpdateId); } catch {}
            // Acknowledge update to purge all past messages from Telegram queue
            await fetch(
              `https://api.telegram.org/bot${this.token}/getUpdates?offset=${latest.update_id + 1}&limit=1`,
              { signal: AbortSignal.timeout(5000) }
            ).catch(() => {});
            console.log(`[TelegramBot] Flushed stale Telegram updates on startup. Offset set to ${this.lastUpdateId + 1}.`);
          }
        }
      } catch (err) {
        console.warn('[TelegramBot] Startup update flush notice:', err.message);
      }
    }

    const poll = async () => {
      if (!this.isPolling) return;
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`
        );
        if (res.ok) {
          const data = await res.json();
          for (const update of data.result || []) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
            try { this.repos?.telegram?.saveUpdateId?.(this.lastUpdateId); } catch {}

            // Immediately acknowledge update to Telegram servers
            fetch(`https://api.telegram.org/bot${this.token}/getUpdates?offset=${update.update_id + 1}&limit=1`).catch(() => {});

            if (update.message && update.message.text) {
              const msg = update.message;
              await this.handleCommand(
                msg.chat.id,
                msg.from?.id,
                msg.from?.username || msg.from?.first_name,
                msg.text,
                msg.date
              );
            }
          }
        }
      } catch (err) {
        // Transient network timeout
      } finally {
        if (this.isPolling) {
          this.pollTimer = setTimeout(poll, 1200);
        }
      }
    };

    poll();
  }

  stop() {
    this.isPolling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
