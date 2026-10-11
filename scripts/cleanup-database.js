import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dbPath = path.join(rootDir, 'data', 'unified_ecommerce.sqlite');

console.log('=============================================================================');
console.log('  DATABASE & LOGS CLEANUP SCRIPT');
console.log(`  Database: ${dbPath}`);
console.log('=============================================================================');

const db = new DatabaseSync(dbPath);

const PRESERVED_MOBILES = [
  '+919876543210'  // Demo Store Administrator
];

console.log('[Cleanup] Preserving users with mobiles:', PRESERVED_MOBILES);

// 1. Identify single latest order
const latestOrder = db.prepare('SELECT id, order_number, customer_name, customer_mobile, created_at FROM orders ORDER BY created_at DESC LIMIT 1').get();

if (!latestOrder) {
  console.log('[Cleanup] No orders found in database.');
} else {
  console.log(`[Cleanup] Preserving single latest order: ${latestOrder.order_number} (ID: ${latestOrder.id}) placed at ${latestOrder.created_at} by ${latestOrder.customer_name} (${latestOrder.customer_mobile})`);
}

const latestOrderId = latestOrder ? latestOrder.id : null;

// Wrap in transaction for atomicity
db.exec('BEGIN TRANSACTION;');

try {
  // A. Clear Customer Support History
  console.log('[Cleanup] Purging support messages and tickets...');
  const msgDel = db.prepare('DELETE FROM support_messages').run();
  const ticketDel = db.prepare('DELETE FROM support_tickets').run();
  console.log(`  -> Deleted support messages and tickets.`);

  // B. Clear Leftover Logs
  console.log('[Cleanup] Purging system audit logs, service logs, and events...');
  db.prepare('DELETE FROM audit_logs').run();
  db.prepare('DELETE FROM service_logs').run();
  db.prepare('DELETE FROM system_events').run();
  console.log(`  -> Audit logs, service logs, and system events purged.`);

  // C. Prune Orders (Preserve only single latest order)
  if (latestOrderId) {
    console.log('[Cleanup] Deleting order history except latest order...');
    db.prepare('DELETE FROM refunds WHERE order_id != ?').run(latestOrderId);
    db.prepare('DELETE FROM payment_transactions WHERE payment_id IN (SELECT id FROM payments WHERE order_id != ?)').run(latestOrderId);
    db.prepare('DELETE FROM payments WHERE order_id != ?').run(latestOrderId);
    db.prepare('DELETE FROM shipments WHERE order_id != ?').run(latestOrderId);
    db.prepare('DELETE FROM order_status_history WHERE order_id != ?').run(latestOrderId);
    db.prepare('DELETE FROM order_items WHERE order_id != ?').run(latestOrderId);
    const deletedOrders = db.prepare('DELETE FROM orders WHERE id != ?').run(latestOrderId);
    console.log(`  -> Removed historical orders (kept order ID: ${latestOrderId}).`);
  }

  // D. Prune Customers (Preserve only the 4 specified mobiles)
  console.log('[Cleanup] Pruning customer database...');
  const placeholders = PRESERVED_MOBILES.map(() => '?').join(', ');
  
  // Clean related user records first
  const nonPreservedUserQuery = `SELECT id FROM users WHERE mobile NOT IN (${placeholders})`;
  const nonPreservedUsers = db.prepare(nonPreservedUserQuery).all(...PRESERVED_MOBILES).map(u => u.id);

  if (nonPreservedUsers.length > 0) {
    console.log(`  -> Found ${nonPreservedUsers.length} non-whitelisted users to remove:`, nonPreservedUsers);
    const userIn = nonPreservedUsers.map(() => '?').join(', ');

    db.prepare(`DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id IN (${userIn}))`).run(...nonPreservedUsers);
    db.prepare(`DELETE FROM carts WHERE user_id IN (${userIn})`).run(...nonPreservedUsers);
    db.prepare(`DELETE FROM addresses WHERE user_id IN (${userIn})`).run(...nonPreservedUsers);
    db.prepare(`DELETE FROM user_profiles WHERE user_id IN (${userIn})`).run(...nonPreservedUsers);
    db.prepare(`DELETE FROM auth_identities WHERE user_id IN (${userIn})`).run(...nonPreservedUsers);
    db.prepare(`DELETE FROM notifications WHERE user_id IN (${userIn})`).run(...nonPreservedUsers);
    
    // Delete non-preserved users
    db.prepare(`DELETE FROM users WHERE id IN (${userIn})`).run(...nonPreservedUsers);
    console.log(`  -> Deleted non-whitelisted users and associated profiles/carts/identities.`);
  } else {
    console.log('  -> No non-whitelisted users found.');
  }

  // E. Clean leftover notifications
  if (latestOrderId) {
    db.prepare(`DELETE FROM notifications WHERE body NOT LIKE ? AND subject NOT LIKE ?`).run(`%${latestOrder.order_number}%`, `%${latestOrder.order_number}%`);
  } else {
    db.prepare('DELETE FROM notifications').run();
  }
  // Mark remaining notifications as read
  db.prepare("UPDATE notifications SET status = 'READ' WHERE status != 'READ'").run();

  db.exec('COMMIT;');
  console.log('[Cleanup] Transaction committed successfully.');

  // Optimize & reclaim space
  db.exec('VACUUM;');
  console.log('[Cleanup] Database vacuumed successfully.');

} catch (err) {
  db.exec('ROLLBACK;');
  console.error('[Cleanup] Error during database cleanup, rolled back:', err);
  process.exit(1);
}

// Verification Output
console.log('\n=============================================================================');
console.log('  CLEANUP VERIFICATION SUMMARY');
console.log('=============================================================================');

const remainingUsers = db.prepare('SELECT id, name, mobile, role, created_at FROM users').all();
console.log(`Remaining Users (${remainingUsers.length}):`);
console.table(remainingUsers);

const remainingOrders = db.prepare('SELECT id, order_number, customer_name, customer_mobile, total_amount, created_at FROM orders').all();
console.log(`Remaining Orders (${remainingOrders.length}):`);
console.table(remainingOrders);

const counts = {
  support_tickets: db.prepare('SELECT COUNT(*) as c FROM support_tickets').get().c,
  support_messages: db.prepare('SELECT COUNT(*) as c FROM support_messages').get().c,
  audit_logs: db.prepare('SELECT COUNT(*) as c FROM audit_logs').get().c,
  service_logs: db.prepare('SELECT COUNT(*) as c FROM service_logs').get().c,
  system_events: db.prepare('SELECT COUNT(*) as c FROM system_events').get().c,
  notifications: db.prepare('SELECT COUNT(*) as c FROM notifications').get().c
};
console.log('Table Record Counts:');
console.table(counts);
