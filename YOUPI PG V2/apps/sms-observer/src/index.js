import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SmsObserverServer } from './server.js';
import { SmsObserverService } from './sms-service.js';

export function startSmsObserver(port = null, options = {}) {
  const finalPort = port || Number(process.env.SMS_OBSERVER_PORT || 6002);
  const service = new SmsObserverService(options);
  const observerServer = new SmsObserverServer({ service, ...options });
  const rawServer = observerServer.createServer();

  return new Promise(resolve => {
    const instance = rawServer.listen(finalPort, () => {
      console.log(`[SMS Observer] Service listening on port ${finalPort}`);
      resolve({
        service,
        port: finalPort,
        close: () => new Promise(cb => {
          service.stop();
          instance.close(cb);
        })
      });
    });
  });
}

// Auto-run if executed directly as main script
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startSmsObserver();
}
