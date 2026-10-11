import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CheckoutServer } from './server.js';

export function startCheckoutServer(port = null, options = {}) {
  const finalPort = port || Number(process.env.CHECKOUT_PORTAL_PORT || 7000);
  const checkoutServer = new CheckoutServer(options);
  const rawServer = checkoutServer.createServer();

  return new Promise(resolve => {
    const instance = rawServer.listen(finalPort, () => {
      console.log(`[Checkout Portal] Server listening on port ${finalPort}`);
      resolve({
        port: finalPort,
        close: () => new Promise(cb => instance.close(cb))
      });
    });
  });
}

// Auto-run if executed directly as main script
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startCheckoutServer();
}
