const { Database } = require('./packages/db/src/database.js');
const db = new Database('data/youpi_pg.sqlite');
db.execute(`
  INSERT OR REPLACE INTO payment_sessions (
    id, merchant_id, receiving_account_id, order_id, amount_paise, status, created_at, updated_at
  ) VALUES (
    'test-initiated-session-999',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'ORD-INIT-999',
    100,
    'INITIATED',
    datetime('now'),
    datetime('now')
  );
`);
console.log('Created test-initiated-session-999');
