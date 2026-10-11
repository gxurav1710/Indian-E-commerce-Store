import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreProcessManager } from './process-manager.js';
import { CoreHandlerServer } from './server.js';
import { PORTS } from '../../../packages/common/src/ports.js';
import { runTunnelPreflight, launchVerifiedDashboards } from './tunnel-runner.js';
import { sendDirectTelegramAlert, compilePlatformTelemetry } from '../../../packages/common/src/admin-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

// Automatically load root .env if present
const rootEnv = path.join(rootDir, '.env');
if (fs.existsSync(rootEnv) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(rootEnv);
  } catch {}
}

async function main() {
  console.log('=============================================================================');
  console.log('  UNIFIED E-COMMERCE PLATFORM - CORE HANDLER SERVICE MANAGER');
  console.log('=============================================================================');

  let activeTunnelChild = null;

  // 1. Pre-flight Cloudflare Tunnel Runner
  console.log('[CoreHandler] Running pre-flight Cloudflare Tunnel orchestration...');
  const { tunnelChild, proceed } = await runTunnelPreflight({ rootDir });
  activeTunnelChild = tunnelChild;

  if (!proceed) {
    console.log('\n[CoreHandler] Startup aborted by operator. All systems, ports, and processes closed.');
    if (activeTunnelChild) {
      try { activeTunnelChild.kill(); } catch {}
    }
    process.exit(0);
  }

  // 2. Initialize and Start Core Process Manager & Server
  const processManager = new CoreProcessManager();
  const server = new CoreHandlerServer({
    port: PORTS.CORE_HANDLER || 8085,
    processManager
  });

  await server.start();

  // 3. Start orchestrating all platform microservices
  console.log('[CoreHandler] Launching platform services...');
  await processManager.startAll();

  // 3b. Dispatch Deep Boot Telemetry Alert to Telegram
  try {
    console.log('[CoreHandler] Compiling multi-point platform boot telemetry for Telegram...');
    // Give background services a moment to finish port binding
    await new Promise(r => setTimeout(r, 2000));
    const telemetry = await compilePlatformTelemetry({ rootDir });
    const bootAlert = `🚀 <b>SERVER BOOT COMPLETED — ALL SYSTEMS ACTIVE</b>\n` +
      `📅 <i>${telemetry.timestamp}</i>\n\n` +
      telemetry.htmlReport;
    await sendDirectTelegramAlert(bootAlert, { rootDir });
  } catch (telErr) {
    console.warn('[CoreHandler] Could not send boot telemetry alert:', telErr.message);
  }

  // 4. Auto-launch verified rendered dashboards in browser (Localhost links only in strict sequence):
  //    1st: YouPi PG Merchant Dashboard (http://localhost:6001)
  //    2nd: WhatsApp Berry Dashboard (http://localhost:4002)
  //    3rd: Central Control Center (http://localhost:8090)
  if (process.env.AUTO_OPEN_BROWSER !== 'false') {
    const operatorDashboards = [
      { name: 'YouPi PG Merchant Dashboard', url: `http://localhost:${PORTS.MERCHANT_ADMIN || 6001}` },
      { name: 'WhatsApp Berry Dashboard', url: `http://localhost:${PORTS.WHATSAPP_DASHBOARD || 4002}` },
      { name: 'Central Control Center', url: `http://localhost:${PORTS.CONTROL_CENTER || 8090}` }
    ];

    launchVerifiedDashboards(operatorDashboards).catch(err => {
      console.warn('[CoreHandler] Dashboard launcher notice:', err.message);
    });
  }

  // Handle termination signals gracefully
  const shutdown = async signal => {
    console.log(`\n[CoreHandler] Received ${signal}, shutting down all managed services...`);

    // Dispatch Shutdown Alert to Telegram
    const shutdownMsg = `🛑 <b>SERVER SHUTDOWN INITIATED</b>\n\n` +
      `<b>Signal:</b> <code>${signal}</code>\n` +
      `<b>Time:</b> <code>${new Date().toLocaleString('en-GB')}</code>\n` +
      `All 15 background microservices and Cloudflare tunnel processes are stopping.`;
    try {
      await sendDirectTelegramAlert(shutdownMsg, { rootDir });
    } catch {}

    if (activeTunnelChild) {
      try {
        console.log('[CoreHandler] Terminating background Cloudflare Tunnel process...');
        activeTunnelChild.kill();
      } catch {}
    }
    await processManager.stopAll();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('[CoreHandler] Fatal startup error:', err);
  process.exit(1);
});
