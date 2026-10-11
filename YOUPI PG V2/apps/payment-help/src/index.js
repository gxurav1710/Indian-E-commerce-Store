import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HelpServer } from './server.js';
import { getDatabase, runMigrations } from '@youpi/db';

export function startHelpServer(port = null, options = {}) {
  const finalPort = port || Number(process.env.HELP_PORTAL_PORT || 3000);
  const db = options.db || getDatabase();
  runMigrations(db);

  const helpServer = new HelpServer({ db, ...options });
  const rawServer = helpServer.createServer();

  return new Promise(resolve => {
    const instance = rawServer.listen(finalPort, () => {
      console.log(`[Payment Help Portal] Server listening on port ${finalPort}`);
      resolve({
        port: finalPort,
        close: () => new Promise(cb => instance.close(cb))
      });
    });
  });
}

// Auto-run if executed directly as main script
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startHelpServer();
}
