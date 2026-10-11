import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';

/**
 * Native Chromium / Chrome Browser Automation Launcher.
 * Controls installed Chrome or Microsoft Edge using Chrome DevTools Protocol (CDP)
 * with dedicated persistent profiles.
 * Zero external native / C++ compilation dependencies.
 */
export class BrowserLauncher {
  /**
   * Locates Chrome or Edge executable on host system.
   * @returns {string} Path to browser executable
   */
  static findBrowserExecutable() {
    const candidates = [
      // Chrome on Windows
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : '',
      // Edge on Windows (Always present on Windows 10/11)
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      // Linux
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      // MacOS
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ].filter(Boolean);

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    throw new Error('No compatible Chromium browser (Google Chrome or Microsoft Edge) found on host.');
  }

  /**
   * Launches a dedicated browser instance with persistent session profile.
   * @param {{
   *   url: string,
   *   profileDir: string,
   *   debuggingPort?: number,
   *   headless?: boolean
   * }} options
   */
  static launch(options) {
    const executable = BrowserLauncher.findBrowserExecutable();
    const port = options.debuggingPort || 9222;

    if (!fs.existsSync(options.profileDir)) {
      fs.mkdirSync(options.profileDir, { recursive: true });
    }

    const isLinux = process.platform === 'linux';
    const args = [
      `--user-data-dir=${path.resolve(options.profileDir)}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-translate',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
      ...(isLinux ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
      options.minimized ? '--window-position=-2400,-2400' : (options.headless ? '--headless=new' : '--start-maximized'),
      options.url
    ];

    const child = spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ...(isLinux && !process.env.DISPLAY ? { DISPLAY: ':0' } : {})
      }
    });

    child.unref();

    return {
      pid: child.pid,
      port,
      executable,
      profileDir: options.profileDir
    };
  }

  /**
   * Queries browser CDP targets to inspect open pages.
   * @param {number} port
   * @returns {Promise<any[]>}
   */
  static async getTargets(port = 9222) {
    return new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve([]);
          }
        });
      }).on('error', () => resolve([]));
    });
  }

  /**
   * Closes a specific target tab by ID via CDP.
   * @param {number} port
   * @param {string} targetId
   * @returns {Promise<boolean>}
   */
  static async closeTarget(port = 9222, targetId) {
    return new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/json/close/${targetId}`, () => {
        resolve(true);
      }).on('error', () => resolve(false));
    });
  }

  /**
   * Closes all open targets / windows for the specified debugging port.
   * @param {number} port
   */
  static async closeBrowser(port = 9222) {
    const targets = await BrowserLauncher.getTargets(port);
    for (const target of targets) {
      if (target.id) {
        await BrowserLauncher.closeTarget(port, target.id);
      }
    }
  }

  /**
   * Evaluates a JavaScript expression on a target page via WebSocket CDP.
   * @param {string} wsUrl
   * @param {string} expression
   * @returns {Promise<any>}
   */
  static async evaluate(wsUrl, expression) {
    if (!wsUrl) return null;
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          try { ws.close(); } catch {}
          resolve(null);
        }, 5000);

        ws.onopen = () => {
          ws.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
              expression,
              returnByValue: true,
              awaitPromise: true
            }
          }));
        };

        ws.onmessage = (event) => {
          clearTimeout(timeout);
          try {
            const data = JSON.parse(event.data);
            ws.close();
            resolve(data.result?.result?.value);
          } catch {
            ws.close();
            resolve(null);
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  }
}
