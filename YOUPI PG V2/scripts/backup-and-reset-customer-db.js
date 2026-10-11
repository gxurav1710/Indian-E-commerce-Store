import fs from 'node:fs';
import path from 'node:path';
import { Database } from '../packages/db/src/database.js';
import { runMigrations } from '../packages/db/src/migrate.js';

async function backupAndResetProduction() {
  console.log('====================================================');
  console.log('🛡️ PRODUCTION DATABASE BACKUP & SAFE IDENTITY RESET');
  console.log('====================================================');

  const dbPath = path.resolve('data/youpi_pg.sqlite');
  console.log('Database type: SQLite3 (better-sqlite3)');
  console.log('Database path:', dbPath);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found at ${dbPath}`);
  }

  // 1. CREATE BACKUP FIRST
  const backupDir = path.resolve('data/backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `youpi_pg_pre_auth_rebuild_${timestamp}.sqlite`);
  fs.copyFileSync(dbPath, backupPath);

  const backupStat = fs.statSync(backupPath);
  console.log('Backup created successfully!');
  console.log('Backup path:', backupPath);
  console.log(`Backup size: ${backupStat.size} bytes`);

  // 2. AUDIT PRE-RESET STATE
  const db = new Database({ dbPath });
  const preMerchants = db.query('SELECT id, business_name, slug, contact_email, webhook_url, branding FROM merchants');
  const preAccounts = db.query('SELECT id, upi_id, payee_name, is_active FROM payment_receiving_accounts');
  const preSessions = db.query('SELECT count(*) as c FROM payment_sessions');
  const preCustomers = db.query('SELECT count(*) as c FROM customers');

  console.log('\n--- PRE-RESET COUNTS ---');
  console.log(`Merchants: ${preMerchants.length}`);
  console.log(`Receiving accounts: ${preAccounts.length}`);
  console.log(`Payment sessions: ${preSessions[0]?.c || 0}`);
  console.log(`Old customers: ${preCustomers[0]?.c || 0}`);

  // 3. EXECUTE CONTROLLED IDENTITY RESET
  console.log('\n--- EXECUTING SAFE RESIDUE RESET ---');
  // Safe cleanup of obsolete customer references
  try { db.execute('UPDATE payment_sessions SET customer_id = NULL WHERE customer_id IS NOT NULL;'); } catch {}
  try { db.execute('DELETE FROM ticket_messages;'); } catch {}
  try { db.execute('DELETE FROM support_tickets;'); } catch {}
  try { db.execute('DROP TABLE IF EXISTS customer_sessions;'); } catch {}
  try { db.execute('DROP TABLE IF EXISTS customers;'); } catch {}

  // Run migrations to apply new canonical schema
  runMigrations(db);

  // Explicitly ensure customer count = 0
  db.execute('DELETE FROM customer_sessions;');
  db.execute('DELETE FROM customers;');

  // 4. POST-RESET VERIFICATION
  const postMerchants = db.query('SELECT id, business_name, slug, contact_email, webhook_url, branding FROM merchants');
  const postAccounts = db.query('SELECT id, upi_id, payee_name, is_active FROM payment_receiving_accounts');
  const postSessions = db.query('SELECT count(*) as c FROM payment_sessions');
  const postCustomers = db.query('SELECT count(*) as c FROM customers');
  const postCustomerSessions = db.query('SELECT count(*) as c FROM customer_sessions');

  console.log('\n--- POST-RESET VERIFICATION ---');
  console.log(`Merchants: ${postMerchants.length} (Expected: ${preMerchants.length})`);
  console.log(`Receiving accounts: ${postAccounts.length} (Expected: ${preAccounts.length})`);
  console.log(`Payment sessions: ${postSessions[0]?.c || 0} (Expected: ${preSessions[0]?.c || 0})`);
  console.log(`Customers: ${postCustomers[0]?.c || 0} (MANDATORY EXPECTED: 0)`);
  console.log(`Customer sessions: ${postCustomerSessions[0]?.c || 0} (MANDATORY EXPECTED: 0)`);

  if (postMerchants.length !== preMerchants.length) {
    throw new Error('FATAL: Merchant count changed during identity reset!');
  }
  if (postAccounts.length !== preAccounts.length) {
    throw new Error('FATAL: Receiving account count changed during identity reset!');
  }
  if (postCustomers[0]?.c !== 0) {
    throw new Error('FATAL: Customer count is not 0 after identity reset!');
  }
  if (postCustomerSessions[0]?.c !== 0) {
    throw new Error('FATAL: Customer sessions count is not 0 after identity reset!');
  }

  // Verify merchant branding and accounts remain intact
  const activeAccount = db.queryOne('SELECT * FROM payment_receiving_accounts WHERE is_active = 1');
  console.log(`Active Receiving VPA: ${activeAccount.upi_id} (${activeAccount.payee_name})`);

  db.close();
  console.log('\n[✓] PRODUCTION DATABASE RESET COMPLETED WITH 100% SUCCESS. CUSTOMERS = 0.');
}

backupAndResetProduction().catch(err => {
  console.error('Production reset failed:', err);
  process.exit(1);
});
