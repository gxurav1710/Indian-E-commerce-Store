import { NotificationDispatcher } from './dispatcher.js';
import { NotificationServer } from './server.js';
import { PORTS } from '../../../packages/common/src/ports.js';

async function main() {
  console.log('=============================================================================');
  console.log('       UNIFIED E-COMMERCE PLATFORM - WHATSAPP NOTIFICATION SERVICE           ');
  console.log('=============================================================================');

  const dispatcher = new NotificationDispatcher();
  dispatcher.startListening();

  const server = new NotificationServer({
    port: PORTS.NOTIFICATION_SERVICE || 5002,
    dispatcher
  });

  await server.start();
}

main().catch(err => {
  console.error('[NotificationService] Fatal startup error:', err);
  process.exit(1);
});
