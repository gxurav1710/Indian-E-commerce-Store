import http from 'node:http';
import { SmsObserverService } from './sms-service.js';
import { GoogleMessagesAutomator } from './browser-automator.js';

export class SmsObserverServer {
  /**
   * @param {{
   *   service?: SmsObserverService,
   *   apiBaseUrl?: string,
   *   receivingAccountId?: string
   * }} options
   */
  constructor(options = {}) {
    this.service = options.service || new SmsObserverService(options);
    this.automator = new GoogleMessagesAutomator({ smsService: this.service });
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = (req.method || 'GET').toUpperCase();

      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
      }

      // GET /health
      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'UP',
          service: 'sms-observer',
          isRunning: this.service.isRunning,
          lastPollAt: this.service.lastPollAt,
          observedCount: this.service.observedCount
        }));
        return;
      }

      // GET /api/browser/status
      if (pathname === '/api/browser/status') {
        // Auto-ensure connection if currently idle/standby
        if (this.automator.mode === 'STANDBY' && !this.automator.isEnsuring) {
          this.automator.autoEnsureConnection().catch(() => {});
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(this.automator.getStatus()));
        return;
      }

      // POST /api/browser/auto-ensure
      if (pathname === '/api/browser/auto-ensure' && method === 'POST') {
        try {
          const result = await this.automator.autoEnsureConnection();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // POST /api/browser/launch-pairing
      if (pathname === '/api/browser/launch-pairing' && req.method === 'POST') {
        try {
          const result = this.automator.launchPairingWindow();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // POST /api/sweep (Active sweep trigger during 30-second verification window)
      if (pathname === '/api/sweep' && method === 'POST') {
        try {
          await this.automator.pollRecentMessages();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ swept: true, source: 'GOOGLE_MESSAGES', count: this.automator.messagesObserved }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // POST /process-sms (Direct SMS intake / Google Messages Web bridge)
      if (pathname === '/process-sms' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const smsData = JSON.parse(body);
            const result = await this.service.processSms(smsData);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, result }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('SMS Observer Route Not Found');
    });
  }
}
