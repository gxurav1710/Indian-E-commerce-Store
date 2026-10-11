import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, URLS } from '../../../packages/common/src/ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

export class AdminPanelServer {
  /**
   * @param {{ port?: number, commerceApiUrl?: string }} [options={}]
   */
  constructor(options = {}) {
    this.port = options.port || PORTS.ADMIN_PANEL || 5050;
    this.commerceApiUrl = options.commerceApiUrl || URLS.COMMERCE_API || `http://localhost:${PORTS.COMMERCE_API || 5001}`;
    this.shippingServiceUrl = options.shippingServiceUrl || URLS.SHIPPING_SERVICE || `http://localhost:${PORTS.SHIPPING_SERVICE || 5003}`;
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

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      const readJsonBody = () => new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try { resolve(body ? JSON.parse(body) : {}); }
          catch (e) { reject(e); }
        });
      });

      // Environment Mode Switcher Proxy
      if (pathname === '/api/environment/mode') {
        try {
          const ctrlRes = await fetch(`http://localhost:8090/api/environment/mode`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: (method === 'POST') ? JSON.stringify(await readJsonBody()) : undefined
          });
          const ctrlData = await ctrlRes.json();
          res.writeHead(ctrlRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ctrlData));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
      }

      // 1. Health check (Section 30)
      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'HEALTHY',
          service: 'admin-panel',
          port: this.port,
          timestamp: new Date().toISOString()
        }));
        return;
      }

      if (pathname === '/health/deep') {
        let commerceApiOk = false;
        try {
          const check = await fetch(`${this.commerceApiUrl}/health`, { signal: AbortSignal.timeout(2000) });
          commerceApiOk = check.ok;
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: commerceApiOk ? 'HEALTHY' : 'DEGRADED',
          service: 'admin-panel',
          dependencies: {
            commerceApi: commerceApiOk ? 'HEALTHY' : 'UNREACHABLE'
          },
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // 2. Dynamic Runtime Config
      if (pathname === '/api/config') {
        try {
          const rootEnv = path.resolve(rootDir, '.env');
          if (fs.existsSync(rootEnv)) {
            const lines = fs.readFileSync(rootEnv, 'utf8').split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) continue;
              const eqIdx = trimmed.indexOf('=');
              if (eqIdx !== -1) {
                const key = trimmed.slice(0, eqIdx).trim();
                const val = trimmed.slice(eqIdx + 1).trim();
                process.env[key] = val;
              }
            }
          }
        } catch {}

        const primaryDomain = (process.env.PRIMARY_DOMAIN || '').trim();
        const domainExt = (process.env.DOMAIN_EXTENSION || '.shop').trim();

        const rawHost = req.headers['x-forwarded-host'] || req.headers.host || '';
        const reqHost = rawHost.split(':')[0];
        const isHostLocal = !reqHost || reqHost === 'localhost' || reqHost === '127.0.0.1';
        const isProdDomain = Boolean(primaryDomain && primaryDomain !== 'localhost' && primaryDomain !== '127.0.0.1');

        let resolvedCommerceApi = (process.env.COMMERCE_API_URL || this.commerceApiUrl).replace(/\/+$/, '');
        let resolvedShipping = (process.env.SHIPPING_SERVICE_URL || this.shippingServiceUrl).replace(/\/+$/, '');

        if (isHostLocal || process.env.ENVIRONMENT_MODE === 'DEVELOPMENT') {
          const localHost = isHostLocal ? (reqHost || 'localhost') : 'localhost';
          resolvedCommerceApi = `http://${localHost}:5001`;
          resolvedShipping = `http://${localHost}:5003`;
        } else if (isProdDomain && (process.env.ENVIRONMENT_MODE === 'PRODUCTION' || resolvedCommerceApi.includes(primaryDomain))) {
          resolvedCommerceApi = `https://api.${primaryDomain}${domainExt}`;
          resolvedShipping = `https://shipping.${primaryDomain}${domainExt}`;
        } else if (!isHostLocal && reqHost) {
          let rootDomain = reqHost;
          const parts = reqHost.split('.');
          if (parts.length > 2 && (parts[0] === 'admin' || parts[0] === 'www' || parts[0] === 'ops')) {
            rootDomain = parts.slice(1).join('.');
          }
          const proto = 'https://';
          resolvedCommerceApi = `${proto}api.${rootDomain}`;
          resolvedShipping = `${proto}shipping.${rootDomain}`;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          commerceApiUrl: resolvedCommerceApi,
          shippingServiceUrl: resolvedShipping,
          appName: 'LUMEN LUXE Operations Console',
          version: '1.0.0'
        }));
        return;
      }

      // 3. Static Files & Single Page Fallback
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
      res.end('Admin Panel Resource Not Found');
    });
  }

  async start() {
    const server = this.createServer();
    return new Promise((resolve, reject) => {
      server.listen(this.port, () => {
        console.log(`[AdminPanel] Serving Business Operations Panel on http://localhost:${this.port}`);
        resolve(server);
      });
      server.on('error', reject);
    });
  }
}
