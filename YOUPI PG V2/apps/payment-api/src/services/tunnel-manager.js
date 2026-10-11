import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

/**
 * Cloudflare Tunnel Process Manager
 * Manages running user-provided cloudflared commands in the background with live log streaming.
 */
export class TunnelManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.status = 'STOPPED'; // 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR'
    this.command = null;
    this.logs = [];
    this.maxLogs = 200;
    this.pid = null;
    this.startedAt = null;
  }

  appendLog(line) {
    const entry = {
      timestamp: new Date().toISOString(),
      text: line.trim()
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.emit('log', entry);
  }

  getStatus() {
    return {
      status: this.status,
      command: this.command,
      pid: this.pid,
      startedAt: this.startedAt,
      isRunning: this.status === 'RUNNING' || this.status === 'STARTING',
      recentLogs: this.logs.slice(-50)
    };
  }

  start(rawCommand) {
    if (!rawCommand || !rawCommand.trim()) {
      throw new Error('Cloudflare Tunnel command cannot be empty.');
    }

    if (this.process && (this.status === 'RUNNING' || this.status === 'STARTING')) {
      this.stop();
    }

    const trimmed = rawCommand.trim();
    this.command = trimmed;
    this.status = 'STARTING';
    this.startedAt = new Date().toISOString();
    this.appendLog(`[TunnelManager] Launching tunnel command: ${trimmed}`);

    try {
      // Execute via shell (cmd.exe on Windows / sh on Unix) so tokens, flags, and paths execute cleanly
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
      const shellArgs = isWindows ? ['/c', trimmed] : ['-c', trimmed];

      const child = spawn(shell, shellArgs, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      this.process = child;
      this.pid = child.pid;
      this.status = 'RUNNING';

      child.stdout.on('data', data => {
        const text = data.toString();
        this.appendLog(`[STDOUT] ${text}`);
      });

      child.stderr.on('data', data => {
        const text = data.toString();
        this.appendLog(`[STDERR] ${text}`);
      });

      child.on('error', err => {
        this.status = 'ERROR';
        this.appendLog(`[ERROR] Process failed to spawn: ${err.message}`);
        this.emit('error', err);
      });

      child.on('close', code => {
        this.appendLog(`[EXIT] Tunnel process exited with code ${code}`);
        this.status = 'STOPPED';
        this.process = null;
        this.pid = null;
        this.emit('exit', code);
      });

      return this.getStatus();
    } catch (err) {
      this.status = 'ERROR';
      this.appendLog(`[ERROR] Exception spawning tunnel: ${err.message}`);
      throw err;
    }
  }

  stop() {
    if (!this.process) {
      this.status = 'STOPPED';
      this.pid = null;
      return this.getStatus();
    }

    this.appendLog(`[TunnelManager] Stopping tunnel process (PID: ${this.pid})...`);
    try {
      if (process.platform === 'win32' && this.pid) {
        spawn('taskkill', ['/pid', String(this.pid), '/f', '/t']);
      } else if (this.pid) {
        process.kill(this.pid, 'SIGTERM');
      }
    } catch (e) {
      this.appendLog(`[TunnelManager] Kill error notice: ${e.message}`);
    }

    this.process = null;
    this.status = 'STOPPED';
    this.pid = null;
    return this.getStatus();
  }
}

// Global singleton instance
export const globalTunnelManager = new TunnelManager();
