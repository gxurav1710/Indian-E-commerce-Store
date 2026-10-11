import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Database, runMigrations } from '../packages/db/src/index.js';

async function executeCleanReset() {
  console.log('============================================================');
  console.log('🛡️ EXECUTING ZERO-CUSTOMER CLEAN RESET ON DEV AND PROD');
  console.log('============================================================');

  // --- 1. PRODUCTION RESET ---
  const prodPath = path.resolve('data/youpi_pg.sqlite');
  console.log('\n[1] Processing Production Database:', prodPath);

  const prodBackupDir = path.resolve('data/backups');
  if (!fs.existsSync(prodBackupDir)) {
    fs.mkdirSync(prodBackupDir, { recursive: true });
  }
  const prodBackupPath = path.join(prodBackupDir, `prod_pre_auth_reset_${Date.now()}.sqlite`);
  fs.copyFileSync(prodPath, prodBackupPath);
  console.log('  [✓] Created production backup at:', prodBackupPath);

  const prodDb = new Database({ dbPath: prodPath });
  const prodMerchantsBefore = prodDb.query('SELECT count(*) as c FROM merchants')[0].c;
  const prodAccountsBefore = prodDb.query('SELECT count(*) as c FROM payment_receiving_accounts')[0].c;

  try { prodDb.execute('UPDATE payment_sessions SET customer_id = NULL WHERE customer_id IS NOT NULL;'); } catch {}
  try { prodDb.execute('DELETE FROM ticket_messages;'); } catch {}
  try { prodDb.execute('DELETE FROM support_tickets;'); } catch {}
  try { prodDb.execute('DROP TABLE IF EXISTS customer_sessions;'); } catch {}
  try { prodDb.execute('DROP TABLE IF EXISTS customers;'); } catch {}

  runMigrations(prodDb);

  prodDb.execute('DELETE FROM customer_sessions;');
  prodDb.execute('DELETE FROM customers;');

  const prodCustomers = prodDb.query('SELECT count(*) as c FROM customers')[0].c;
  const prodCustomerSessions = prodDb.query('SELECT count(*) as c FROM customer_sessions')[0].c;
  const prodMerchantsAfter = prodDb.query('SELECT count(*) as c FROM merchants')[0].c;
  const prodAccountsAfter = prodDb.query('SELECT count(*) as c FROM payment_receiving_accounts')[0].c;

  assert.equal(prodCustomers, 0, 'Production customers must be 0');
  assert.equal(prodCustomerSessions, 0, 'Production customer sessions must be 0');
  assert.equal(prodMerchantsAfter, prodMerchantsBefore, 'Production merchants must remain intact');
  assert.equal(prodAccountsAfter, prodAccountsBefore, 'Production receiving accounts must remain intact');

  const prodAccount = prodDb.query('SELECT upi_id, payee_name, is_active FROM payment_receiving_accounts WHERE is_active = 1')[0];
  console.log(`  [✓] Production verified: Customers=0, Sessions=0, Merchants=${prodMerchantsAfter}, Active VPA=${prodAccount.upi_id}`);
  prodDb.close();

  // --- 2. DEVELOPMENT RESET ---
  const devPath = 'D:/YOUPI PG/data/youpi_pg.sqlite';
  console.log('\n[2] Processing Development Database:', devPath);

  const devBackupDir = 'D:/YOUPI PG/data/backups';
  if (!fs.existsSync(devBackupDir)) {
    fs.mkdirSync(devBackupDir, { recursive: true });
  }
  const devBackupPath = path.join(devBackupDir, `dev_pre_auth_reset_${Date.now()}.sqlite`);
  fs.copyFileSync(devPath, devBackupPath);
  console.log('  [✓] Created dev backup at:', devBackupPath);

  const devDb = new Database({ dbPath: devPath });
  const devMerchantsBefore = devDb.query('SELECT count(*) as c FROM merchants')[0].c;
  const devAccountsBefore = devDb.query('SELECT count(*) as c FROM payment_receiving_accounts')[0].c;
  const devObsBefore = devDb.query('SELECT count(*) as c FROM payment_observations')[0].c;

  try { devDb.execute('UPDATE payment_sessions SET customer_id = NULL WHERE customer_id IS NOT NULL;'); } catch {}
  try { devDb.execute('DELETE FROM ticket_messages;'); } catch {}
  try { devDb.execute('DELETE FROM support_tickets;'); } catch {}
  try { devDb.execute('DROP TABLE IF EXISTS customer_sessions;'); } catch {}
  try { devDb.execute('DROP TABLE IF EXISTS customers;'); } catch {}

  runMigrations(devDb);

  devDb.execute('DELETE FROM customer_sessions;');
  devDb.execute('DELETE FROM customers;');

  const devCustomers = devDb.query('SELECT count(*) as c FROM customers')[0].c;
  const devCustomerSessions = devDb.query('SELECT count(*) as c FROM customer_sessions')[0].c;
  const devMerchantsAfter = devDb.query('SELECT count(*) as c FROM merchants')[0].c;
  const devAccountsAfter = devDb.query('SELECT count(*) as c FROM payment_receiving_accounts')[0].c;
  const devObsAfter = devDb.query('SELECT count(*) as c FROM payment_observations')[0].c;

  assert.equal(devCustomers, 0, 'Dev customers must be 0');
  assert.equal(devCustomerSessions, 0, 'Dev customer sessions must be 0');
  assert.equal(devMerchantsAfter, devMerchantsBefore, 'Dev merchants must remain intact');
  assert.equal(devAccountsAfter, devAccountsBefore, 'Dev receiving accounts must remain intact');
  assert.equal(devObsAfter, devObsBefore, 'Dev observations must remain 100% intact');

  console.log(`  [✓] Dev verified: Customers=0, Sessions=0, Merchants=${devMerchantsAfter}, Observations=${devObsAfter}`);
  devDb.close();

  console.log('\n============================================================');
  console.log('🎉 BOTH DEV & PROD FINISHED CLEANLY WITH CUSTOMER COUNT = 0');
  console.log('============================================================');
}

executeCleanReset().catch(err => {
  console.error('Reset failed:', err);
  process.exit(1);
});
