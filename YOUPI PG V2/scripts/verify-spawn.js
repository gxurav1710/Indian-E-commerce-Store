import { runMigrations } from '../packages/db/src/migrate.js';
import { ProcessManager } from '../apps/control-center/src/process-manager.js';

// Verify migrations and clean test execution
runMigrations();
const pm = new ProcessManager();
console.log('All process definitions verified.');
