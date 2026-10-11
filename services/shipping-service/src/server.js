import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShiprocketCalculatorEngine } from './calculator.js';
import { createRepositories } from '../../../packages/db/src/index.js';
import { defaultLogger } from '../../../packages/common/src/logger.js';
import { PORTS } from '../../../packages/common/src/ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ShippingServiceServer {
  constructor(options = {}) {
    this.port = options.port || PORTS.SHIPPING_SERVICE || 5003;
    this.repos = options.repos || createRepositories();
    this.logger = options.logger || defaultLogger;
    this.calculator = new ShiprocketCalculatorEngine({
      logger: this.logger
    });
    this.server = null;
    this.jsonSettingsPath = path.resolve(__dirname, '../../../data/shipping_settings.json');
  }

  /**
   * Retrieves the configured pickup pincode from JSON backend or store_settings
   * Defaults to '411014' if not set
   */
  getPickupPincode() {
    // 1. Try reading directly from shipping_settings.json (primary source of truth)
    try {
      if (fs.existsSync(this.jsonSettingsPath)) {
        const fileContent = JSON.parse(fs.readFileSync(this.jsonSettingsPath, 'utf8'));
        if (fileContent.shipping_pickup_pincode) {
          return String(fileContent.shipping_pickup_pincode).trim();
        }
      }
    } catch {}

    // 2. Fallback to SQLite DB
    try {
      const row = this.repos.db.queryOne("SELECT value FROM store_settings WHERE key = 'shipping_pickup_pincode'");
      if (row?.value) return String(row.value).trim();
    } catch {}

    return process.env.SHIPPING_PICKUP_PINCODE || '110059';
  }

  /**
   * Updates the shipping pickup pincode in JSON backend and store_settings
   */
  setPickupPincode(pincode) {
    const pin = String(pincode || '').trim();
    if (!/^\d{6}$/.test(pin)) {
      throw new Error('Pickup pincode must be exactly 6 numeric digits.');
    }

    // 1. Write to JSON backend
    try {
      const dir = path.dirname(this.jsonSettingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let existingJson = {};
      if (fs.existsSync(this.jsonSettingsPath)) {
        try { existingJson = JSON.parse(fs.readFileSync(this.jsonSettingsPath, 'utf8')); } catch {}
      }
      existingJson.shipping_pickup_pincode = pin;
      existingJson.updated_at = new Date().toISOString();
      fs.writeFileSync(this.jsonSettingsPath, JSON.stringify(existingJson, null, 2), 'utf8');
    } catch (err) {
      this.logger.warn(`Failed writing shipping_settings.json: ${err.message}`);
    }

    // 2. Write to SQLite
    try {
      this.repos.db.execute(`
        CREATE TABLE IF NOT EXISTS store_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      this.repos.db.execute(`
        INSERT INTO store_settings (key, value, updated_at)
        VALUES ('shipping_pickup_pincode', $1, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `, [pin]);
    } catch (err) {
      this.logger.warn(`Notice updating store_settings table: ${err.message}`);
    }

    return pin;
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;
        const method = req.method.toUpperCase();

        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const readJson = () => new Promise((resolveBody, rejectBody) => {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try { resolveBody(body ? JSON.parse(body) : {}); }
            catch (e) { rejectBody(e); }
          });
        });

        const json = (status, data) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        };

        // 1. GET /health
        if (pathname === '/health' && method === 'GET') {
          json(200, {
            status: 'HEALTHY',
            service: 'shipping-service',
            pickupPincode: this.getPickupPincode(),
            timestamp: new Date().toISOString()
          });
          return;
        }

        // 2. GET /api/v1/shipping/settings - Read current pickup pincode
        if (pathname === '/api/v1/shipping/settings' && method === 'GET') {
          const pickupPincode = this.getPickupPincode();
          json(200, {
            success: true,
            pickupPincode
          });
          return;
        }

        // 3. POST /api/v1/shipping/settings - Update pickup pincode
        if (pathname === '/api/v1/shipping/settings' && method === 'POST') {
          try {
            const body = await readJson();
            const { pickupPincode } = body;
            const updated = this.setPickupPincode(pickupPincode);
            this.logger.info(`Shipping pickup pincode updated to ${updated}`, { category: 'shipping' });
            json(200, {
              success: true,
              pickupPincode: updated,
              message: `Store shipping pickup pincode successfully set to ${updated}`
            });
          } catch (err) {
            json(400, { success: false, error: err.message });
          }
          return;
        }

        // 4. POST /api/v1/shipping/calculate - Calculate live surface shipping rate
        // Accepts: { deliveryPincode, items: [{ productId, quantity, weight }], cartSubtotal }
        if (pathname === '/api/v1/shipping/calculate' && method === 'POST') {
          try {
            const body = await readJson();
            const { deliveryPincode, items = [], cartSubtotal = 0 } = body;

            if (!deliveryPincode || String(deliveryPincode).trim().length !== 6) {
              json(400, { success: false, error: 'Valid 6-digit delivery pincode is required.' });
              return;
            }

            const pickupPincode = body.pickupPincode || this.getPickupPincode();

            // Calculate total weight from cart items:
            // if product has weight 0.4kg and qty 2 -> 0.8kg
            // if product A has 0.8kg and product B has 0.2kg -> total 1.0kg
            let totalWeightKg = 0;
            for (const item of items) {
              let itemWeight = Number(item.weight);
              if (isNaN(itemWeight) || itemWeight <= 0) {
                // If weight not sent directly, look up product in database
                if (item.productId) {
                  const prod = this.repos.products.findById(item.productId);
                  if (prod && prod.weight) {
                    const parsed = parseFloat(String(prod.weight).replace(/[^0-9.]/g, ''));
                    itemWeight = !isNaN(parsed) && parsed > 0 ? parsed : 0.4;
                  } else {
                    itemWeight = 0.4; // default 400g
                  }
                } else {
                  itemWeight = 0.4;
                }
              }
              const qty = Math.max(1, Number(item.quantity || 1));
              totalWeightKg += (itemWeight * qty);
            }

            // Fallback weight if no items specified
            if (totalWeightKg <= 0) {
              totalWeightKg = 0.5;
            }

            // Round weight to 2 decimals
            totalWeightKg = Math.round(totalWeightKg * 100) / 100;

            const shipmentValue = Math.max(1, Number(cartSubtotal || 100));

            // Call Shiprocket Calculator Engine
            const rateResult = await this.calculator.calculateSurfaceRate({
              pickupPincode,
              deliveryPincode: String(deliveryPincode).trim(),
              weightInKg: totalWeightKg,
              shipmentValue,
              cod: 1 // Default COD mode as requested
            });

            json(200, {
              success: true,
              pickupPincode,
              deliveryPincode: String(deliveryPincode).trim(),
              totalWeightKg,
              shipmentValue,
              mode: 'surface',
              paymentMethod: 'COD',
              shippingFee: rateResult.averageRate,
              providerCount: rateResult.providerCount || (rateResult.providers?.length || 0),
              providers: rateResult.providers || [],
              cached: !!rateResult.cached
            });
          } catch (err) {
            this.logger.error(`Failed to calculate shipping rate: ${err.message}`);
            json(500, { success: false, error: err.message });
          }
          return;
        }

        json(404, { error: 'Not Found', service: 'shipping-service' });
      });

      this.server.listen(this.port, () => {
        this.logger.info(`[ShippingService] Running on port ${this.port} (Pickup Pincode: ${this.getPickupPincode()})`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
