import { WhatsAppWorkerServer } from './server.js';
import { PORTS } from '../../../packages/common/src/ports.js';

async function main() {
  console.log('=============================================================================');
  console.log('       UNIFIED E-COMMERCE PLATFORM - WHATSAPP WORKER DAEMON SERVICE          ');
  console.log('=============================================================================');

  const server = new WhatsAppWorkerServer({
    port: PORTS.WHATSAPP_WORKER || 4001
  });

  await server.start();
}

main().catch(err => {
  console.error('[WhatsAppWorker] Fatal startup error:', err);
  process.exit(1);
});
