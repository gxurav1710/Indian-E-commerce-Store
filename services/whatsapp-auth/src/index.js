import { WhatsAppAuthServer } from './server.js';
import { PORTS } from '../../../packages/common/src/ports.js';

async function main() {
  console.log('=============================================================================');
  console.log('       UNIFIED E-COMMERCE PLATFORM - WHATSAPP AUTH CORE API SERVICE          ');
  console.log('=============================================================================');

  const server = new WhatsAppAuthServer({
    port: PORTS.WHATSAPP_AUTH_API || 4000
  });

  await server.start();
}

main().catch(err => {
  console.error('[WhatsAppAuth] Fatal startup error:', err);
  process.exit(1);
});
