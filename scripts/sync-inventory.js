import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const src = 'D:/ECOMMERCE/services/commerce-api/data/unified_ecommerce.sqlite';
const dst = 'D:/ECOMMERCE/data/unified_ecommerce.sqlite';

console.log('1. Backing up original root db...');
try {
  if (fs.existsSync(dst)) {
    fs.copyFileSync(dst, dst + '.bak_' + Date.now());
  }
} catch (e) {
  console.log('Backup warning:', e.message);
}

console.log('2. Syncing active commerce-api db to root...');
if (fs.existsSync(src)) {
  fs.copyFileSync(src, dst);
}

console.log('3. Running stock reconciliation and triggers on canonical db...');
const db = new DatabaseSync(dst);

// Update products.stock to match SUM(product_variants.stock)
db.exec(`
  UPDATE products
  SET stock = (SELECT COALESCE(SUM(stock), products.stock) FROM product_variants WHERE product_id = products.id)
  WHERE id IN (SELECT DISTINCT product_id FROM product_variants);

  CREATE TRIGGER IF NOT EXISTS trg_sync_stock_variant_insert
  AFTER INSERT ON product_variants
  BEGIN
    UPDATE products
    SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = NEW.product_id),
        updated_at = datetime('now')
    WHERE id = NEW.product_id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sync_stock_variant_update
  AFTER UPDATE OF stock ON product_variants
  BEGIN
    UPDATE products
    SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = NEW.product_id),
        updated_at = datetime('now')
    WHERE id = NEW.product_id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sync_stock_variant_delete
  AFTER DELETE ON product_variants
  BEGIN
    UPDATE products
    SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = OLD.product_id),
        updated_at = datetime('now')
    WHERE id = OLD.product_id;
  END;
`);

console.log('4. Verification: Products and their synchronized stock:');
const prods = db.prepare('SELECT id, sku, name, stock, (SELECT COUNT(*) FROM product_variants WHERE product_id = products.id) as variant_count FROM products').all();
console.table(prods);

console.log('5. Verification: Product variants stock:');
const vars = db.prepare('SELECT product_id, sku, name, stock FROM product_variants').all();
console.table(vars);

// Also sync the commerce-api db so both files have identical triggers and synced stock
const dbApi = new DatabaseSync(src);
dbApi.exec(`
  UPDATE products
  SET stock = (SELECT COALESCE(SUM(stock), products.stock) FROM product_variants WHERE product_id = products.id)
  WHERE id IN (SELECT DISTINCT product_id FROM product_variants);

  CREATE TRIGGER IF NOT EXISTS trg_sync_stock_variant_insert
  AFTER INSERT ON product_variants
  BEGIN
    UPDATE products
    SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = NEW.product_id),
        updated_at = datetime('now')
    WHERE id = NEW.product_id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sync_stock_variant_update
  AFTER UPDATE OF stock ON product_variants
  BEGIN
    UPDATE products
    SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = NEW.product_id),
        updated_at = datetime('now')
    WHERE id = NEW.product_id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sync_stock_variant_delete
  AFTER DELETE ON product_variants
  BEGIN
    UPDATE products
    SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = OLD.product_id),
        updated_at = datetime('now')
    WHERE id = OLD.product_id;
  END;
`);
console.log('Both databases successfully synchronized!');
