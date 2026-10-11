import http from 'node:http';
import { NotificationDispatcher } from './dispatcher.js';
import { PORTS } from '../../../packages/common/src/ports.js';
import { createRepositories } from '../../../packages/db/src/index.js';

export class NotificationServer {
  /**
   * @param {{ port?: number, dispatcher?: NotificationDispatcher }} [options={}]
   */
  constructor(options = {}) {
    this.port = options.port || PORTS.NOTIFICATION_SERVICE || 5002;
    this.repos = createRepositories();
    this.dispatcher = options.dispatcher || new NotificationDispatcher({ repos: this.repos });
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
          status: 'HEALTHY',
          service: 'notifications',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // 2. GET /health/deep
      if (pathname === '/health/deep' && method === 'GET') {
        let dbOk = false;
        try {
          const check = this.repos.db.queryOne('SELECT 1 as alive');
          dbOk = check?.alive === 1;
        } catch {}

        jsonResponse(200, {
          status: dbOk ? 'HEALTHY' : 'DEGRADED',
          service: 'notifications',
          database: dbOk ? 'HEALTHY' : 'UNHEALTHY',
          whatsappWorkerUrl: this.dispatcher.whatsappWorkerUrl,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // 3. GET /api/v1/templates - List all notification templates
      if (pathname === '/api/v1/templates' && method === 'GET') {
        const templates = this.repos.notifications.listTemplates();
        jsonResponse(200, { success: true, templates });
        return;
      }

      // 4. PUT /api/v1/templates/:id - Update a notification template
      const tplMatch = pathname.match(/^\/api\/v1\/templates\/([^/]+)$/);
      if (tplMatch && (method === 'PUT' || method === 'POST')) {
        const id = tplMatch[1];
        const body = await readJsonBody();
        const updated = this.repos.notifications.upsertTemplate({
          id,
          title: body.title,
          templateText: body.templateText || body.template_text,
          channel: body.channel || 'WHATSAPP',
          eventType: body.eventType || body.event_type || id,
          isActive: body.isActive !== undefined ? body.isActive : true
        });
        jsonResponse(200, { success: true, template: updated });
        return;
      }

      // 5. GET /api/v1/notifications - List sent notifications log
      if (pathname === '/api/v1/notifications' && method === 'GET') {
        const userId = url.searchParams.get('userId');
        const channel = url.searchParams.get('channel');
        const status = url.searchParams.get('status');
        const limit = Number(url.searchParams.get('limit') || 50);

        const logs = this.repos.notifications.listNotifications({ userId, channel, status, limit });
        jsonResponse(200, { success: true, count: logs.length, notifications: logs });
        return;
      }

      // 6. POST /api/v1/notify - Direct manual trigger endpoint
      if (pathname === '/api/v1/notify' && method === 'POST') {
        const body = await readJsonBody();
        const { eventType, data } = body;

        if (!eventType || !data) {
          jsonResponse(400, { error: 'eventType and data are required' });
          return;
        }

        const notification = await this.dispatcher.handleEvent({ type: eventType, data });
        jsonResponse(200, { success: true, notification });
        return;
      }

      jsonResponse(404, { error: 'Endpoint not found' });
    });
  }

  async start() {
    const server = this.createServer();
    return new Promise((resolve, reject) => {
      server.listen(this.port, () => {
        console.log(`[NotificationService] Listening on http://localhost:${this.port}`);
        resolve(server);
      });
      server.on('error', reject);
    });
  }
}
