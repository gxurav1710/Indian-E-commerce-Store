import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminServer } from './server.js';
import { getDatabase, runMigrations } from '@youpi/db';

export function startAdminServer(port = null, options = {}) {
  const finalPort = port || Number(process.env.MERCHANT_ADMIN_PORT || 6001);
  const db = options.db || getDatabase();
  runMigrations(db);

  const adminServer = new AdminServer({ db, ...options });
  const rawServer = adminServer.createServer();

  return new Promise(resolve => {
    const instance = rawServer.listen(finalPort, () => {
      console.log(`[Merchant Admin] Server listening on port ${finalPort}`);
      resolve({
        port: finalPort,
        close: () => new Promise(cb => instance.close(cb))
      });
    });
  });
}

// Auto-run if executed directly as main script
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startAdminServer();
}
