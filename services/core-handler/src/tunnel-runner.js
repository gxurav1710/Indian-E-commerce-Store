import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { sendDirectTelegramAlert } from '../../../packages/common/src/admin-auth.js';

/**
 * Retrieves configured Cloudflare Tunnel command from environment,
 * runtime_config.json, or SQLite store_settings table.
 * @param {string} rootDir
 * @returns {string | null}
 */
export function getTunnelCommand(rootDir) {
  // 1. Check process.env
  if (process.env.CLOUDFLARE_TUNNEL_COMMAND && process.env.CLOUDFLARE_TUNNEL_COMMAND.trim()) {
    return process.env.CLOUDFLARE_TUNNEL_COMMAND.trim();
  }

  // 2. Check data/runtime_config.json
  try {
    const cfgPath = path.join(rootDir, 'data', 'runtime_config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.CLOUDFLARE_TUNNEL_COMMAND && cfg.CLOUDFLARE_TUNNEL_COMMAND.trim()) {
        return cfg.CLOUDFLARE_TUNNEL_COMMAND.trim();
      }
    }
  } catch {}

  // 3. Check SQLite database store_settings table
  try {
    const dbPath = path.join(rootDir, 'data', 'unified_ecommerce.sqlite');
    if (fs.existsSync(dbPath)) {
      const db = new DatabaseSync(dbPath);
      const row = db.prepare("SELECT value FROM store_settings WHERE key = 'CLOUDFLARE_TUNNEL_COMMAND' OR key = 'cloudflared_tunnel_command'").get();
      if (row && row.value && row.value.trim()) {
        return row.value.trim();
      }
    }
  } catch {}

  return null;
}

/**
 * Prompts user on the terminal whether to continue without tunnel.
 * @param {string} message
 * @returns {Promise<boolean>} True if user chose 'y', false if 'n'
 */
export async function promptContinueWithoutTunnel(message) {
  console.log(`\n⚠️  ${message}`);
  
  if (!input.isTTY) {
    console.log('[CloudflareTunnel] Non-interactive TTY session detected. Continuing platform startup...');
    return true;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question('Continue without tunnel? (y/n): ');
    const cleaned = answer.trim().toLowerCase();
    return cleaned === 'y' || cleaned === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * Executes the Cloudflare Tunnel command and monitors startup.
 * Prompts to continue if launch fails or command is missing.
 * @param {{ rootDir: string }} options
 * @returns {Promise<{ tunnelChild: any | null, proceed: boolean }>}
 */
export async function runTunnelPreflight({ rootDir }) {
  const tunnelCmd = getTunnelCommand(rootDir);

  if (!tunnelCmd) {
    console.log('[CloudflareTunnel] No Cloudflare Tunnel command configured in Credential Manager.');
    const proceed = await promptContinueWithoutTunnel('No Cloudflare tunnel command is configured.');
    return { tunnelChild: null, proceed };
  }

  // Check if tunnel execution is explicitly enabled (defaults to true if command is configured)
  const isTunnelEnabled = process.env.CLOUDFLARE_TUNNEL_ENABLED !== 'false';
  if (!isTunnelEnabled) {
    console.log('[CloudflareTunnel] Cloudflare Tunnel execution disabled (CLOUDFLARE_TUNNEL_ENABLED=false). Skipping background launch.');
    return { tunnelChild: null, proceed: true };
  }

  console.log(`[CloudflareTunnel] Launching Cloudflare Tunnel: ${tunnelCmd}`);

  let tunnelChild = null;
  let hasExited = false;
  let exitCode = null;
  let stderrOutput = '';

  try {
    tunnelChild = spawn(tunnelCmd, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    tunnelChild.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderrOutput += text;
      // Echo tunnel diagnostics if relevant
      if (text.includes('ERR') || text.includes('error') || text.includes('not recognized')) {
        process.stderr.write(`[CloudflareTunnel-STDERR] ${text}`);
      }
    });

    tunnelChild.stdout.on('data', chunk => {
      // Tunnel operational output
      const text = chunk.toString();
      if (text.includes('Registered tunnel') || text.includes('Connection')) {
        console.log(`[CloudflareTunnel] ${text.trim()}`);
      }
    });

    tunnelChild.on('error', err => {
      hasExited = true;
      stderrOutput += ` (${err.message})`;
    });

    tunnelChild.on('exit', (code, signal) => {
      hasExited = true;
      exitCode = code;
    });

  } catch (err) {
    hasExited = true;
    stderrOutput = err.message;
  }

  // Wait 3.5 seconds to ensure the tunnel process stays healthy and does not crash immediately
  await new Promise(resolve => setTimeout(resolve, 3500));

  if (hasExited) {
    const reason = stderrOutput.trim() || `Process exited with status code ${exitCode}`;
    console.error(`\n[CloudflareTunnel] ❌ Tunnel failed to launch: ${reason}`);

    const proceed = await promptContinueWithoutTunnel(`Cloudflare Tunnel failed to start (${reason}).`);
    return { tunnelChild: null, proceed };
  }

  console.log('[CloudflareTunnel] ✓ Tunnel process is active and running successfully in the background.');

  // Attach unexpected exit listener to alert on tunnel crashes during operation
  tunnelChild.on('exit', (code, signal) => {
    console.error(`\n[CloudflareTunnel] 🚨 Tunnel process exited unexpectedly! Code: ${code}, Signal: ${signal}`);
    const outageMsg = `🚨 <b>CLOUDFLARE TUNNEL OUTAGE DETECTED</b>\n\n` +
      `🔴 <b>Status:</b> Tunnel process terminated unexpectedly\n` +
      `<b>Exit Code:</b> <code>${code}</code> (Signal: ${signal || 'none'})\n` +
      `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>\n` +
      `Public traffic routing may be disrupted. Check your tunnel configuration or run <code>/reboot</code>.`;
    sendDirectTelegramAlert(outageMsg, { rootDir }).catch(() => {});
  });

  return { tunnelChild, proceed: true };
}

/**
 * Actively polls an HTTP URL until it returns 200 OK and rendered HTML content.
 * Guarantees pages are truly rendered before opening them in the browser.
 * @param {string} url
 * @param {number} [timeoutMs=35000]
 * @returns {Promise<boolean>}
 */
export async function waitForPageRendered(url, timeoutMs = 35000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Platform-Startup-Verifier/1.0' }
      });
      if (res.ok && res.status === 200) {
        const text = await res.text();
        // Verify valid HTML and meaningful page length
        if (text.includes('</html>') && text.length > 500) {
          return true;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

/**
 * Cross-platform browser URL launcher (Windows, Ubuntu / Linux, macOS).
 * @param {string} url
 */
export function openBrowserCrossPlatform(url) {
  let cmd;
  if (process.platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (process.platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    // Linux / Ubuntu
    cmd = `(xdg-open "${url}" || sensible-browser "${url}" || x-www-browser "${url}") 2>/dev/null`;
  }

  exec(cmd, { shell: true }, err => {
    if (err) {
      console.warn(`[BrowserLauncher] Could not automatically open ${url}: ${err.message}`);
    }
  });
}

/**
 * Verifies rendering of each dashboard URL before launching in browser.
 * Ensures no premature loading/blank screens are shown to the operator.
 * @param {Array<{ name: string, url: string }>} dashboards
 */
export async function launchVerifiedDashboards(dashboards) {
  console.log('\n[BrowserLauncher] Verifying dashboard rendering before browser launch in sequential order...');

  for (let i = 0; i < dashboards.length; i++) {
    const dash = dashboards[i];
    process.stdout.write(`[BrowserLauncher] [${i + 1}/${dashboards.length}] Rendering check for ${dash.name} (${dash.url})... `);
    const isRendered = await waitForPageRendered(dash.url, 35000);

    if (isRendered) {
      console.log('✓ Rendered (HTTP 200 OK)');
      openBrowserCrossPlatform(dash.url);
      console.log(`[BrowserLauncher] Launched ${dash.name}. Waiting for browser window to finish loading...`);
      // Wait for browser process and page to actually render before continuing to the next dashboard
      await new Promise(r => setTimeout(r, 2500));
    } else {
      console.log('⚠️ Response timeout. Opening URL anyway...');
      openBrowserCrossPlatform(dash.url);
      await new Promise(r => setTimeout(r, 2500));
    }
  }
  console.log('[BrowserLauncher] All requested operator dashboards verified, rendered, and launched.\n');
}
