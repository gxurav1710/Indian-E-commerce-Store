import fs from 'node:fs';
import path from 'node:path';
import { Database } from '../packages/db/src/database.js';
import { runMigrations } from '../packages/db/src/migrate.js';

async function applyIdentitySchema() {
  console.log('=== APPLYING IDENTITY SCHEMA & VERIFYING ZERO CUSTOMER RESIDUE (PROD) ===');
  const dbPath = path.resolve('data/youpi_pg.sqlite');
  console.log('Database path:', dbPath);

  const backupDir = path.resolve('data/backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const backupPath = path.join(backupDir, `prod_backup_${Date.now()}.sqlite`);
  fs.copyFileSync(dbPath, backupPath);
  console.log('Backup saved at:', backupPath);

  const db = new Database({ dbPath });
  const merchantsBefore = db.query('SELECT * FROM merchants');
  const accountsBefore = db.query('SELECT * FROM payment_receiving_accounts');
  console.log(`Pre-check: ${merchantsBefore.length} merchants, ${accountsBefore.length} receiving accounts`);

  try { db.execute('UPDATE payment_sessions SET customer_id = NULL WHERE customer_id IS NOT NULL;'); } catch {}
  try { db.execute('DELETE FROM ticket_messages;'); } catch {}
  try { db.execute('DELETE FROM support_tickets;'); } catch {}
  try { db.execute('DROP TABLE IF EXISTS customer_sessions;'); } catch {}
  try { db.execute('DROP TABLE IF EXISTS customers;'); } catch {}

  runMigrations(db);

  db.execute('DELETE FROM customer_sessions;');
  db.execute('DELETE FROM customers;');

  const merchantsAfter = db.query('SELECT * FROM merchants');
  const accountsAfter = db.query('SELECT * FROM payment_receiving_accounts');
  const customersAfter = db.query('SELECT count(*) as c FROM customers');
  const sessionsAfter = db.query('SELECT count(*) as c FROM customer_sessions');

  console.log(`Post-check: ${merchantsAfter.length} merchants, ${accountsAfter.length} receiving accounts`);
  console.log(`Customers: ${customersAfter[0].c}`);
  console.log(`Customer sessions: ${sessionsAfter[0].c}`);

  if (customersAfter[0].c !== 0 || sessionsAfter[0].c !== 0) {
    throw new Error('Customer count must be 0');
  }
  if (merchantsAfter.length !== merchantsBefore.length) {
    throw new Error('Merchant count changed');
  }

  db.close();
  console.log('PROD IDENTITY SCHEMA APPLIED SUCCESSFULLY. CUSTOMERS = 0.');
}

applyIdentitySchema().catch(err => {
  console.error(err);
  process.exit(1);
});
