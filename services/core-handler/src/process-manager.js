import os from 'node:os';
import { fork, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getServiceRegistry } from './registry.js';
import { sanitizeData } from '../../../packages/common/src/logger.js';
import { EVENT_TYPES, globalEventBus, createEvent } from '../../../packages/common/src/events.js';
import { sendDirectTelegramAlert } from '../../../packages/common/src/admin-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

export class CoreProcessManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.services = getServiceRegistry().map(s => ({
      ...s,
      child: null,
      status: 'STOPPED', // 'HEALTHY', 'STARTING', 'STOPPED', 'UNHEALTHY', 'RESTARTING', 'FAILED', 'DEGRADED'
      pid: null,
      startTime: null,
      restartCount: 0,
      lastHealthCheck: null,
      healthDetails: null,
      cooldownUntil: 0
    }));

    this.logs = [];
    this.maxLogs = options.maxLogs || 2000;
    this.healthCheckInterval = options.healthCheckInterval || 5000;
    this.healthTimer = null;
    this.isShuttingDown = false;
    this.lastRebootTime = 0;
  }

  /**
   * Initializes health check polling loop and event bindings
   */
  startMonitoring() {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      this.pollHealthChecks();
    }, this.healthCheckInterval);
  }

  stopMonitoring() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  appendLog(serviceId, level, message, details = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      service: serviceId,
      level: level || 'INFO',
      message: (message || '').trim(),
      details: sanitizeData(details)
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.emit('log', entry);
    return entry;
  }

  /**
   * Starts a single service by ID
   * @param {string} serviceId
   */
  async startService(serviceId) {
    const service = this.services.find(s => s.id === serviceId);
    if (!service) throw new Error(`Unknown service: ${serviceId}`);

    if (service.status === 'HEALTHY' || service.status === 'STARTING') {
      return service;
    }

    // Check circuit breaker / cooldown
    const now = Date.now();
    if (service.cooldownUntil > now && service.restartCount >= service.restartPolicy.maxRetries) {
      this.appendLog(service.id, 'WARN', `Service restart postponed due to cooldown until ${new Date(service.cooldownUntil).toISOString()}`);
      return service;
    }

    service.status = 'STARTING';
    service.startTime = new Date().toISOString();
    this.appendLog(service.id, 'INFO', `Starting service ${service.displayName}...`);

    try {
      if (!fs.existsSync(service.script)) {
        service.status = 'FAILED';
        this.appendLog(service.id, 'ERROR', `Service script not found: ${service.script}`);
        return service;
      }

      // Reload updated .env variables so child inherits newly configured URLs & secrets
      const rootDir = path.resolve(__dirname, '../../..');
      const envPath = path.resolve(rootDir, '.env');
      if (fs.existsSync(envPath)) {
        try {
          const raw = fs.readFileSync(envPath, 'utf8');
          for (const line of raw.split('\n')) {
            const t = line.trim();
            if (!t || t.startsWith('#') || !t.includes('=')) continue;
            const eq = t.indexOf('=');
            const k = t.slice(0, eq).trim();
            const v = t.slice(eq + 1).trim();
            process.env[k] = v;
          }
        } catch {}
      }

      const env = {
        ...process.env,
        SERVICE_ID: service.id,
        PORT: service.port ? String(service.port) : undefined
      };

      const child = fork(service.script, [], {
        cwd: service.workingDirectory,
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      });

      service.child = child;
      service.pid = child.pid;

      child.stdout?.on('data', data => {
        const text = data.toString();
        this.appendLog(service.id, 'INFO', text);
      });

      child.stderr?.on('data', data => {
        const text = data.toString();
        this.appendLog(service.id, 'WARN', text);
      });

      child.on('exit', (code, signal) => {
        this.handleServiceExit(service, code, signal);
      });

      child.on('error', err => {
        this.appendLog(service.id, 'ERROR', `Process spawn error: ${err.message}`);
        service.status = 'FAILED';
      });

      // Give process a moment to bind and check initial health
      setTimeout(async () => {
        await this.checkServiceHealth(service);
      }, 1500);

      globalEventBus.publish(createEvent(EVENT_TYPES.SERVICE_STARTED, { serviceId: service.id, name: service.displayName }));
      this.emit('service_change', service);
      return service;
    } catch (err) {
      service.status = 'FAILED';
      this.appendLog(service.id, 'ERROR', `Failed to start ${service.displayName}: ${err.message}`);
      return service;
    }
  }

  /**
   * Stops a service gracefully
   * @param {string} serviceId
   */
  async stopService(serviceId) {
    const service = this.services.find(s => s.id === serviceId);
    if (!service) throw new Error(`Unknown service: ${serviceId}`);

    if (!service.child && service.status === 'STOPPED') {
      return service;
    }

    this.appendLog(service.id, 'INFO', `Stopping service ${service.displayName}...`);
    service.status = 'STOPPED';

    if (service.child) {
      const child = service.child;
      service.child = null;
      service.pid = null;

      try {
        child.kill('SIGTERM');
        // Force kill if not dead after timeout
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
        }, service.shutdownTimeoutMs || 5000);
      } catch {}
    }

    globalEventBus.publish(createEvent(EVENT_TYPES.SERVICE_STOPPED, { serviceId: service.id, name: service.displayName }));
    this.emit('service_change', service);
    return service;
  }

  /**
   * Restarts a service
   * @param {string} serviceId
   */
  async restartService(serviceId) {
    const service = this.services.find(s => s.id === serviceId);
    if (!service) throw new Error(`Unknown service: ${serviceId}`);

    this.appendLog(service.id, 'INFO', `Restarting service ${service.displayName}...`);
    service.status = 'RESTARTING';
    this.emit('service_change', service);

    globalEventBus.publish(createEvent(EVENT_TYPES.SERVICE_RESTARTED, { serviceId: service.id, name: service.displayName }));

    await this.stopService(serviceId);
    await new Promise(resolve => setTimeout(resolve, 1000));
    return this.startService(serviceId);
  }

  /**
   * Handles unexpected service exit and triggers auto-recovery (Section 41)
   */
  async handleServiceExit(service, code, signal) {
    service.child = null;
    service.pid = null;

    if (this.isShuttingDown || service.status === 'STOPPED') {
      service.status = 'STOPPED';
      this.appendLog(service.id, 'INFO', `Service ${service.displayName} stopped gracefully (code: ${code}).`);
      this.emit('service_change', service);
      return;
    }

    service.status = 'UNHEALTHY';
    service.restartCount += 1;
    this.appendLog(service.id, 'ERROR', `Service ${service.displayName} exited unexpectedly with code ${code} (signal: ${signal}). Attempt ${service.restartCount}/${service.restartPolicy.maxRetries}`);

    globalEventBus.publish(createEvent(EVENT_TYPES.SERVICE_FAILED, {
      serviceId: service.id,
      name: service.displayName,
      exitCode: code,
      restartCount: service.restartCount
    }));

    // Dispatch direct Telegram Alert for Service Outage
    const outageMsg = `🚨 <b>SERVICE OUTAGE DETECTED</b>\n\n` +
      `🔴 <b>Service:</b> ${service.displayName}\n` +
      `<b>Port:</b> <code>${service.port ? ':' + service.port : 'Worker Daemon'}</code>\n` +
      `<b>Exit Code:</b> <code>${code}</code> (Signal: ${signal || 'none'})\n` +
      `<b>Recovery:</b> Auto-restarting attempt #${service.restartCount}/${service.restartPolicy.maxRetries}\n` +
      `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>`;
    sendDirectTelegramAlert(outageMsg, { rootDir }).catch(() => {});

    // Auto-recovery with circuit breaker
    if (service.restartCount <= service.restartPolicy.maxRetries) {
      const backoff = service.restartPolicy.cooldownMs * Math.pow(1.5, service.restartCount - 1);
      this.appendLog(service.id, 'WARN', `Scheduling auto-recovery restart in ${Math.round(backoff / 1000)}s...`);

      setTimeout(() => {
        if (service.status !== 'STOPPED' && !this.isShuttingDown) {
          this.startService(service.id);
        }
      }, backoff);
    } else {
      service.status = 'FAILED';
      service.cooldownUntil = Date.now() + 60000; // 1 min cool-off
      this.appendLog(service.id, 'ERROR', `CRITICAL: ${service.displayName} exceeded maximum restart attempts (${service.restartPolicy.maxRetries}). Placed in FAILED state.`);
      this.emit('service_change', service);
    }
  }

  /**
   * Health check probe for an individual service
   */
  async checkServiceHealth(service) {
    if (service.status === 'STOPPED' || service.status === 'FAILED') {
      return service.status;
    }

    if (!service.healthEndpoint) {
      // Daemon without HTTP port: healthy if PID active
      if (service.child && !service.child.killed) {
        service.status = 'HEALTHY';
      }
      return service.status;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(service.healthEndpoint, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        let details = null;
        try { details = await res.json(); } catch {}

        const prevStatus = service.status;
        service.status = 'HEALTHY';
        service.lastHealthCheck = new Date().toISOString();
        service.healthDetails = details;

        // If service was previously unhealthy or failed, mark as recovered
        if (prevStatus === 'UNHEALTHY' || prevStatus === 'FAILED' || service.restartCount > 0) {
          service.restartCount = 0; // reset retry counter on full recovery
          globalEventBus.publish(createEvent(EVENT_TYPES.SERVICE_RECOVERED, { serviceId: service.id, name: service.displayName }));
          const recoveryMsg = `✅ <b>SERVICE RECOVERED</b>\n\n` +
            `🟢 <b>Service:</b> ${service.displayName}\n` +
            `<b>Port:</b> <code>${service.port ? ':' + service.port : 'Worker Daemon'}</code>\n` +
            `<b>Status:</b> <code>HEALTHY (All health probes passing)</code>\n` +
            `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>`;
          sendDirectTelegramAlert(recoveryMsg, { rootDir }).catch(() => {});
        }
      } else {
        const prevStatus = service.status;
        service.status = 'DEGRADED';
        if (prevStatus === 'HEALTHY') {
          const outageMsg = `🚨 <b>SERVICE DEGRADATION ALERT</b>\n\n` +
            `🟡 <b>Service:</b> ${service.displayName}\n` +
            `<b>Port:</b> <code>${service.port ? ':' + service.port : 'Worker Daemon'}</code>\n` +
            `<b>HTTP Status:</b> <code>${res.status} ${res.statusText}</code>\n` +
            `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>`;
          sendDirectTelegramAlert(outageMsg, { rootDir }).catch(() => {});
        }
      }
    } catch (err) {
      if (service.status === 'HEALTHY') {
        service.status = 'UNHEALTHY';
        this.appendLog(service.id, 'ERROR', `Health check failed for ${service.displayName}: ${err.message}`);
        globalEventBus.publish(createEvent(EVENT_TYPES.SERVICE_FAILED, {
          serviceId: service.id,
          name: service.displayName,
          exitCode: null,
          reason: `Health check probe failed: ${err.message}`
        }));
        const outageMsg = `🚨 <b>SERVICE OUTAGE DETECTED</b>\n\n` +
          `🔴 <b>Service:</b> ${service.displayName}\n` +
          `<b>Port:</b> <code>${service.port ? ':' + service.port : 'Worker Daemon'}</code>\n` +
          `<b>Status:</b> <code>UNHEALTHY (Health Check Failed)</code>\n` +
          `<b>Reason:</b> <code>${err.message || 'Connection refused / timeout'}</code>\n` +
          `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>`;
        sendDirectTelegramAlert(outageMsg, { rootDir }).catch(() => {});
      }
    }

    return service.status;
  }

  /**
   * Polls health checks across all enabled services
   */
  async pollHealthChecks() {
    for (const service of this.services) {
      if (service.child) {
        await this.checkServiceHealth(service);
      }
    }
    this.emit('health_update', this.getServicesStatus());
  }

  /**
   * Starts all configured services
   */
  async startAll() {
    this.appendLog('core-handler', 'INFO', 'Starting all platform services...');
    this.startMonitoring();

    for (const service of this.services) {
      if (service.enabled) {
        await this.startService(service.id);
        // Stagger startups slightly to avoid CPU burst
        await new Promise(resolve => setTimeout(resolve, 600));
      }
    }
  }

  /**
   * Graceful shutdown of all services
   */
  async stopAll() {
    this.isShuttingDown = true;
    this.stopMonitoring();
    this.appendLog('core-handler', 'INFO', 'Shutting down all platform services...');

    for (const service of this.services) {
      await this.stopService(service.id);
    }
  }

  /**
   * Safe platform reboot: gracefully reboots all microservices
   */
  async restartAll() {
    const now = Date.now();
    if (this.lastRebootTime && (now - this.lastRebootTime) < 60000) {
      const waitSec = Math.ceil((60000 - (now - this.lastRebootTime)) / 1000);
      this.appendLog('core-handler', 'WARN', `SYSTEM REBOOT REJECTED: Cooldown active (${waitSec}s remaining)`);
      return { success: false, error: `Reboot cooldown in effect. Please wait ${waitSec}s before rebooting again.` };
    }
    this.lastRebootTime = now;

    this.appendLog('core-handler', 'WARN', 'SYSTEM REBOOT INITIATED: Restarting all platform microservices...');
    const alertMsg = `🔄 <b>PLATFORM SYSTEM REBOOT INITIATED</b>\n\n` +
      `<b>Trigger:</b> Remote command (/reboot)\n` +
      `<b>Action:</b> Graceful reload of all 15 microservices...\n` +
      `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>`;
    sendDirectTelegramAlert(alertMsg, { rootDir }).catch(() => {});

    // Stop all services
    for (const service of this.services) {
      if (service.child) {
        await this.stopService(service.id);
      }
    }

    this.isShuttingDown = false;
    await new Promise(r => setTimeout(r, 1500));
    await this.startAll();

    // Compile and push fresh post-reboot telemetry
    try {
      const { compilePlatformTelemetry } = await import('../../../packages/common/src/admin-auth.js');
      const telemetry = await compilePlatformTelemetry({ rootDir });
      const bootAlert = `🚀 <b>SYSTEM REBOOT COMPLETED — ALL PORTS ACTIVE</b>\n` +
        `📅 <i>${telemetry.timestamp}</i>\n\n` +
        telemetry.htmlReport;
      await sendDirectTelegramAlert(bootAlert, { rootDir });
    } catch {}

    return { success: true, message: 'All platform services restarted successfully.' };
  }

  /**
   * Returns current service statuses
   */
  getServicesStatus() {
    return this.services.map(s => ({
      id: s.id,
      displayName: s.displayName,
      description: s.description,
      port: s.port,
      status: s.status,
      pid: s.pid,
      startTime: s.startTime,
      restartCount: s.restartCount,
      lastHealthCheck: s.lastHealthCheck,
      healthDetails: s.healthDetails,
      criticality: s.criticality
    }));
  }

  /**
   * Host system telemetry (Section 31)
   */
  getSystemMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsagePercent = Math.round((usedMem / totalMem) * 100);

    const cpus = os.cpus();
    const uptimeSec = Math.round(os.uptime());

    return {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptimeSeconds: uptimeSec,
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Generic CPU',
      memory: {
        totalMb: Math.round(totalMem / (1024 * 1024)),
        usedMb: Math.round(usedMem / (1024 * 1024)),
        freeMb: Math.round(freeMem / (1024 * 1024)),
        usagePercent: memUsagePercent
      },
      timestamp: new Date().toISOString()
    };
  }
}
