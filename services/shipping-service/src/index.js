import { ShippingServiceServer } from './server.js';
import { PORTS } from '../../../packages/common/src/ports.js';

async function main() {
  console.log('=============================================================================');
  console.log('   UNIFIED E-COMMERCE PLATFORM - BACKGROUND SHIPPING CALCULATION SERVICE    ');
  console.log('=============================================================================');

  const server = new ShippingServiceServer({
    port: PORTS.SHIPPING_SERVICE || 5003
  });

  await server.start();
}

main().catch(err => {
  console.error('[ShippingService] Fatal error starting service:', err);
  process.exit(1);
});
