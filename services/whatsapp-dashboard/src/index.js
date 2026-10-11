import { WhatsAppDashboardServer } from './server.js';
import { PORTS } from '../../../packages/common/src/ports.js';

async function main() {
  console.log('=============================================================================');
  console.log('       UNIFIED E-COMMERCE PLATFORM - WHATSAPP BAILEYS GUI CONSOLE            ');
  console.log('=============================================================================');

  const server = new WhatsAppDashboardServer({
    port: PORTS.WHATSAPP_DASHBOARD || 4002
  });

  await server.start();
}

main().catch(err => {
  console.error('[WhatsAppDashboard] Fatal startup error:', err);
  process.exit(1);
});
