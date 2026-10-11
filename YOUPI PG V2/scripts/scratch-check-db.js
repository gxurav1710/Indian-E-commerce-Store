import { getDatabase } from '../packages/db/src/index.js';
const db = getDatabase();

console.log('--- RECENT PAYMENT SESSIONS ---');
const sessions = db.query(`
  SELECT id, order_id, amount_paise, status, device_id, queue_position, receiving_account_id, expires_at, created_at, updated_at
  FROM payment_sessions
  ORDER BY created_at DESC
  LIMIT 10
`);
console.table(sessions);

console.log('--- RECEIVING ACCOUNTS ---');
const accounts = db.query(`
  SELECT id, upi_id, is_active, is_slot_busy, current_active_session_id
  FROM payment_receiving_accounts
`);
console.table(accounts);
