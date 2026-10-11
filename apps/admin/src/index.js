import { AdminPanelServer } from './server.js';
import { PORTS } from '../../../packages/common/src/ports.js';

async function main() {
  console.log('=============================================================================');
  console.log('           UNIFIED E-COMMERCE PLATFORM - ADMIN PANEL SERVICE                 ');
  console.log('=============================================================================');

  const server = new AdminPanelServer({
    port: PORTS.ADMIN_PANEL || 5050
  });

  await server.start();
}

main().catch(err => {
  console.error('[AdminPanel] Fatal startup error:', err);
  process.exit(1);
});
