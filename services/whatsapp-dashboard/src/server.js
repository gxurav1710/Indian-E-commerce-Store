import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, URLS } from '../../../packages/common/src/ports.js';
import { verifyAdminLogin } from '../../../packages/common/src/admin-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WhatsAppDashboardServer {
  /**
   * @param {{ port?: number, workerUrl?: string, authApiUrl?: string }} [options={}]
   */
  constructor(options = {}) {
    this.port = options.port || PORTS.WHATSAPP_DASHBOARD || 4002;
    this.workerUrl = options.workerUrl || URLS.WHATSAPP_WORKER || `http://localhost:${PORTS.WHATSAPP_WORKER || 4001}`;
    this.authApiUrl = options.authApiUrl || URLS.WHATSAPP_AUTH_API || `http://localhost:${PORTS.WHATSAPP_AUTH_API || 4000}`;
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
      '.svg': 'image/svg+xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
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

      // 1. Health check
      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'HEALTHY',
          service: 'whatsapp-dashboard',
          studio: 'BerryProtocol Studio',
          port: this.port,
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // 1b. Universal Admin Lock Screen Verification
      if (pathname === '/api/auth/verify' && method === 'POST') {
        try {
          const body = await readJsonBody();
          const clientIp = req.socket?.remoteAddress || '127.0.0.1';
          const result = await verifyAdminLogin({
            password: body.password,
            panelName: 'WhatsApp Berry Studio',
            ipAddress: clientIp
          });

          if (result.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      // 2. API Proxy: GET /api/status -> Fetch from WhatsApp Worker
      if (pathname === '/api/status' && method === 'GET') {
        try {
          const workerRes = await fetch(`${this.workerUrl}/api/v1/status`, { signal: AbortSignal.timeout(3000) });
          if (workerRes.ok) {
            const data = await workerRes.json();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, ...data }));
            return;
          }
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          status: 'DISCONNECTED',
          clientInfo: { phoneNumber: null, platform: 'BerryProtocol' },
          qrCode: null
        }));
        return;
      }

      // 2b. API Proxy: GET /api/qr -> Fetch QR from WhatsApp Worker
      if (pathname === '/api/qr' && method === 'GET') {
        try {
          const workerRes = await fetch(`${this.workerUrl}/api/v1/qr`, { signal: AbortSignal.timeout(3000) });
          if (workerRes.ok) {
            const data = await workerRes.json();
            const accept = req.headers['accept'] || '';
            const qrDataUrl = data.dataUrl || data.qrCode;
            if (accept.includes('image/') && typeof qrDataUrl === 'string' && qrDataUrl.startsWith('data:image/png;base64,')) {
              const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
              const imgBuffer = Buffer.from(base64Data, 'base64');
              res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': imgBuffer.length,
                'Cache-Control': 'no-store, no-cache, must-revalidate'
              });
              res.end(imgBuffer);
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
            return;
          }
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          available: false,
          qrCode: null
        }));
        return;
      }

      // 3. API Proxy: POST /api/pairing/start -> Trigger pairing on worker
      if (pathname === '/api/pairing/start' && method === 'POST') {
        try {
          const workerRes = await fetch(`${this.workerUrl}/api/v1/pairing/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          const data = await workerRes.json();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
          return;
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
          return;
        }
      }

      // 4. API Proxy: POST /api/pairing/logout -> Disconnect device
      if (pathname === '/api/pairing/logout' && method === 'POST') {
        try {
          const workerRes = await fetch(`${this.workerUrl}/api/v1/pairing/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          const data = await workerRes.json();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
          return;
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
          return;
        }
      }

      // 5. API Proxy: POST /api/test-message -> Send live test message
      if (pathname === '/api/test-message' && method === 'POST') {
        const body = await readJsonBody();
        try {
          const workerRes = await fetch(`${this.workerUrl}/api/v1/messages/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const data = await workerRes.json();
          res.writeHead(workerRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
          return;
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
          return;
        }
      }

      // 5b. API Proxy: POST /api/test-otp -> Trigger real OTP initiate on Auth API
      if (pathname === '/api/test-otp' && method === 'POST') {
        const body = await readJsonBody();
        try {
          const authRes = await fetch(`${this.authApiUrl}/api/v1/auth/initiate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const data = await authRes.json();
          res.writeHead(authRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
          return;
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
          return;
        }
      }

      // 6. Serve GUI HTML
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
        res.writeHead(200, { 'Content-Type': mimeType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('BerryProtocol Dashboard Not Found');
    });
  }

  async start() {
    const server = this.createServer();
    return new Promise((resolve, reject) => {
      server.listen(this.port, () => {
        console.log(`[WhatsAppDashboard] BerryProtocol Studio running on http://localhost:${this.port}`);
        resolve(server);
      });
      server.on('error', reject);
    });
  }
}
