import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Universal Database Client for the Unified E-Commerce Platform.
 * Uses native node:sqlite for zero-dependency high performance execution
 * with ACID transaction guarantees.
 */
export class Database {
  /**
   * @param {{ dbPath?: string, inMemory?: boolean, autoMigrate?: boolean }} [options={}]
   */
  constructor(options = {}) {
    if (options.inMemory) {
      this.db = new DatabaseSync(':memory:');
    } else {
      const rootDir = path.resolve(__dirname, '../../..');
      const defaultPath = path.resolve(rootDir, 'data/unified_ecommerce.sqlite');
      let dbPath = options.dbPath || process.env.SQLITE_DB_PATH || defaultPath;
      if (dbPath && !path.isAbsolute(dbPath)) {
        dbPath = path.resolve(rootDir, dbPath);
      }
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new DatabaseSync(dbPath);
    }

    // Enable foreign keys, busy timeout, and WAL mode
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch {}

    if (options.autoMigrate !== false) {
      this.initSchema();
    }
  }

  /**
   * Initializes the SQLite schema if not already initialized
   */
  initSchema() {
    const schemaPath = path.join(__dirname, 'sqlite-schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      this.db.exec(schemaSql);
    }
    // Safe non-destructive column migrations
    try {
      this.db.exec("ALTER TABLE product_reviews ADD COLUMN media TEXT DEFAULT '[]';");
    } catch {}
    try {
      this.db.exec("ALTER TABLE orders ADD COLUMN coupon_code TEXT;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE orders ADD COLUMN manual_payment_verified INTEGER DEFAULT 0;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE orders ADD COLUMN payment_verified_at TEXT;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE orders ADD COLUMN payment_window_start TEXT;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE orders ADD COLUMN payment_window_end TEXT;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE orders ADD COLUMN payment_gateway_id TEXT;");
    } catch {}
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS store_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } catch {}
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS coupons (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          validity_type TEXT NOT NULL DEFAULT 'UNLIMITED',
          valid_from TEXT,
          valid_until TEXT,
          user_eligibility TEXT NOT NULL DEFAULT 'ALL_USERS',
          item_eligibility TEXT NOT NULL DEFAULT 'ALL_ITEMS',
          eligible_items TEXT NOT NULL DEFAULT '{}',
          cart_min_value REAL NOT NULL DEFAULT 0.0,
          max_discount REAL,
          percentage_off REAL NOT NULL DEFAULT 0.0,
          flat_off REAL NOT NULL DEFAULT 0.0,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          usage_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
        CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);

        -- Synchronize product stock with sum of variant stocks
        UPDATE products
        SET stock = (SELECT COALESCE(SUM(stock), products.stock) FROM product_variants WHERE product_id = products.id)
        WHERE id IN (SELECT DISTINCT product_id FROM product_variants);

        -- Database triggers for continuous real-time inventory synchronization
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
    } catch {}

    // Safe non-destructive migration: decouples order_items so products can be deleted cleanly without FK RESTRICT error
    try {
      const orderItemsTable = this.queryOne("SELECT sql FROM sqlite_master WHERE type='table' AND name='order_items'");
      if (orderItemsTable && (orderItemsTable.sql.includes('ON DELETE RESTRICT') || orderItemsTable.sql.includes('product_id TEXT NOT NULL'))) {
        this.db.exec(`
          PRAGMA foreign_keys = OFF;
          CREATE TABLE IF NOT EXISTS order_items_mig (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
            variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
            sku TEXT NOT NULL,
            product_name TEXT NOT NULL,
            variant_name TEXT,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            unit_price REAL NOT NULL,
            total_price REAL NOT NULL,
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO order_items_mig SELECT id, order_id, product_id, variant_id, sku, product_name, variant_name, quantity, unit_price, total_price, image_url, created_at FROM order_items;
          DROP TABLE order_items;
          ALTER TABLE order_items_mig RENAME TO order_items;
          CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
          CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
          PRAGMA foreign_keys = ON;
        `);
      }
    } catch {}
  }

  /**
   * Normalizes parameter markers from PostgreSQL style ($1, $2) to SQLite style (?, ?)
   * and maps params array to match the positional order of ? placeholders.
   * @param {string} sql
   * @param {any[]} [params]
   * @returns {string | { sql: string, params: any[] }}
   */
  normalizeSql(sql, params) {
    if (!sql || typeof sql !== 'string') {
      return params !== undefined ? { sql: '', params: [] } : '';
    }
    if (!sql.includes('$')) {
      return params !== undefined ? { sql, params: Array.isArray(params) ? params : [] } : sql;
    }
    if (params === undefined) {
      return sql.replace(/\$\d+/g, '?');
    }
    if (!Array.isArray(params) || params.length === 0) {
      return { sql: sql.replace(/\$\d+/g, '?'), params: Array.isArray(params) ? params : [] };
    }
    const mappedParams = [];
    const normalizedSql = sql.replace(/\$(\d+)/g, (match, num) => {
      const idx = parseInt(num, 10) - 1;
      if (idx >= 0 && idx < params.length) {
        mappedParams.push(params[idx]);
        return '?';
      }
      return match;
    });
    return { sql: normalizedSql, params: mappedParams };
  }

  /**
   * Executes a statement (INSERT, UPDATE, DELETE, DDL).
   * @param {string} sql
   * @param {any[]} [params=[]]
   * @returns {{ changes: number, lastInsertRowid: number | bigint }}
   */
  execute(sql, params = []) {
    const res = this.normalizeSql(sql, params);
    const stmt = this.db.prepare(res.sql);
    return stmt.run(...res.params);
  }

  /**
   * Queries multiple rows.
   * @param {string} sql
   * @param {any[]} [params=[]]
   * @returns {any[]}
   */
  query(sql, params = []) {
    const res = this.normalizeSql(sql, params);
    const stmt = this.db.prepare(res.sql);
    return stmt.all(...res.params);
  }

  /**
   * Queries a single row.
   * @param {string} sql
   * @param {any[]} [params=[]]
   * @returns {any | null}
   */
  queryOne(sql, params = []) {
    const res = this.normalizeSql(sql, params);
    const stmt = this.db.prepare(res.sql);
    const result = stmt.get(...res.params);
    return result !== undefined ? result : null;
  }

  /**
   * Executes a batch of DDL or SQL statements.
   * @param {string} sql
   */
  exec(sql) {
    this.db.exec(sql);
  }

  /**
   * Executes a callback within an ACID transaction.
   * Automatically rolls back on error.
   * @template T
   * @param {() => T} callback
   * @returns {T}
   */
  transaction(callback) {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = callback();
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {}
      throw err;
    }
  }

  close() {
    this.db.close();
  }
}

let defaultDbInstance = null;

/**
 * Returns the singleton database instance.
 * @param {{ dbPath?: string, inMemory?: boolean, autoMigrate?: boolean }} [options={}]
 * @returns {Database}
 */
export function getDatabase(options = {}) {
  if (!defaultDbInstance) {
    defaultDbInstance = new Database(options);
  }
  return defaultDbInstance;
}
