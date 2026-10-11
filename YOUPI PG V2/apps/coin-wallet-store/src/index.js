import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoinWalletStoreServer } from './server.js';

export function startCoinWalletStore(port = null, options = {}) {
  const finalPort = port || Number(process.env.COIN_STORE_PORT || 5000);
  const storeServer = new CoinWalletStoreServer(options);
  const rawServer = storeServer.createServer();

  return new Promise(resolve => {
    const instance = rawServer.listen(finalPort, () => {
      console.log(`[Coin Wallet Store] Demo Store online at http://localhost:${finalPort}`);
      resolve({
        server: storeServer,
        port: finalPort,
        close: () => new Promise(cb => instance.close(cb))
      });
    });
  });
}

// Auto-run if executed directly as main script
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startCoinWalletStore();
}
