import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('D:/ECOMMERCE/data/unified_ecommerce.sqlite');

const insertCoupon = db.prepare(`
  INSERT OR IGNORE INTO coupons (
    id, code, name, type, validity_type, valid_from, valid_until,
    user_eligibility, item_eligibility, eligible_items, cart_min_value,
    max_discount, percentage_off, flat_off, status, usage_count, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
`);

insertCoupon.run(
  'CPN_FREESHIP', 'FREESHIP', 'Free Surface Delivery', 'FREE_DELIVERY', 'UNLIMITED', null, null,
  'ALL_USERS', 'ALL_ITEMS', '{}', 0, null, 0, 0, 'ACTIVE'
);

insertCoupon.run(
  'CPN_WELCOME20', 'WELCOME20', 'Welcome 20% Off', 'PERCENTAGE', 'UNLIMITED', null, null,
  'NEW_USERS_ONLY', 'ALL_ITEMS', '{}', 500, 1000, 20, 0, 'ACTIVE'
);

insertCoupon.run(
  'CPN_FLAT200', 'FLAT200', 'Mega Flat ₹200 Off', 'FIXED_AMOUNT', 'UNLIMITED', null, null,
  'ALL_USERS', 'ALL_ITEMS', '{}', 999, null, 0, 200, 'ACTIVE'
);

console.log('Coupons seeded successfully:');
const all = db.prepare('SELECT code, name, type, percentage_off, flat_off, cart_min_value, status FROM coupons').all();
console.table(all);
