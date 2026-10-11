import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS } from '../../../packages/common/src/ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

const rootEnv = path.join(rootDir, '.env');
if (fs.existsSync(rootEnv) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(rootEnv);
  } catch {}
}

const command = process.argv[2] || 'status';
const targetService = process.argv[3] || null;

const CORE_URL = `http://localhost:${PORTS.CORE_HANDLER || 8085}`;

async function main() {
  try {
    if (command === 'status') {
      const res = await fetch(`${CORE_URL}/api/v1/services`);
      if (!res.ok) throw new Error(`Core Handler unreachable at ${CORE_URL}`);
      const data = await res.json();

      console.log('\n=============================================================================');
      console.log('                 UNIFIED E-COMMERCE PLATFORM SERVICE STATUS                   ');
      console.log('=============================================================================');
      console.table(data.services.map(s => ({
        ID: s.id,
        Name: s.displayName,
        Port: s.port || 'Worker',
        Status: s.status,
        PID: s.pid || '-',
        Retries: s.restartCount,
        Critical: s.criticality
      })));

      const metricRes = await fetch(`${CORE_URL}/api/v1/metrics`);
      if (metricRes.ok) {
        const m = await metricRes.json();
        console.log(`\nHost: ${m.metrics.hostname} | Uptime: ${Math.round(m.metrics.uptimeSeconds / 60)}m | RAM Usage: ${m.metrics.memory.usagePercent}% (${m.metrics.memory.usedMb}MB / ${m.metrics.memory.totalMb}MB)`);
      }
    } else if (command === 'start' || command === 'stop' || command === 'restart') {
      if (!targetService) {
        console.error(`Usage: node cli.js ${command} <service-id>`);
        process.exit(1);
      }
      const res = await fetch(`${CORE_URL}/api/v1/services/${targetService}/${command}`, { method: 'POST' });
      const result = await res.json();
      console.log(`[CoreHandler] ${command.toUpperCase()} ${targetService}:`, result);
    } else {
      console.log('Commands: status, start <service>, stop <service>, restart <service>');
    }
  } catch (err) {
    console.error(`[CLI Error] Could not connect to Core Handler (${CORE_URL}):`, err.message);
  }
}

main();
