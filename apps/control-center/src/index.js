import { ControlCenterServer } from './server.js';
import { PORTS } from '../../../packages/common/src/ports.js';

async function main() {
  console.log('=============================================================================');
  console.log('       UNIFIED E-COMMERCE PLATFORM - CENTRAL CONTROL CENTER CONSOLE          ');
  console.log('=============================================================================');

  const server = new ControlCenterServer({
    port: PORTS.CONTROL_CENTER || 8090
  });

  await server.start();
}

main().catch(err => {
  console.error('[ControlCenter] Fatal startup error:', err);
  process.exit(1);
});
