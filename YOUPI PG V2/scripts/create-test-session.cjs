const { getDatabase } = require('./packages/db');
const db = getDatabase();

const sql = `
  INSERT OR REPLACE INTO payment_sessions (
    id, merchant_id, receiving_account_id, order_id, amount_paise, status, slot_acquired_at, expires_at, created_at, updated_at
  ) VALUES (
    'test-active-session-499',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'ORD-DEMO-499',
    49900,
    'ACTIVE',
    datetime('now'),
    datetime('now', '+10 minutes'),
    datetime('now'),
    datetime('now')
  );
`;

db.execute(sql);
console.log('Active session test-active-session-499 created for 49900 paise');
