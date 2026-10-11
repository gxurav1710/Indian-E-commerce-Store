import assert from 'node:assert/strict';
import { Database } from '../packages/db/src/database.js';

async function verifyIsolation() {
  console.log('============================================================');
  console.log('🔍 VERIFYING PRODUCTION RESET AND DEVELOPMENT DATABASE ISOLATION');
  console.log('============================================================');

  // 1. Check Production Database
  const prodDb = new Database({ dbPath: path.resolve('data/youpi_pg.sqlite') });
  const prodMerchants = prodDb.queryOne('SELECT count(*) as c FROM merchants').c;
  const prodAccounts = prodDb.queryOne('SELECT count(*) as c FROM payment_receiving_accounts').c;
  const prodCustomers = prodDb.queryOne('SELECT count(*) as c FROM customers').c;
  const prodSessions = prodDb.queryOne('SELECT count(*) as c FROM payment_sessions').c;
  const prodObservations = prodDb.queryOne('SELECT count(*) as c FROM payment_observations').c;
  const prodTickets = prodDb.queryOne('SELECT count(*) as c FROM support_tickets').c;
  const prodMessages = prodDb.queryOne('SELECT count(*) as c FROM ticket_messages').c;
  const prodWebhooks = prodDb.queryOne('SELECT count(*) as c FROM webhook_deliveries').c;
  const prodAudit = prodDb.queryOne('SELECT count(*) as c FROM audit_logs').c;

  console.log('\n--- PRODUCTION DATABASE COUNTS ---');
  console.table({
    merchants: prodMerchants,
    receivingAccounts: prodAccounts,
    customers: prodCustomers,
    paymentSessions: prodSessions,
    observations: prodObservations,
    supportTickets: prodTickets,
    ticketMessages: prodMessages,
    webhookDeliveries: prodWebhooks,
    auditLogs: prodAudit
  });

  // Verify production acceptance criteria
  assert.equal(prodMerchants, 1, 'Production merchant must be preserved');
  assert.equal(prodAccounts, 1, 'Production receiving account must be preserved');
  assert.equal(prodCustomers, 0, 'Production customers must be 0');
  assert.equal(prodSessions, 0, 'Production payment sessions must be 0');
  assert.equal(prodObservations, 0, 'Production observations must be 0');
  assert.equal(prodTickets, 0, 'Production support tickets must be 0');
  assert.equal(prodMessages, 0, 'Production ticket messages must be 0');
  assert.equal(prodWebhooks, 0, 'Production webhook deliveries must be 0');
  assert.equal(prodAudit, 8, 'Production audit logs should only retain merchant & receiving account config');

  const merchantRow = prodDb.queryOne('SELECT id, business_name, slug, webhook_url, branding FROM merchants');
  console.log('Preserved Merchant:', merchantRow);
  const accountRow = prodDb.queryOne('SELECT id, upi_id, payee_name, is_active, is_slot_busy, current_active_session_id FROM payment_receiving_accounts');
  console.log('Preserved Receiving Account:', accountRow);

  prodDb.close();

  // 2. Check Development Database (MUST BE UNTOUCHED)
  const devDb = new Database({ dbPath: 'D:/YOUPI PG/data/youpi_pg.sqlite' });
  const devMerchants = devDb.queryOne('SELECT count(*) as c FROM merchants').c;
  const devAccounts = devDb.queryOne('SELECT count(*) as c FROM payment_receiving_accounts').c;
  const devCustomers = devDb.queryOne('SELECT count(*) as c FROM customers').c;
  const devSessions = devDb.queryOne('SELECT count(*) as c FROM payment_sessions').c;
  const devObservations = devDb.queryOne('SELECT count(*) as c FROM payment_observations').c;
  const devTickets = devDb.queryOne('SELECT count(*) as c FROM support_tickets').c;
  const devMessages = devDb.queryOne('SELECT count(*) as c FROM ticket_messages').c;
  const devWebhooks = devDb.queryOne('SELECT count(*) as c FROM webhook_deliveries').c;
  const devAudit = devDb.queryOne('SELECT count(*) as c FROM audit_logs').c;

  console.log('\n--- DEVELOPMENT DATABASE COUNTS (MUST BE UNTOUCHED) ---');
  console.table({
    merchants: devMerchants,
    receivingAccounts: devAccounts,
    customers: devCustomers,
    paymentSessions: devSessions,
    observations: devObservations,
    supportTickets: devTickets,
    ticketMessages: devMessages,
    webhookDeliveries: devWebhooks,
    auditLogs: devAudit
  });

  // Verify development database is completely untouched
  assert.equal(devMerchants, 1, 'Development merchant count intact');
  assert.equal(devAccounts, 1, 'Development receiving account count intact');
  assert.equal(devCustomers, 2, 'Development customer count intact');
  assert.equal(devSessions, 25, 'Development payment sessions count intact');
  assert.equal(devObservations, 482659, 'Development observations count intact');
  assert.equal(devTickets, 2, 'Development tickets count intact');
  assert.equal(devMessages, 5, 'Development ticket messages count intact');
  assert.equal(devWebhooks, 22, 'Development webhooks count intact');
  assert.equal(devAudit, 533, 'Development audit logs count intact');

  devDb.close();

  console.log('============================================================');
  console.log('🎉 DATABASE ISOLATION AND COUNTS VERIFIED 100%');
  console.log('============================================================');
}

verifyIsolation().catch(err => {
  console.error('ISOLATION VERIFICATION FAILED:', err);
  process.exit(1);
});
