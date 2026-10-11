import http from 'node:http';
import { CoreProcessManager } from './process-manager.js';
import { PORTS } from '../../../packages/common/src/ports.js';

export class CoreHandlerServer {
  /**
   * @param {{ port?: number, processManager?: CoreProcessManager }} [options={}]
   */
  constructor(options = {}) {
    this.port = options.port || PORTS.CORE_HANDLER || 8085;
    this.processManager = options.processManager || new CoreProcessManager();
    this.sseClients = new Set();

    // Broadcast log lines to SSE clients
    this.processManager.on('log', logEntry => {
      this.broadcastSse('log', logEntry);
    });

    // Broadcast health updates to SSE clients
    this.processManager.on('health_update', services => {
      this.broadcastSse('health', { services, metrics: this.processManager.getSystemMetrics() });
    });

    // Broadcast individual service changes
    this.processManager.on('service_change', service => {
      this.broadcastSse('service', service);
    });
  }

  broadcastSse(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(payload);
      } catch {
        this.sseClients.delete(res);
      }
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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Helper to parse JSON body
      const readJsonBody = () => new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try { resolve(body ? JSON.parse(body) : {}); }
          catch (e) { reject(e); }
        });
      });

      // 1. GET /health & /api/v1/health
      if ((pathname === '/health' || pathname === '/api/v1/health') && method === 'GET') {
        const statuses = this.processManager.getServicesStatus();
        const criticalUnhealthy = statuses.filter(s => s.criticality === 'CRITICAL' && s.status !== 'HEALTHY' && s.status !== 'STARTING');

        const overallStatus = criticalUnhealthy.length > 0 ? 'DEGRADED' : 'HEALTHY';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: overallStatus,
          service: 'core-handler',
          timestamp: new Date().toISOString(),
          uptimeSeconds: process.uptime()
        }));
        return;
      }

      // 2. GET /health/deep & /api/v1/health/deep (Section 30)
      if ((pathname === '/health/deep' || pathname === '/api/v1/health/deep') && method === 'GET') {
        const statuses = this.processManager.getServicesStatus();
        const metrics = this.processManager.getSystemMetrics();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'UP',
          service: 'core-handler',
          metrics,
          services: statuses,
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // 3. GET /api/v1/services - List all managed services
      if (pathname === '/api/v1/services' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          services: this.processManager.getServicesStatus()
        }));
        return;
      }

      // 4. POST /api/v1/services/:id/start
      const startMatch = pathname.match(/^\/api\/v1\/services\/([^/]+)\/start$/);
      if (startMatch && method === 'POST') {
        const serviceId = startMatch[1];
        try {
          const service = await this.processManager.startService(serviceId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, service }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      // 5. POST /api/v1/services/:id/stop
      const stopMatch = pathname.match(/^\/api\/v1\/services\/([^/]+)\/stop$/);
      if (stopMatch && method === 'POST') {
        const serviceId = stopMatch[1];
        try {
          const service = await this.processManager.stopService(serviceId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, service }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      // 6. POST /api/v1/services/:id/restart
      const restartMatch = pathname.match(/^\/api\/v1\/services\/([^/]+)\/restart$/);
      if (restartMatch && method === 'POST') {
        const serviceId = restartMatch[1];
        try {
          const service = await this.processManager.restartService(serviceId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, service }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      // 6b. POST /api/v1/system/reboot & /api/v1/services/restart-all
      if ((pathname === '/api/v1/system/reboot' || pathname === '/api/v1/services/restart-all') && method === 'POST') {
        try {
          // Asynchronously trigger restart
          this.processManager.restartAll().catch(err => {
            console.error('[CoreHandler] Error during system reboot:', err.message);
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Platform reboot sequence initiated.' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      // 7. GET /api/v1/metrics
      if (pathname === '/api/v1/metrics' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          metrics: this.processManager.getSystemMetrics()
        }));
        return;
      }

      // 8. GET /api/v1/logs - Retrieve circular log buffer with filtering (Section 32)
      if (pathname === '/api/v1/logs' && method === 'GET') {
        const category = url.searchParams.get('category');
        const level = url.searchParams.get('level');
        const service = url.searchParams.get('service');
        const search = url.searchParams.get('search');
        const limit = Number(url.searchParams.get('limit') || 200);

        let filtered = [...this.processManager.logs];
        if (service && service !== 'all') {
          filtered = filtered.filter(l => l.service === service);
        }
        if (level && level !== 'all') {
          filtered = filtered.filter(l => l.level === level.toUpperCase());
        }
        if (category && category !== 'all') {
          filtered = filtered.filter(l => l.category === category);
        }
        if (search) {
          const q = search.toLowerCase();
          filtered = filtered.filter(l => l.message.toLowerCase().includes(q));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          total: filtered.length,
          logs: filtered.slice(-limit)
        }));
        return;
      }

      // 9. GET /api/v1/events/stream - Real-time SSE stream for Control Center
      if (pathname === '/api/v1/events/stream' && method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        // Send initial state snapshot
        res.write(`event: init\ndata: ${JSON.stringify({
          services: this.processManager.getServicesStatus(),
          metrics: this.processManager.getSystemMetrics(),
          recentLogs: this.processManager.logs.slice(-50)
        })}\n\n`);

        this.sseClients.add(res);
        req.on('close', () => {
          this.sseClients.delete(res);
        });
        return;
      }

      // Default 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    });
  }

  async start() {
    const server = this.createServer();
    return new Promise((resolve, reject) => {
      server.listen(this.port, () => {
        console.log(`[CoreHandler] Running and listening on http://localhost:${this.port}`);
        resolve(server);
      });
      server.on('error', reject);
    });
  }
}
