import fs from 'node:fs';
import path from 'node:path';
import { Database } from '../packages/db/src/database.js';

async function auditDatabase() {
  console.log('=== YOUPI PG DATABASE AUDIT ===');

  const prodDataDb = path.resolve('data/youpi_pg.sqlite');
  console.log('Production local DB path:', prodDataDb);
  console.log('Exists:', fs.existsSync(prodDataDb));

  if (!fs.existsSync(prodDataDb)) {
    console.log('Error: DB file does not exist');
    return;
  }

  const db = new Database({ dbPath: prodDataDb });
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
  console.log('\n--- TABLES ---');
  for (const t of tables) {
    if (t.name.startsWith('sqlite_')) continue;
    const count = db.queryOne(`SELECT count(*) as c FROM ${t.name}`);
    console.log(`Table ${t.name}: ${count.c} rows`);
  }

  console.log('\n--- MERCHANTS ---');
  const merchants = db.query('SELECT id, business_name, slug, contact_email, webhook_url, branding FROM merchants');
  console.log(JSON.stringify(merchants, null, 2));

  console.log('\n--- RECEIVING ACCOUNTS ---');
  const accounts = db.query('SELECT id, merchant_id, upi_id, payee_name, is_active, is_slot_busy, current_active_session_id FROM payment_receiving_accounts');
  console.log(JSON.stringify(accounts, null, 2));

  console.log('\n--- CUSTOMERS ---');
  const customers = db.query('SELECT id, merchant_id, phone_number, full_name, created_at FROM customers');
  console.log(`Customer count: ${customers.length}`);
  console.log(JSON.stringify(customers.slice(0, 5), null, 2));

  console.log('\n--- PAYMENT SESSIONS ---');
  const sessions = db.query('SELECT id, merchant_id, customer_id, order_id, amount_paise, status, method FROM payment_sessions');
  console.log(`Payment session count: ${sessions.length}`);
  console.log(JSON.stringify(sessions.slice(0, 5), null, 2));

  console.log('\n--- OBSERVATIONS ---');
  const obsCount = db.queryOne('SELECT count(*) as c FROM payment_observations');
  console.log(`Observation count: ${obsCount.c}`);

  console.log('\n--- SUPPORT TICKETS & MESSAGES ---');
  const ticketCount = db.queryOne('SELECT count(*) as c FROM support_tickets');
  const msgCount = db.queryOne('SELECT count(*) as c FROM ticket_messages');
  console.log(`Support ticket count: ${ticketCount.c}`);
  console.log(`Ticket message count: ${msgCount.c}`);

  console.log('\n--- WEBHOOK DELIVERIES ---');
  const webhookCount = db.queryOne('SELECT count(*) as c FROM webhook_deliveries');
  console.log(`Webhook delivery count: ${webhookCount.c}`);

  console.log('\n--- AUDIT LOGS ---');
  const auditCount = db.queryOne('SELECT count(*) as c FROM audit_logs');
  console.log(`Audit log count: ${auditCount.c}`);

  db.close();
}

auditDatabase().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
