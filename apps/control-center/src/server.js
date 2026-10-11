import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { PORTS, URLS } from '../../../packages/common/src/ports.js';
import { verifyAdminLogin } from '../../../packages/common/src/admin-auth.js';
import {
  createRootSnapshot,
  listSnapshots,
  getSnapshotStatus,
  getSnapshotFilePath,
  deleteSnapshot
} from '../../../packages/common/src/snapshot-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ControlCenterServer {
  /**
   * @param {{ port?: number, coreHandlerUrl?: string }} [options={}]
   */
  constructor(options = {}) {
    this.port = options.port || PORTS.CONTROL_CENTER || 8090;
    this.coreHandlerUrl = options.coreHandlerUrl || URLS.CORE_HANDLER || `http://localhost:${PORTS.CORE_HANDLER || 8085}`;
    this.publicDir = path.join(__dirname, 'public');
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  computeEnvironmentConfig(mode, domain = 'vienta', ext = '.shop', proto = 'https://') {
    const isProd = String(mode || '').toUpperCase() === 'PRODUCTION';
    if (!isProd) {
      return {
        ENVIRONMENT_MODE: 'DEVELOPMENT',
        NODE_ENV: 'development',
        PRIMARY_DOMAIN: '',
        DOMAIN_EXTENSION: (ext || '.shop').trim(),
        STOREFRONT_URL: 'http://localhost:5000',
        COMMERCE_API_URL: 'http://localhost:5001',
        ADMIN_PANEL_URL: 'http://localhost:5050',
        CONTROL_CENTER_URL: 'http://localhost:8090',
        CORE_HANDLER_URL: 'http://localhost:8085',
        NOTIFICATION_SERVICE_URL: 'http://localhost:5002',
        SHIPPING_SERVICE_URL: 'http://localhost:5003',
        BASE_PAYMENT_API_URL: 'http://localhost:6100',
        BASE_CHECKOUT_URL: 'http://localhost:7000',
        BASE_ADMIN_URL: 'http://localhost:6001',
        WHATSAPP_AUTH_API_URL: 'http://localhost:4000',
        WHATSAPP_WORKER_URL: 'http://localhost:4001',
        WHATSAPP_DASHBOARD_URL: 'http://localhost:4002',
        PAYMENT_SUCCESS_RETURN_URL: 'http://localhost:5000/account/orders/{order_number}?paymentSuccess=true',
        PAYMENT_CANCEL_RETURN_URL: 'http://localhost:5000/cart?paymentCanceled=true',
        PAYMENT_WEBHOOK_URL: 'http://localhost:5001/api/v1/webhooks/payment',
        WHATSAPP_WEBHOOK_URL: 'http://localhost:4000/api/v1/internal/whatsapp/webhook',
        WHATSAPP_AUTH_REDIRECT_URI: 'http://localhost:5000/auth/whatsapp/callback'
      };
    }

    let cleanName = (domain || 'vienta').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    let cleanExt = (ext || '.shop').trim();
    if (!cleanExt.startsWith('.')) cleanExt = '.' + cleanExt;
    if (cleanName.includes('.')) {
      const parts = cleanName.split('.');
      cleanExt = '.' + parts.pop();
      cleanName = parts.join('.');
    }
    const fullDomain = `${cleanName}${cleanExt}`;
    const cleanProto = proto || 'https://';

    return {
      ENVIRONMENT_MODE: 'PRODUCTION',
      NODE_ENV: 'production',
      PRIMARY_DOMAIN: cleanName,
      DOMAIN_EXTENSION: cleanExt,
      STOREFRONT_URL: `${cleanProto}${fullDomain}`,
      COMMERCE_API_URL: `${cleanProto}api.${fullDomain}`,
      ADMIN_PANEL_URL: `${cleanProto}admin.${fullDomain}`,
      CONTROL_CENTER_URL: `${cleanProto}control.${fullDomain}`,
      CORE_HANDLER_URL: `${cleanProto}core.${fullDomain}`,
      NOTIFICATION_SERVICE_URL: `${cleanProto}notify.${fullDomain}`,
      SHIPPING_SERVICE_URL: `${cleanProto}shipping.${fullDomain}`,
      BASE_PAYMENT_API_URL: `${cleanProto}pay-api.${fullDomain}`,
      BASE_CHECKOUT_URL: `${cleanProto}pay.${fullDomain}`,
      BASE_ADMIN_URL: `${cleanProto}merchant.${fullDomain}`,
      WHATSAPP_AUTH_API_URL: `${cleanProto}whatsapp-api.${fullDomain}`,
      WHATSAPP_WORKER_URL: `${cleanProto}whatsapp-worker.${fullDomain}`,
      WHATSAPP_DASHBOARD_URL: `${cleanProto}whatsapp.${fullDomain}`,
      PAYMENT_SUCCESS_RETURN_URL: `${cleanProto}${fullDomain}/account/orders/{order_number}?paymentSuccess=true`,
      PAYMENT_CANCEL_RETURN_URL: `${cleanProto}${fullDomain}/cart?paymentCanceled=true`,
      PAYMENT_WEBHOOK_URL: `${cleanProto}api.${fullDomain}/api/v1/webhooks/payment`,
      WHATSAPP_WEBHOOK_URL: `${cleanProto}whatsapp-api.${fullDomain}/api/v1/internal/whatsapp/webhook`,
      WHATSAPP_AUTH_REDIRECT_URI: `${cleanProto}${fullDomain}/auth/whatsapp/callback`
    };
  }

  saveEnvVariables(varsToUpdate) {
    const rootDir = path.resolve(__dirname, '../../..');
    const envPath = path.resolve(rootDir, '.env');

    const protectedKeys = new Set([
      'MERCHANT_WEBHOOK_SECRET',
      'MERCHANT_ID',
      'SHIPROCKET_EMAIL',
      'ADMIN_API_KEY',
      'WORKER_INTERNAL_SECRET',
      'JWT_SECRET',
      'ENCRYPTION_MASTER_KEY'
    ]);

    // Mirror dynamic admin password across both environment keys
    if (varsToUpdate.ADMIN_PASSWORD) {
      varsToUpdate.UNIVERSAL_ADMIN_PASSWORD = varsToUpdate.ADMIN_PASSWORD;
    } else if (varsToUpdate.UNIVERSAL_ADMIN_PASSWORD) {
      varsToUpdate.ADMIN_PASSWORD = varsToUpdate.UNIVERSAL_ADMIN_PASSWORD;
    }

    // Never allow blanking or accidental overwrite of locked system secrets
    for (const pKey of protectedKeys) {
      if (varsToUpdate[pKey] !== undefined && !String(varsToUpdate[pKey]).trim()) {
        delete varsToUpdate[pKey];
      }
    }

    let currentContent = '';
    if (fs.existsSync(envPath)) {
      currentContent = fs.readFileSync(envPath, 'utf8');
    }

    let updatedLines = [];
    const keysWritten = new Set();

    if (currentContent) {
      const lines = currentContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const eqIdx = trimmed.indexOf('=');
          const key = trimmed.slice(0, eqIdx).trim();
          if (varsToUpdate[key] !== undefined) {
            updatedLines.push(`${key}=${varsToUpdate[key]}`);
            keysWritten.add(key);
          } else {
            updatedLines.push(line);
          }
        } else {
          updatedLines.push(line);
        }
      }
    }

    for (const [key, val] of Object.entries(varsToUpdate)) {
      if (!keysWritten.has(key)) {
        updatedLines.push(`${key}=${val}`);
      }
    }

    fs.writeFileSync(envPath, updatedLines.join('\n'), 'utf8');

    // Also synchronize YOUPI PG V2/.env
    const pgEnvPath = path.resolve(rootDir, 'YOUPI PG V2', '.env');
    if (fs.existsSync(pgEnvPath)) {
      try {
        const pgContent = fs.readFileSync(pgEnvPath, 'utf8');
        const pgLines = pgContent.split('\n');
        const updatedPgLines = [];
        for (const line of pgLines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const eqIdx = trimmed.indexOf('=');
            const key = trimmed.slice(0, eqIdx).trim();
            if (varsToUpdate[key] !== undefined) {
              updatedPgLines.push(`${key}=${varsToUpdate[key]}`);
            } else {
              updatedPgLines.push(line);
            }
          } else {
            updatedPgLines.push(line);
          }
        }
        fs.writeFileSync(pgEnvPath, updatedPgLines.join('\n'), 'utf8');
      } catch {}
    }

    // Write runtime_config.json for instant zero-restart sync across all services
    try {
      const runtimeCfgPath = path.resolve(rootDir, 'data/runtime_config.json');
      const dataDir = path.dirname(runtimeCfgPath);
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      let existingCfg = {};
      if (fs.existsSync(runtimeCfgPath)) {
        try { existingCfg = JSON.parse(fs.readFileSync(runtimeCfgPath, 'utf8')); } catch {}
      }
      const mergedCfg = { ...existingCfg, ...varsToUpdate };
      fs.writeFileSync(runtimeCfgPath, JSON.stringify(mergedCfg, null, 2), 'utf8');
    } catch {}

    // Synchronize directly into SQLite store_settings database table
    try {
      const dbPath = path.resolve(rootDir, 'data/unified_ecommerce.sqlite');
      if (fs.existsSync(dbPath)) {
        const db = new DatabaseSync(dbPath);
        db.exec(`
          CREATE TABLE IF NOT EXISTS store_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);
        for (const [key, val] of Object.entries(varsToUpdate)) {
          if (val !== undefined && val !== null) {
            db.prepare(`
              INSERT INTO store_settings (key, value, updated_at)
              VALUES (?, ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
            `).run(key, String(val));
          }
        }
      }
    } catch (dbErr) {
      console.warn('[ControlCenter] DB store_settings sync notice:', dbErr.message);
    }

    // Update in-memory process.env
    for (const [key, val] of Object.entries(varsToUpdate)) {
      process.env[key] = String(val);
    }
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Operator-Token');

      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // JSON parsing utility
      const readJsonBody = () => new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try { resolve(body ? JSON.parse(body) : {}); }
          catch (e) { reject(e); }
        });
      });

      // 1. Health checks (Section 30)
      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'HEALTHY',
          service: 'control-center',
          port: this.port,
          timestamp: new Date().toISOString()
        }));
        return;
      }

      if (pathname === '/health/deep') {
        let coreOk = false;
        try {
          const check = await fetch(`${this.coreHandlerUrl}/health`, { signal: AbortSignal.timeout(2000) });
          coreOk = check.ok;
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: coreOk ? 'HEALTHY' : 'DEGRADED',
          service: 'control-center',
          coreHandler: coreOk ? 'CONNECTED' : 'DISCONNECTED',
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // 2. Privileged Operator Login & Universal Password Check
      if (pathname === '/api/operator/verify-password' && method === 'POST') {
        const body = await readJsonBody();
        const { password } = body;
        const inputPass = String(password || '').trim();

        if (!inputPass) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Password is required' }));
          return;
        }

        const clientIp = req.socket?.remoteAddress || '127.0.0.1';
        const rootDir = path.resolve(__dirname, '../../..');
        const authResult = await verifyAdminLogin({
          password: inputPass,
          panelName: 'Central Control Center',
          ipAddress: clientIp,
          rootDir
        });

        if (authResult.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            token: authResult.token,
            mode: authResult.mode,
            operator: { role: 'CENTRAL_OPERATOR_CONSOLE' },
            message: 'Central Control Center operator authenticated.'
          }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: authResult.error || 'Invalid master administrator password.' }));
        }
        return;
      }

      if (pathname === '/api/operator/login' && method === 'POST') {
        const body = await readJsonBody();
        const { username, password } = body;

        const expectedUser = process.env.OPERATOR_USERNAME || 'operator';
        const expectedPass = process.env.OPERATOR_PASSWORD || 'OperatorMasterPass2026!';

        let isAuthorized = (username === expectedUser && password === expectedPass);

        if (!isAuthorized) {
          const clientIp = req.socket?.remoteAddress || '127.0.0.1';
          const rootDir = path.resolve(__dirname, '../../..');
          const authResult = await verifyAdminLogin({
            password,
            panelName: 'Central Control Center',
            ipAddress: clientIp,
            rootDir
          });
          if (authResult.success) isAuthorized = true;
        }

        if (isAuthorized) {
          const sessionToken = `OPR_SESS_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            token: sessionToken,
            operator: { username: username || 'operator', role: 'OPERATOR_CONSOLE' },
            expiresInSeconds: 3600
          }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid operator console credentials' }));
        }
        return;
      }

      // =========================================================================
      // CREDENTIAL MANAGER (Pushes credentials, URLs & API keys directly into code)
      // =========================================================================
      if (pathname === '/api/credentials' && method === 'GET') {
        const rootDir = path.resolve(__dirname, '../../..');
        const envPath = path.resolve(rootDir, '.env');
        const envExamplePath = path.resolve(rootDir, '.env.example');

        let rawContent = '';
        if (fs.existsSync(envPath)) {
          rawContent = fs.readFileSync(envPath, 'utf8');
        } else if (fs.existsSync(envExamplePath)) {
          rawContent = fs.readFileSync(envExamplePath, 'utf8');
        }

        const lines = rawContent.split('\n');
        const envVars = {};
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            envVars[key] = val;
          }
        }

        const reqHost = (req.headers.host || '').split(':')[0];
        const isHostLocal = reqHost === 'localhost' || reqHost === '127.0.0.1';

        // Check SQLite store_settings for CLOUDFLARE_TUNNEL_COMMAND or custom runtime overrides
        try {
          const dbPath = path.resolve(rootDir, 'data/unified_ecommerce.sqlite');
          if (fs.existsSync(dbPath)) {
            const db = new DatabaseSync(dbPath);
            const row = db.prepare("SELECT value FROM store_settings WHERE key = 'CLOUDFLARE_TUNNEL_COMMAND' OR key = 'cloudflared_tunnel_command'").get();
            if (row && row.value && !envVars.CLOUDFLARE_TUNNEL_COMMAND) {
              envVars.CLOUDFLARE_TUNNEL_COMMAND = row.value;
            }
          }
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          envPath,
          credentials: envVars,
          detectedHost: reqHost,
          isHostLocal,
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // 2.5 1-Click Environment Mode Switcher API (Localhost <-> Production)
      if (pathname === '/api/environment/mode') {
        if (method === 'GET') {
          const currentMode = process.env.ENVIRONMENT_MODE || 'DEVELOPMENT';
          const isProd = currentMode === 'PRODUCTION';
          const primaryDomain = (process.env.PRIMARY_DOMAIN || '').trim();
          const domainExt = (process.env.DOMAIN_EXTENSION || '.shop').trim();
          const fullDomain = primaryDomain ? `${primaryDomain}${domainExt}` : 'vienta.shop';

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            mode: currentMode,
            isProduction: isProd,
            primaryDomain,
            domainExtension: domainExt,
            fullDomain,
            storefrontUrl: process.env.STOREFRONT_URL || 'http://localhost:5000',
            commerceApiUrl: process.env.COMMERCE_API_URL || 'http://localhost:5001',
            whatsappAuthApiUrl: process.env.WHATSAPP_AUTH_API_URL || 'http://localhost:4000',
            checkoutPortalUrl: process.env.BASE_CHECKOUT_URL || 'http://localhost:7000',
            adminPanelUrl: process.env.ADMIN_PANEL_URL || 'http://localhost:5050'
          }));
          return;
        }

        if (method === 'POST') {
          try {
            const body = await readJsonBody();
            const { mode, domain, ext, proto } = body;
            const targetMode = String(mode || 'DEVELOPMENT').toUpperCase();
            const activeDomain = domain || process.env.PRIMARY_DOMAIN || 'vienta';
            const activeExt = ext || process.env.DOMAIN_EXTENSION || '.shop';

            const configMap = this.computeEnvironmentConfig(targetMode, activeDomain, activeExt, proto);
            this.saveEnvVariables(configMap);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              mode: targetMode,
              isProduction: targetMode === 'PRODUCTION',
              message: targetMode === 'PRODUCTION'
                ? `Switched platform to LIVE PRODUCTION mode (${configMap.PRIMARY_DOMAIN}${configMap.DOMAIN_EXTENSION}).`
                : 'Switched platform to LOCALHOST DEVELOPMENT mode.',
              config: configMap
            }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
          return;
        }
      }

      if (pathname === '/api/credentials' && method === 'POST') {
        try {
          const body = await readJsonBody();
          const { credentials } = body;

          if (!credentials || typeof credentials !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Valid credentials object is required.' }));
            return;
          }

          this.saveEnvVariables(credentials);

          const rootDir = path.resolve(__dirname, '../../..');
          const envPath = path.resolve(rootDir, '.env');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: 'Credentials, URLs, and API keys pushed directly into .env code successfully.',
            envPath
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      // Cloudflare Tunnel Command Direct Saver (DB + .env + runtime_config)
      if (pathname === '/api/credentials/tunnel-command' && method === 'POST') {
        try {
          const body = await readJsonBody();
          const { command } = body;
          const tunnelCmd = typeof command === 'string' ? command.trim() : '';

          this.saveEnvVariables({
            CLOUDFLARE_TUNNEL_COMMAND: tunnelCmd
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            command: tunnelCmd,
            message: 'Cloudflare Tunnel command saved successfully to database, runtime config, and .env'
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      // =========================================================================
      // SNAPSHOTS & REMOTE BACKUPS API
      // =========================================================================

      // GET /api/snapshots - List all snapshots
      if (pathname === '/api/snapshots' && method === 'GET') {
        const rootDir = path.resolve(__dirname, '../../..');
        const snapshots = listSnapshots({ rootDir });
        const status = getSnapshotStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          snapshots,
          status,
          totalCount: snapshots.length
        }));
        return;
      }

      // GET /api/snapshots/status - Current snapshot job status
      if (pathname === '/api/snapshots/status' && method === 'GET') {
        const status = getSnapshotStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, status }));
        return;
      }

      // POST /api/snapshots/create - Trigger an instant full root snapshot
      if (pathname === '/api/snapshots/create' && method === 'POST') {
        const rootDir = path.resolve(__dirname, '../../..');
        const status = getSnapshotStatus();
        if (status.isRunning) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            inProgress: true,
            message: 'A snapshot archive is already being generated in the background.',
            status
          }));
          return;
        }

        try {
          const format = url.searchParams.get('format') || 'auto';
          const snapshotPromise = createRootSnapshot({ rootDir, format });

          if (url.searchParams.get('async') === 'true') {
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              inProgress: true,
              message: 'Snapshot creation started in background.'
            }));
            return;
          }

          const result = await snapshotPromise;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
          return;
        }
      }

      // GET /api/snapshots/download/:filename - Remote/Local direct download of snapshot archive
      if (pathname.startsWith('/api/snapshots/download/') && method === 'GET') {
        const rawFilename = pathname.replace('/api/snapshots/download/', '');
        const filename = decodeURIComponent(rawFilename);
        const rootDir = path.resolve(__dirname, '../../..');
        const filePath = getSnapshotFilePath(filename, rootDir);

        if (!filePath || !fs.existsSync(filePath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Snapshot file not found' }));
          return;
        }

        const stat = fs.statSync(filePath);
        let contentType = 'application/octet-stream';
        if (filename.endsWith('.tar.gz') || filename.endsWith('.tgz')) {
          contentType = 'application/gzip';
        } else if (filename.endsWith('.rar')) {
          contentType = 'application/x-rar-compressed';
        } else if (filename.endsWith('.zip')) {
          contentType = 'application/zip';
        } else if (filename.endsWith('.tar')) {
          contentType = 'application/x-tar';
        }

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
          'Cache-Control': 'no-cache'
        });

        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // DELETE /api/snapshots/:filename - Delete a snapshot
      if (pathname.startsWith('/api/snapshots/') && method === 'DELETE') {
        const rawFilename = pathname.replace('/api/snapshots/', '');
        const filename = decodeURIComponent(rawFilename);
        const rootDir = path.resolve(__dirname, '../../..');
        const deleted = deleteSnapshot(filename, rootDir);

        if (deleted) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: `Snapshot ${filename} deleted successfully.` }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Could not delete snapshot ${filename}.` }));
        }
        return;
      }

      // 3. Reverse-Proxy API Requests to Core Handler (port 8085)
      if (pathname.startsWith('/api/core/')) {
        const targetPath = pathname.replace('/api/core', '/api/v1');
        const targetUrl = `${this.coreHandlerUrl}${targetPath}${url.search}`;

        try {
          const proxyRes = await fetch(targetUrl, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: (method === 'POST' || method === 'PUT') ? JSON.stringify(await readJsonBody()) : undefined
          });

          res.writeHead(proxyRes.status, { 'Content-Type': 'application/json' });
          const text = await proxyRes.text();
          res.end(text);
          return;
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Core Handler connection failed: ${err.message}` }));
          return;
        }
      }

      // 4. SSE Stream Proxy to Core Handler
      if (pathname === '/api/events/stream') {
        try {
          const proxyRes = await fetch(`${this.coreHandlerUrl}/api/v1/events/stream`);
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          const reader = proxyRes.body.getReader();
          const stream = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          };
          stream().catch(() => {});
          req.on('close', () => reader.cancel().catch(() => {}));
          return;
        } catch {
          res.writeHead(502);
          res.end();
          return;
        }
      }

      // 5. Static Files & SPA Fallback
      let safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      if (safePath === '/' || safePath === '\\') {
        safePath = '/index.html';
      }

      let filePath = path.join(this.publicDir, safePath);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(this.publicDir, 'index.html');
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const mimeType = this.getMimeType(filePath);
        res.writeHead(200, {
          'Content-Type': mimeType,
          'Cache-Control': 'no-cache'
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Control Center Resource Not Found');
    });
  }

  async start() {
    const server = this.createServer();
    return new Promise((resolve, reject) => {
      server.listen(this.port, () => {
        console.log(`[ControlCenter] Serving Infrastructure Control Console on http://localhost:${this.port}`);
        resolve(server);
      });
      server.on('error', reject);
    });
  }
}
