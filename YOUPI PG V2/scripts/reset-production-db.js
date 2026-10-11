import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Database } from '../packages/db/src/database.js';

async function resetProductionDatabase() {
  console.log('============================================================');
  console.log('🚀 TARGETED PRODUCTION DATABASE RESET');
  console.log('============================================================');

  const prodDbPath = path.resolve('data/youpi_pg.sqlite');
  console.log('Target Database Path:', prodDbPath);

  // Absolute safety assertions
  assert.ok(
    prodDbPath.endsWith('youpi_pg.sqlite'),
    'CRITICAL SAFETY ERROR: Target path must be youpi_pg.sqlite!'
  );
  assert.ok(fs.existsSync(prodDbPath), `Database file does not exist: ${prodDbPath}`);

  // Confirm backup exists
  const backupPath = `${prodDbPath}.backup_pre_reset_20260909`;
  assert.ok(fs.existsSync(backupPath), `Safety backup file does not exist: ${backupPath}`);
  console.log('[✓] Confirmed pre-reset backup exists:', backupPath);

  const db = new Database({ dbPath: prodDbPath });

  // 1. Audit BEFORE state
  console.log('\n--- BEFORE RESET COUNTS ---');
  const countsBefore = {
    merchants: db.queryOne('SELECT count(*) as c FROM merchants').c,
    receivingAccounts: db.queryOne('SELECT count(*) as c FROM payment_receiving_accounts').c,
    customers: db.queryOne('SELECT count(*) as c FROM customers').c,
    paymentSessions: db.queryOne('SELECT count(*) as c FROM payment_sessions').c,
    observations: db.queryOne('SELECT count(*) as c FROM payment_observations').c,
    supportTickets: db.queryOne('SELECT count(*) as c FROM support_tickets').c,
    ticketMessages: db.queryOne('SELECT count(*) as c FROM ticket_messages').c,
    webhookDeliveries: db.queryOne('SELECT count(*) as c FROM webhook_deliveries').c,
    auditLogs: db.queryOne('SELECT count(*) as c FROM audit_logs').c
  };
  console.table(countsBefore);

  const merchantBefore = db.queryOne('SELECT id, business_name, slug, webhook_url, branding FROM merchants');
  console.log('Merchant before reset:', merchantBefore);
  const accountBefore = db.queryOne('SELECT id, merchant_id, upi_id, payee_name, is_active FROM payment_receiving_accounts');
  console.log('Receiving account before reset:', accountBefore);

  assert.ok(merchantBefore, 'Merchant record must exist before reset');
  assert.ok(accountBefore, 'Receiving account record must exist before reset');

  // 2. Perform ACID Transactional Reset
  console.log('\n[→] Executing transactional customer & transaction data purge...');
  db.transaction(() => {
    // A. Support tickets and messages
    db.execute('DELETE FROM ticket_messages;');
    db.execute('DELETE FROM support_tickets;');

    // B. Webhook deliveries
    db.execute('DELETE FROM webhook_deliveries;');

    // C. Payment observations (unlink attributed payments then delete)
    db.execute('UPDATE payment_observations SET attributed_payment_id = NULL;');
    db.execute('DELETE FROM payment_observations;');

    // D. Payment sessions
    db.execute('DELETE FROM payment_sessions;');

    // E. Customers
    db.execute('DELETE FROM customers;');

    // F. Audit logs (remove customer/transaction events, keep merchant & account configuration history)
    db.execute("DELETE FROM audit_logs WHERE entity_type IN ('PAYMENT_SESSION', 'PAYMENT_OBSERVATION');");

    // G. Reset slot state on receiving accounts
    db.execute('UPDATE payment_receiving_accounts SET is_slot_busy = 0, current_active_session_id = NULL;');
  });

  console.log('[✓] Transaction committed successfully.');

  // 3. Audit AFTER state
  console.log('\n--- AFTER RESET COUNTS ---');
  const countsAfter = {
    merchants: db.queryOne('SELECT count(*) as c FROM merchants').c,
    receivingAccounts: db.queryOne('SELECT count(*) as c FROM payment_receiving_accounts').c,
    customers: db.queryOne('SELECT count(*) as c FROM customers').c,
    paymentSessions: db.queryOne('SELECT count(*) as c FROM payment_sessions').c,
    observations: db.queryOne('SELECT count(*) as c FROM payment_observations').c,
    supportTickets: db.queryOne('SELECT count(*) as c FROM support_tickets').c,
    ticketMessages: db.queryOne('SELECT count(*) as c FROM ticket_messages').c,
    webhookDeliveries: db.queryOne('SELECT count(*) as c FROM webhook_deliveries').c,
    auditLogs: db.queryOne('SELECT count(*) as c FROM audit_logs').c
  };
  console.table(countsAfter);

  // 4. Verify Merchant & Account Integrity
  const merchantAfter = db.queryOne('SELECT id, business_name, slug, webhook_url, branding FROM merchants');
  const accountAfter = db.queryOne('SELECT id, merchant_id, upi_id, payee_name, is_active, is_slot_busy, current_active_session_id FROM payment_receiving_accounts');

  assert.equal(countsAfter.merchants, 1, 'Merchant must remain');
  assert.equal(countsAfter.receivingAccounts, 1, 'Receiving account must remain');
  assert.equal(merchantAfter.id, merchantBefore.id, 'Merchant ID must match');
  assert.equal(merchantAfter.business_name, merchantBefore.business_name, 'Merchant business name must match');
  assert.equal(merchantAfter.webhook_url, merchantBefore.webhook_url, 'Merchant webhook must match');
  assert.equal(accountAfter.id, accountBefore.id, 'Receiving account ID must match');
  assert.equal(accountAfter.upi_id, accountBefore.upi_id, 'Receiving account upi_id must match');
  assert.equal(accountAfter.is_slot_busy, 0, 'Receiving slot must be free');
  assert.equal(accountAfter.current_active_session_id, null, 'Active session ID must be null');

  // Verify Acceptance Criteria
  assert.equal(countsAfter.customers, 0, 'Customers count must be 0');
  assert.equal(countsAfter.paymentSessions, 0, 'Payment sessions count must be 0');
  assert.equal(countsAfter.observations, 0, 'Observations count must be 0');
  assert.equal(countsAfter.supportTickets, 0, 'Support tickets count must be 0');
  assert.equal(countsAfter.ticketMessages, 0, 'Ticket messages count must be 0');
  assert.equal(countsAfter.webhookDeliveries, 0, 'Webhook deliveries count must be 0');

  // 5. Vacuum database to reclaim disk space
  console.log('\n[→] Vacuuming database to reclaim storage space...');
  db.exec('VACUUM;');
  console.log('[✓] Database vacuumed.');

  db.close();

  const finalStats = fs.statSync(prodDbPath);
  console.log(`[✓] Final Production Database Size: ${(finalStats.size / (1024 * 1024)).toFixed(2)} MB (reclaimed from 326 MB)`);

  console.log('============================================================');
  console.log('🎉 TARGETED PRODUCTION DATABASE RESET COMPLETED SUCCESSFULLY');
  console.log('============================================================');
}

resetProductionDatabase().catch(err => {
  console.error('CRITICAL RESET FAILURE:', err);
  process.exit(1);
});
