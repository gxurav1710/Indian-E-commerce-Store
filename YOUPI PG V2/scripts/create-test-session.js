import { getDatabase } from '../packages/db/src/index.js';
const db = getDatabase();

const nowIso = new Date(Date.now() - 60000).toISOString();
const expIso = new Date(Date.now() + 600000).toISOString();

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
    ?,
    ?,
    ?,
    ?
  );
`;

db.execute(sql, [nowIso, expIso, nowIso, nowIso]);
console.log('Active session test-active-session-499 created for 49900 paise');
