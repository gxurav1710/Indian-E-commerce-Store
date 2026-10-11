import { StorefrontServer } from './server.js';
import { PORTS } from '../../../packages/common/src/ports.js';

async function main() {
  console.log('=============================================================================');
  console.log('            UNIFIED E-COMMERCE PLATFORM - STOREFRONT SERVICE                 ');
  console.log('=============================================================================');

  const server = new StorefrontServer({
    port: PORTS.STOREFRONT || 5000
  });

  await server.start();
}

main().catch(err => {
  console.error('[Storefront] Fatal startup error:', err);
  process.exit(1);
});
