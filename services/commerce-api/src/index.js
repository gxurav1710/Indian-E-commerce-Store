import { CommerceApiServer } from './server.js';
import { PORTS } from '../../../packages/common/src/ports.js';

async function main() {
  console.log('=============================================================================');
  console.log('         UNIFIED E-COMMERCE PLATFORM - COMMERCE REST API SERVICE              ');
  console.log('=============================================================================');

  const server = new CommerceApiServer({
    port: PORTS.COMMERCE_API || 5001
  });

  await server.start();
}

main().catch(err => {
  console.error('[CommerceAPI] Fatal startup error:', err);
  process.exit(1);
});
