import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GmailObserverServer } from './server.js';
import { GmailPoller } from './gmail-poller.js';

export function startGmailObserver(port = null, options = {}) {
  const finalPort = port || Number(process.env.GMAIL_OBSERVER_PORT || 6003);
  const poller = new GmailPoller(options);
  const observerServer = new GmailObserverServer({ poller, ...options });
  const rawServer = observerServer.createServer();

  return new Promise(resolve => {
    const instance = rawServer.listen(finalPort, () => {
      console.log(`[Gmail Observer] Service listening on port ${finalPort}`);
      resolve({
        poller,
        port: finalPort,
        close: () => new Promise(cb => {
          poller.stop();
          instance.close(cb);
        })
      });
    });
  });
}

// Auto-run if executed directly as main script
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startGmailObserver();
}
