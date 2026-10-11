import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PORTS, URLS, INTERNAL_URLS } from '../../../packages/common/src/ports.js';
import { EVENT_TYPES, globalEventBus, createEvent } from '../../../packages/common/src/events.js';
import { defaultLogger } from '../../../packages/common/src/logger.js';
import { createRepositories } from '../../../packages/db/src/index.js';
import { verifyAdminLogin } from '../../../packages/common/src/admin-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

export class CommerceApiServer {
  /**
   * @param {{ port?: number, repos?: any, logger?: any }} [options={}]
   */
  constructor(options = {}) {
    this.port = options.port || PORTS.COMMERCE_API || 5001;
    this.repos = options.repos || createRepositories();
    this.logger = options.logger || defaultLogger;
    this.merchantId = process.env.MERCHANT_ID || '00000000-0000-0000-0000-000000000001';
    this.webhookSecret = process.env.MERCHANT_WEBHOOK_SECRET || 'unified_store_webhook_secret_for_payment_verification';
    this.activeBroadcast = {
      id: null,
      active: false,
      total: 0,
      processed: 0,
      sent: 0,
      failed: 0,
      currentRecipient: null,
      currentStep: 'IDLE',
      etaSeconds: 0,
      etaText: '0s',
      startTime: null,
      stopRequested: false
    };
    this.setupLifecycleNotificationListeners();
  }

  getStoreSettings() {
    const rootDir = path.resolve(__dirname, '../../..');
    const storeSettingsPath = path.resolve(rootDir, 'data/store_settings.json');
    const shippingSettingsPath = path.resolve(rootDir, 'data/shipping_settings.json');

    let settings = {
      owner_whatsapp_phone: process.env.STORE_OWNER_WHATSAPP || '+919876543210',
      shipping_pickup_pincode: '110059',
      shipping_sender_name: 'Lumen Luxe Fulfillment Center',
      shipping_sender_address: 'Plot 42, Okhla Industrial Area Phase 3',
      shipping_sender_city: 'New Delhi',
      shipping_sender_state: 'Delhi',
      shipping_sender_pincode: '110020',
      shipping_sender_phone: '+919876543210',
      shipping_sender_gstin: '07AAAAA0000A1Z5',
      shipping_return_policy: '7-day easy replacement or return policy. Product box and tags must be intact.'
    };

    try {
      if (fs.existsSync(shippingSettingsPath)) {
        const file = JSON.parse(fs.readFileSync(shippingSettingsPath, 'utf8'));
        Object.assign(settings, file);
      }
    } catch {}

    try {
      if (fs.existsSync(storeSettingsPath)) {
        const file = JSON.parse(fs.readFileSync(storeSettingsPath, 'utf8'));
        Object.assign(settings, file);
      }
    } catch {}

    // Fallback/merge from SQLite store_settings table
    try {
      const rows = this.repos.db.query("SELECT key, value FROM store_settings");
      for (const r of rows) {
        settings[r.key] = r.value;
      }
    } catch {}

    return settings;
  }

  getStoreBranding() {
    const rootDir = path.resolve(__dirname, '../../..');
    const brandingPath = path.resolve(rootDir, 'data/white_label_settings.json');
    let branding = {
      store_name: 'LUMEN LUXE',
      store_tagline: 'Premium Electronics & Tech Lifestyle',
      store_logo: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=120',
      store_favicon: '🛍️',
      updated_at: new Date().toISOString()
    };

    try {
      if (fs.existsSync(brandingPath)) {
        const file = JSON.parse(fs.readFileSync(brandingPath, 'utf8'));
        Object.assign(branding, file);
      }
    } catch {}

    return branding;
  }

  getStoreOwnerWhatsAppPhone() {
    this.reloadEnvConfig();
    let phone = process.env.STORE_OWNER_WHATSAPP || process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE;
    if (!phone) {
      const s = this.getStoreSettings();
      phone = s.owner_whatsapp_phone || s.shipping_sender_phone;
    }
    return String(phone || process.env.STORE_OWNER_WHATSAPP || '+919876543210').trim();
  }

  getWhatsAppBotPhone() {
    this.reloadEnvConfig();
    return String(process.env.WHATSAPP_BOT_PHONE || '+919876543211').trim();
  }

  /**
   * Universal WhatsApp Message Dispatcher
   * Routes outbound messages through the active WhatsApp worker (Baileys/BerryProtocol)
   * Dispatches customer messages and notifies owner from the configured bot phone.
   */
  async dispatchWhatsApp({ to, message, orderId = null, source = 'commerce-api', alertOwner = false, ownerAlertMessage = null }) {
    if (!to || !message) return { success: false, error: 'Recipient and message required' };

    let cleanTo = this.normalizePhone(to);
    let result = { success: false };

    // 1. Primary: WhatsApp Worker (port 4001) - Baileys WebSocket transport
    try {
      const workerUrl = `http://127.0.0.1:${PORTS.WHATSAPP_WORKER || 4001}`;
      const res = await fetch(`${workerUrl}/api/v1/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WORKER_INTERNAL_SECRET || 'worker_secret_key_change_me_in_prod_abcde'}`
        },
        body: JSON.stringify({
          to: cleanTo,
          message,
          orderId,
          source
        }),
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const json = await res.json();
        result = { success: true, mode: 'worker', ...json };
      }
    } catch {}

    // 2. Secondary fallback: WhatsApp Auth API (port 4000)
    if (!result.success) {
      try {
        const authUrl = `http://127.0.0.1:${PORTS.WHATSAPP_AUTH_API || 4000}`;
        const res = await fetch(`${authUrl}/api/v1/messages/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: cleanTo,
            message,
            orderId,
            source
          }),
          signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
          const json = await res.json();
          result = { success: true, mode: 'auth_api', ...json };
        }
      } catch {}
    }

    // Safely record in notifications repository
    try {
      if (this.repos.notifications) {
        this.repos.notifications.createNotification({
          channel: 'WHATSAPP',
          recipient: cleanTo,
          destination: cleanTo,
          templateId: source || 'direct_dispatch',
          subject: 'WhatsApp Dispatch',
          body: message,
          status: result.success ? 'SENT' : 'PENDING',
          sentAt: new Date().toISOString()
        });
      }
    } catch {}

    // If alertOwner is requested, dispatch the alert TO the owner's WhatsApp number from the bot
    if (alertOwner) {
      const ownerPhone = this.getStoreOwnerWhatsAppPhone();
      const cleanOwner = this.normalizePhone(ownerPhone);
      if (cleanOwner && cleanOwner !== cleanTo) {
        const finalOwnerMsg = ownerAlertMessage || `🔔 *[Owner Alert]*\n${message}`;
        try {
          const workerUrl = `http://127.0.0.1:${PORTS.WHATSAPP_WORKER || 4001}`;
          await fetch(`${workerUrl}/api/v1/messages/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.WORKER_INTERNAL_SECRET || 'worker_secret_key_change_me_in_prod_abcde'}`
            },
            body: JSON.stringify({
              to: cleanOwner,
              message: finalOwnerMsg,
              orderId,
              source: 'owner-alert'
            }),
            signal: AbortSignal.timeout(6000)
          }).catch(() => {});
        } catch {}
      }
    }

    return result;
  }

  normalizePhone(phone) {
    if (!phone) return null;
    let clean = String(phone).replace(/[^0-9]/g, '');
    if (clean.length === 10) clean = '91' + clean;
    else if (clean.length === 11 && clean.startsWith('0')) clean = '91' + clean.slice(1);
    return clean;
  }

  reloadEnvConfig() {
    try {
      const rootEnv = path.resolve(rootDir, '.env');
      if (fs.existsSync(rootEnv)) {
        const lines = fs.readFileSync(rootEnv, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }

  getPublicUrls(req = null) {
    this.reloadEnvConfig();

    const primaryDomain = (process.env.PRIMARY_DOMAIN || '').trim();
    const domainExt = (process.env.DOMAIN_EXTENSION || '.shop').trim();
    const isRealDomain = Boolean(primaryDomain && primaryDomain !== 'localhost' && primaryDomain !== '127.0.0.1');
    const configuredStore = (process.env.STOREFRONT_URL || '').trim();
    const configuredAdmin = (process.env.ADMIN_PANEL_URL || '').trim();
    const configuredApi = (process.env.COMMERCE_API_URL || '').trim();
    const configuredPay = (process.env.BASE_CHECKOUT_URL || '').trim();

    const host = req?.headers ? (req.headers['x-forwarded-host'] || req.headers.host) : null;
    const isHostLocal = !host || Boolean(host.includes('localhost') || host.includes('127.0.0.1'));

    // If caller is on localhost or in DEVELOPMENT mode, preserve local storefront/admin
    if (isHostLocal || process.env.ENVIRONMENT_MODE === 'DEVELOPMENT') {
      const localHost = host || 'localhost:5001';
      return {
        storefront: (configuredStore && !configuredStore.includes('localhost.shop') ? configuredStore : URLS.STOREFRONT || 'http://localhost:5000').replace(/\/+$/, ''),
        admin: (configuredAdmin && !configuredAdmin.includes('localhost.shop') ? configuredAdmin : URLS.ADMIN_PANEL || 'http://localhost:5050').replace(/\/+$/, ''),
        commerceApi: `http://${localHost}`,
        checkoutPortal: (configuredPay && !configuredPay.includes('localhost.shop') ? configuredPay : URLS.CHECKOUT_PORTAL || 'http://localhost:7000').replace(/\/+$/, '')
      };
    }

    // If primary domain configured in Credential Centre, prioritize it unconditionally in production or live calls
    if (isRealDomain && process.env.ENVIRONMENT_MODE === 'PRODUCTION') {
      return {
        storefront: `https://${primaryDomain}${domainExt}`,
        admin: `https://admin.${primaryDomain}${domainExt}`,
        commerceApi: `https://api.${primaryDomain}${domainExt}`,
        checkoutPortal: `https://pay.${primaryDomain}${domainExt}`
      };
    }

    if (isHostLocal) {
      return {
        storefront: (configuredStore && !configuredStore.includes('localhost.shop') ? configuredStore : URLS.STOREFRONT || 'http://localhost:5000').replace(/\/+$/, ''),
        admin: (configuredAdmin && !configuredAdmin.includes('localhost.shop') ? configuredAdmin : URLS.ADMIN_PANEL || 'http://localhost:5050').replace(/\/+$/, ''),
        commerceApi: `http://${host || 'localhost:5001'}`,
        checkoutPortal: (configuredPay && !configuredPay.includes('localhost.shop') ? configuredPay : URLS.CHECKOUT_PORTAL || 'http://localhost:7000').replace(/\/+$/, '')
      };
    }

    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      const parts = host.split(':')[0].split('.');
      let rootDomain = host.split(':')[0];
      if (parts.length > 2) {
        rootDomain = parts.slice(1).join('.');
      }
      this.lastRootDomain = rootDomain;
      return {
        storefront: `https://${rootDomain}`,
        admin: `https://admin.${rootDomain}`,
        commerceApi: `https://api.${rootDomain}`,
        checkoutPortal: `https://pay.${rootDomain}`
      };
    }

    if (this.lastRootDomain) {
      return {
        storefront: `https://${this.lastRootDomain}`,
        admin: `https://admin.${this.lastRootDomain}`,
        commerceApi: `https://api.${this.lastRootDomain}`,
        checkoutPortal: `https://pay.${this.lastRootDomain}`
      };
    }

    if (primaryDomain) {
      return {
        storefront: `https://${primaryDomain}${domainExt}`,
        admin: `https://admin.${primaryDomain}${domainExt}`,
        commerceApi: `https://api.${primaryDomain}${domainExt}`,
        checkoutPortal: `https://pay.${primaryDomain}${domainExt}`
      };
    }

    return {
      storefront: (configuredStore || URLS.STOREFRONT || 'http://localhost:5000').replace(/\/+$/, ''),
      admin: (configuredAdmin || URLS.ADMIN_PANEL || 'http://localhost:5050').replace(/\/+$/, ''),
      commerceApi: `http://localhost:${this.port}`,
      checkoutPortal: (configuredPay || URLS.CHECKOUT_PORTAL || 'http://localhost:7000').replace(/\/+$/, '')
    };
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const rawHost = req.headers['x-forwarded-host'] || req.headers.host;
      if (rawHost && !rawHost.includes('localhost') && !rawHost.includes('127.0.0.1')) {
        const parts = rawHost.split(':')[0].split('.');
        if (parts.length > 2) {
          this.lastRootDomain = parts.slice(1).join('.');
        } else {
          this.lastRootDomain = rawHost.split(':')[0];
        }
      }
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      // CORS Headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Gateway-Signature, X-Gateway-Event, X-Session-Token, X-User-Id');

      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // JSON parsing utility
      const readJsonBody = () => new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try { resolve(body ? JSON.parse(body) : {}); }
          catch (e) { reject(e); }
        });
      });

      // Raw body parsing utility (Preserves exact bytes for HMAC signature verification)
      const readRawBody = () => new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => resolve(body));
      });

      // Response helper
      const jsonResponse = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      try {
        // Static Media Asset Serving for WhatsApp Broadcasts & Announcements
        if (pathname.startsWith('/broadcast-assets/') && method === 'GET') {
          const rawFile = pathname.replace('/broadcast-assets/', '');
          const safeFile = path.basename(decodeURIComponent(rawFile));
          const filePath = path.resolve(__dirname, '../../../data/broadcast_assets', safeFile);

          if (!fs.existsSync(filePath)) {
            jsonResponse(404, { success: false, error: 'Broadcast asset not found' });
            return;
          }

          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mov': 'video/quicktime',
            '.mkv': 'video/x-matroska',
            '.mp3': 'audio/mpeg',
            '.ogg': 'audio/ogg',
            '.pdf': 'application/pdf'
          };

          const contentType = mimeTypes[ext] || 'application/octet-stream';
          const stat = fs.statSync(filePath);
          const fileSize = stat.size;
          const range = req.headers.range;

          if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunksize,
              'Content-Type': contentType,
              'Access-Control-Allow-Origin': '*'
            });
            file.pipe(res);
          } else {
            res.writeHead(200, {
              'Content-Length': fileSize,
              'Content-Type': contentType,
              'Accept-Ranges': 'bytes',
              'Access-Control-Allow-Origin': '*'
            });
            fs.createReadStream(filePath).pipe(res);
          }
          return;
        }

        // =========================================================================
        // 1. HEALTH CHECKS (Section 30)
        // =========================================================================
        if (pathname === '/health' && method === 'GET') {
          jsonResponse(200, {
            status: 'HEALTHY',
            service: 'commerce-api',
            timestamp: new Date().toISOString(),
            version: '1.0.0'
          });
          return;
        }

        if (pathname === '/health/deep' && method === 'GET') {
          // Verify Database connectivity
          let dbOk = false;
          try {
            const dbCheck = this.repos.db.queryOne('SELECT 1 as alive');
            dbOk = dbCheck?.alive === 1;
          } catch {}

          // Verify Asset Storage path
          const assetsDir = path.resolve(__dirname, '../../../data/product_assets');
          const storageOk = fs.existsSync(assetsDir);

          // Verify Payment API probe
          let paymentApiOk = false;
          try {
            const payRes = await fetch(`${URLS.PAYMENT_API}/health`, { signal: AbortSignal.timeout(2000) });
            paymentApiOk = payRes.ok;
          } catch {}

          const overall = dbOk && storageOk ? 'HEALTHY' : 'DEGRADED';
          jsonResponse(200, {
            status: overall,
            service: 'commerce-api',
            dependencies: {
              database: dbOk ? 'HEALTHY' : 'UNHEALTHY',
              productAssetStorage: storageOk ? 'HEALTHY' : 'DEGRADED',
              paymentGatewayApi: paymentApiOk ? 'HEALTHY' : 'UNREACHABLE'
            },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // =========================================================================
        // 2. CATEGORIES & PRODUCTS (Section 8, 9, 10)
        // =========================================================================
        if (pathname === '/api/v1/categories' && method === 'GET') {
          const categories = this.repos.categories.list();
          jsonResponse(200, { success: true, categories });
          return;
        }

        if (pathname === '/api/v1/categories' && method === 'POST') {
          const body = await readJsonBody();
          const category = this.repos.categories.create(body);
          this.repos.audit.logAction({
            actor: req.headers['x-user-id'] || 'ADMIN',
            action: 'CATEGORY_CREATED',
            resource: 'categories',
            resourceId: category.id,
            afterData: category
          });
          jsonResponse(201, { success: true, category });
          return;
        }

        const catDelMatch = pathname.match(/^\/api\/v1\/categories\/([^/]+)$/);
        if (catDelMatch && method === 'DELETE') {
          const catId = catDelMatch[1];
          try {
            const prev = this.repos.categories.findById(catId);
            if (!prev) {
              jsonResponse(404, { success: false, error: 'Category not found' });
              return;
            }

            this.repos.categories.delete(catId);
            this.repos.audit.logAction({
              actor: req.headers['x-user-id'] || 'ADMIN',
              action: 'CATEGORY_DELETED',
              resource: 'categories',
              resourceId: catId,
              beforeData: prev
            });
            jsonResponse(200, { success: true, message: 'Category deleted successfully' });
            return;
          } catch (err) {
            this.logger.error(`Failed to delete category ${catId}: ${err.message}`, { details: { stack: err.stack } });
            jsonResponse(500, { success: false, error: `Failed to delete category: ${err.message}` });
            return;
          }
        }

        if (pathname === '/api/v1/products' && method === 'GET') {
          const categoryId = url.searchParams.get('category');
          const brand = url.searchParams.get('brand');
          const search = url.searchParams.get('search');
          const minPrice = url.searchParams.get('minPrice');
          const maxPrice = url.searchParams.get('maxPrice');
          const sort = url.searchParams.get('sort') || 'newest';
          const limit = Number(url.searchParams.get('limit') || 50);
          const offset = Number(url.searchParams.get('offset') || 0);

          const products = this.repos.products.list({ categoryId, brand, search, minPrice, maxPrice, sort, limit, offset });
          jsonResponse(200, { success: true, count: products.length, products });
          return;
        }

        // Admin Product Creation (Section 9 & 10)
        if (pathname === '/api/v1/products' && method === 'POST') {
          const body = await readJsonBody();
          if (!body.name || !body.price) {
            jsonResponse(400, { error: 'Product name and price are required' });
            return;
          }

          const product = this.repos.products.create(body);

          this.logger.info(`Product created: ${product.name} (${product.sku})`, {
            category: 'orders',
            details: { id: product.id, sku: product.sku, price: product.price }
          });

          this.repos.audit.logAction({
            actor: req.headers['x-user-id'] || 'ADMIN',
            action: 'PRODUCT_CREATED',
            resource: 'products',
            resourceId: product.id,
            afterData: product
          });

          jsonResponse(201, { success: true, product });
          return;
        }

        // Single Product Details
        const prodMatch = pathname.match(/^\/api\/v1\/products\/([^/]+)$/);
        if (prodMatch && method === 'GET') {
          const idOrSlug = prodMatch[1];
          const product = this.repos.products.getProductWithDetails(idOrSlug);
          if (!product) {
            jsonResponse(404, { error: 'Product not found' });
            return;
          }
          jsonResponse(200, { success: true, product });
          return;
        }

        // Product Update
        if (prodMatch && (method === 'PUT' || method === 'PATCH')) {
          const id = prodMatch[1];
          const body = await readJsonBody();
          const prev = this.repos.products.findById(id);
          const updated = this.repos.products.update(id, body);

          this.repos.audit.logAction({
            actor: req.headers['x-user-id'] || 'ADMIN',
            action: 'PRODUCT_UPDATED',
            resource: 'products',
            resourceId: id,
            beforeData: prev,
            afterData: updated
          });

          jsonResponse(200, { success: true, product: updated });
          return;
        }

        // Product Delete
        if (prodMatch && method === 'DELETE') {
          const id = prodMatch[1];
          try {
            const prev = this.repos.products.findById(id);
            if (!prev) {
              jsonResponse(404, { success: false, error: 'Product not found' });
              return;
            }

            this.repos.products.delete(id);

            // Clean up asset directory on disk if it exists
            if (prev.sku) {
              try {
                const assetsDir = path.resolve(__dirname, '../../../data/product_assets/products', prev.sku);
                if (fs.existsSync(assetsDir)) {
                  fs.rmSync(assetsDir, { recursive: true, force: true });
                }
              } catch (e) {
                this.logger.warn(`Failed to clean up asset dir for ${prev.sku}: ${e.message}`);
              }
            }

            this.repos.audit.logAction({
              actor: req.headers['x-user-id'] || 'ADMIN',
              action: 'PRODUCT_DELETED',
              resource: 'products',
              resourceId: id,
              beforeData: prev
            });

            jsonResponse(200, { success: true, message: 'Product deleted successfully' });
            return;
          } catch (err) {
            this.logger.error(`Failed to delete product ${id}: ${err.message}`, { details: { stack: err.stack } });
            jsonResponse(500, { success: false, error: `Failed to delete product: ${err.message}` });
            return;
          }
        }

        // Product SKU Asset Directory Inspection (Section 9)
        const assetMatch = pathname.match(/^\/api\/v1\/products\/([^/]+)\/assets$/);
        if (assetMatch && method === 'GET') {
          const sku = assetMatch[1];
          const assetsDir = path.resolve(__dirname, '../../../data/product_assets/products', sku);

          const subdirs = ['images', 'videos', 'documents', 'metadata'];
          const structure = {};

          for (const sub of subdirs) {
            const subPath = path.join(assetsDir, sub);
            if (fs.existsSync(subPath)) {
              structure[sub] = fs.readdirSync(subPath);
            } else {
              structure[sub] = [];
            }
          }

          jsonResponse(200, {
            success: true,
            sku,
            relativePath: `products/${sku}`,
            structure
          });
          return;
        }

        // Product Media Management: POST /api/v1/products/:id/media (Add photo or video)
        const prodMediaMatch = pathname.match(/^\/api\/v1\/products\/([^/]+)\/media$/);
        if (prodMediaMatch && method === 'POST') {
          const productId = prodMediaMatch[1];
          const product = this.repos.products.findById(productId) || this.repos.products.findBySku(productId);
          if (!product) {
            jsonResponse(404, { error: 'Product not found' });
            return;
          }

          const body = await readJsonBody();
          const { url: mediaUrl, mediaType = 'image', isPrimary = false } = body;
          if (!mediaUrl) {
            jsonResponse(400, { error: 'Media URL is required' });
            return;
          }

          const type = mediaType === 'video' || mediaUrl.includes('.mp4') || mediaUrl.includes('.webm') || mediaUrl.includes('youtube') || mediaUrl.includes('vimeo') ? 'video' : 'image';
          const ext = type === 'video' ? 'mp4' : 'jpg';

          const media = this.repos.products.addMedia({
            productId: product.id,
            sku: product.sku,
            mediaType: type,
            filePath: `${product.asset_dir}/${type}s/media_${Date.now()}.${ext}`,
            url: mediaUrl,
            isPrimary: Boolean(isPrimary),
            sortOrder: type === 'video' ? 50 : 0
          });

          jsonResponse(201, { success: true, media });
          return;
        }

        // Delete Product Media: DELETE /api/v1/products/:id/media/:mediaId
        const prodMediaDelMatch = pathname.match(/^\/api\/v1\/products\/([^/]+)\/media\/([^/]+)$/);
        if (prodMediaDelMatch && method === 'DELETE') {
          const mediaId = prodMediaDelMatch[2];
          this.repos.products.deleteMedia(mediaId);
          jsonResponse(200, { success: true, message: 'Media removed' });
          return;
        }

        // Set Primary Product Photo: PUT /api/v1/products/:id/media/:mediaId/primary
        const prodMediaPrimMatch = pathname.match(/^\/api\/v1\/products\/([^/]+)\/media\/([^/]+)\/primary$/);
        if (prodMediaPrimMatch && (method === 'PUT' || method === 'POST')) {
          const productId = prodMediaPrimMatch[1];
          const mediaId = prodMediaPrimMatch[2];
          this.repos.products.setPrimaryMedia(productId, mediaId);
          jsonResponse(200, { success: true, message: 'Primary image updated' });
          return;
        }

        // =========================================================================
        // PRODUCT REVIEWS & RATINGS SYSTEM (Top Verified Reviews First!)
        // =========================================================================
        const prodReviewsMatch = pathname.match(/^\/api\/v1\/products\/([^/]+)\/reviews$/);
        if (prodReviewsMatch && method === 'GET') {
          const productId = prodReviewsMatch[1];
          const product = this.repos.products.findById(productId) || this.repos.products.findBySlug(productId) || this.repos.products.findBySku(productId);
          if (!product) {
            jsonResponse(404, { error: 'Product not found' });
            return;
          }

          const { reviews, summary } = this.repos.reviews.getProductReviews(product.id);
          jsonResponse(200, { success: true, reviews, summary });
          return;
        }

        if (prodReviewsMatch && method === 'POST') {
          const productId = prodReviewsMatch[1];
          const product = this.repos.products.findById(productId) || this.repos.products.findBySlug(productId) || this.repos.products.findBySku(productId);
          if (!product) {
            jsonResponse(404, { error: 'Product not found' });
            return;
          }

          const body = await readJsonBody();
          const userId = body.userId || req.headers['x-user-id'];

          // Gating: User MUST be logged in to post a review!
          if (!userId) {
            jsonResponse(401, { error: 'Authentication required. Please login with WhatsApp to leave a review.' });
            return;
          }

          const user = this.repos.users.findById(userId);
          const userName = body.userName || user?.name || 'Verified Customer';

          if (!body.rating || !body.title || !body.comment) {
            jsonResponse(400, { error: 'Rating (1-5 stars), title, and comment are required' });
            return;
          }

          // Check if customer purchased product to set initial verified status
          const priorPurchase = this.repos.db.queryOne(
            `SELECT o.id FROM orders o
             JOIN order_items oi ON o.id = oi.order_id
             WHERE o.user_id = $1 AND oi.product_id = $2 AND o.payment_status = 'SUCCESS'`,
            [userId, product.id]
          );

          const isVerified = Boolean(priorPurchase) || body.isVerified ? 1 : 0;

          try {
            const review = this.repos.reviews.createReview({
              productId: product.id,
              userId,
              userName,
              rating: body.rating,
              title: body.title,
              comment: body.comment,
              media: body.media || [],
              isVerified,
              isFeatured: isVerified ? 1 : 0
            });

            this.logger.info(`Customer review submitted for ${product.name} (Rating: ${body.rating}/5)`, {
              category: 'orders',
              userId,
              details: { reviewId: review.id, rating: body.rating, isVerified }
            });

            jsonResponse(201, { success: true, review });
            return;
          } catch (err) {
            jsonResponse(400, { success: false, error: err.message });
            return;
          }
        }

        // Admin Reviews Management: GET /api/v1/admin/reviews
        if (pathname === '/api/v1/admin/reviews' && method === 'GET') {
          const isVerifiedParam = url.searchParams.get('isVerified');
          const isVerified = isVerifiedParam !== null ? (isVerifiedParam === 'true' || isVerifiedParam === '1') : null;
          const reviews = this.repos.reviews.listAllReviews({ isVerified });
          jsonResponse(200, { success: true, reviews });
          return;
        }

        // Admin Verify Review: PATCH /api/v1/admin/reviews/:id/verify
        const revVerifyMatch = pathname.match(/^\/api\/v1\/admin\/reviews\/([^/]+)\/verify$/);
        if (revVerifyMatch && (method === 'PATCH' || method === 'POST')) {
          const reviewId = revVerifyMatch[1];
          const body = await readJsonBody();
          const isVerified = body.isVerified !== undefined ? body.isVerified : 1;
          const updated = this.repos.reviews.verifyReview(reviewId, isVerified);
          jsonResponse(200, { success: true, review: updated });
          return;
        }

        // Admin Delete Review: DELETE /api/v1/admin/reviews/:id
        const revDelMatch = pathname.match(/^\/api\/v1\/admin\/reviews\/([^/]+)$/);
        if (revDelMatch && method === 'DELETE') {
          const reviewId = revDelMatch[1];
          this.repos.reviews.deleteReview(reviewId);
          jsonResponse(200, { success: true, message: 'Review deleted' });
          return;
        }

        // =========================================================================
        // ADMIN UNIVERSAL AUTHENTICATION
        // =========================================================================
        if (pathname === '/api/v1/admin/auth/verify-password' && method === 'POST') {
          const body = await readJsonBody();
          const pass = (body.password || '').trim();
          const clientIp = req.socket?.remoteAddress || '127.0.0.1';

          const result = await verifyAdminLogin({
            password: pass,
            panelName: 'Store Admin Panel',
            ipAddress: clientIp,
            rootDir
          });

          if (result.success) {
            jsonResponse(200, {
              success: true,
              token: result.token,
              mode: result.mode,
              message: result.message || 'Store Admin authentication successful.'
            });
          } else {
            jsonResponse(401, {
              success: false,
              error: result.error || 'Incorrect administrator password.'
            });
          }
          return;
        }

        // =========================================================================
        // 3. CART ENGINE (Section 16)
        // =========================================================================
        if (pathname === '/api/v1/cart' && method === 'GET') {
          const sessionToken = req.headers['x-session-token'] || url.searchParams.get('sessionToken') || null;
          const userId = req.headers['x-user-id'] || url.searchParams.get('userId') || null;

          const cart = this.repos.carts.getOrCreateCart(userId, sessionToken);
          jsonResponse(200, { success: true, cart });
          return;
        }

        if (pathname === '/api/v1/cart/items' && method === 'POST') {
          try {
            const body = await readJsonBody();
            const sessionToken = req.headers['x-session-token'] || body.sessionToken || null;
            const userId = req.headers['x-user-id'] || body.userId || null;

            const cart = this.repos.carts.getOrCreateCart(userId, sessionToken);
            const updated = this.repos.carts.addItem(
              cart.id,
              body.productId,
              body.variantId || null,
              Number(body.quantity || 1),
              body.unitPrice !== undefined ? Number(body.unitPrice) : null
            );

            jsonResponse(200, { success: true, cart: updated });
            return;
          } catch (err) {
            jsonResponse(400, { success: false, error: err.message });
            return;
          }
        }

        const cartItemMatch = pathname.match(/^\/api\/v1\/cart\/items\/([^/]+)$/);
        if (cartItemMatch && (method === 'PATCH' || method === 'PUT')) {
          const cartItemId = cartItemMatch[1];
          const body = await readJsonBody();
          const sessionToken = req.headers['x-session-token'] || body.sessionToken || null;
          const userId = req.headers['x-user-id'] || body.userId || null;

          const cart = this.repos.carts.getOrCreateCart(userId, sessionToken);
          const updated = this.repos.carts.updateItemQuantity(cart.id, cartItemId, Number(body.quantity));
          jsonResponse(200, { success: true, cart: updated });
          return;
        }

        if (cartItemMatch && method === 'DELETE') {
          const cartItemId = cartItemMatch[1];
          const sessionToken = req.headers['x-session-token'] || url.searchParams.get('sessionToken') || null;
          const userId = req.headers['x-user-id'] || url.searchParams.get('userId') || null;

          const cart = this.repos.carts.getOrCreateCart(userId, sessionToken);
          const updated = this.repos.carts.removeItem(cart.id, cartItemId);
          jsonResponse(200, { success: true, cart: updated });
          return;
        }

        // Guest Cart Merge upon WhatsApp Authentication (Section 16)
        if (pathname === '/api/v1/cart/merge' && method === 'POST') {
          const body = await readJsonBody();
          const guestSessionToken = body.guestSessionToken || req.headers['x-session-token'];
          const userId = body.userId || req.headers['x-user-id'];

          if (!guestSessionToken || !userId) {
            jsonResponse(400, { error: 'guestSessionToken and userId are required' });
            return;
          }

          const mergedCart = this.repos.carts.mergeGuestCart(guestSessionToken, userId);
          this.logger.info(`Guest cart merged for user ${userId}`, { category: 'orders', details: { userId, guestSessionToken } });
          jsonResponse(200, { success: true, cart: mergedCart });
          return;
        }

        // =========================================================================
        // 4. CHECKOUT & ORDERS (Section 12, 13, 18, 19, 21, 22)
        // =========================================================================
        if (pathname === '/api/v1/checkout/create-order' && method === 'POST') {
          const body = await readJsonBody();
          const {
            userId,
            customerName,
            customerEmail,
            customerMobile,
            shippingAddress,
            paymentMethod = 'UPI',
            items = [],
            notes
          } = body;

          if (!customerName || !customerMobile) {
            jsonResponse(400, { error: 'Customer name and mobile number are required' });
            return;
          }

          if (!Array.isArray(items) || items.length === 0) {
            jsonResponse(400, { error: 'Cannot checkout with empty items list' });
            return;
          }

          // Ensure canonical user exists
          const user = this.repos.users.upsertCanonicalUser({
            name: customerName,
            mobile: customerMobile,
            email: customerEmail
          });

          // Calculate order totals: exactly the discounted price (or regular price if no discount)
          let subtotal = 0;
          const resolvedItems = [];
          for (const it of items) {
            let unitPrice = it.unitPrice !== undefined && it.unitPrice !== null ? Number(it.unitPrice) : null;
            if ((unitPrice === null || isNaN(unitPrice)) && it.productId) {
              const p = this.repos.products.findById(it.productId);
              if (p) {
                unitPrice = (p.discount_price !== null && p.discount_price !== undefined) ? Number(p.discount_price) : Number(p.price);
              }
            }
            const priceVal = Number(unitPrice || 0);
            const qtyVal = Number(it.quantity || 1);
            subtotal += priceVal * qtyVal;
            resolvedItems.push({
              ...it,
              unitPrice: priceVal,
              quantity: qtyVal
            });
          }
          // Resolve shipping fee dynamically:
          // If shipping fee is passed by client (calculated via Shiprocket shipping service), use it.
          // Otherwise default to 0.
          const shippingFee = Number(body.shippingFee || body.shipping_fee || 0);

          // Handle coupon application and discount calculation
          const couponCode = body.couponCode || body.coupon_code || null;
          let calculatedDiscount = 0;
          let appliedCoupon = null;

          if (couponCode) {
            const validation = this.repos.coupons.validateCoupon({
              code: couponCode,
              userId: user.id,
              items: resolvedItems,
              subtotal,
              shippingFee
            });

            if (validation.valid) {
              calculatedDiscount = validation.discountAmount;
              appliedCoupon = validation.coupon;
              this.repos.coupons.incrementUsage(couponCode);
              this.logger.info(`Coupon ${couponCode} applied to order: Discount ₹${calculatedDiscount}`, { category: 'orders' });
            } else {
              this.logger.warn(`Coupon ${couponCode} validation failed: ${validation.error}`, { category: 'orders' });
            }
          }

          const rawTotal = (subtotal + shippingFee) - calculatedDiscount;
          const totalAmount = Number(Math.max(0, rawTotal).toFixed(2));
          const windowStartIso = new Date().toISOString();
          const windowEndIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();

          // 1. Create the canonical order in database with status 'PLACED'
          const order = this.repos.orders.createOrder({
            userId: user.id,
            customerName: user.name,
            customerEmail: user.email,
            customerMobile: user.mobile,
            shippingAddress,
            totalAmount,
            subtotalAmount: subtotal,
            discountAmount: calculatedDiscount,
            shippingFee,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            paymentMethod: paymentMethod.toUpperCase(),
            paymentStatus: 'PENDING',
            orderStatus: 'PLACED',
            notes,
            manualPaymentVerified: false,
            paymentWindowStart: windowStartIso,
            paymentWindowEnd: windowEndIso
          }, resolvedItems);

          this.logger.info(`Order placed: ${order.order_number} by ${user.name} (Amount: ₹${totalAmount})`, {
            category: 'orders',
            userId: user.id,
            orderId: order.order_number,
            details: { amount: totalAmount, paymentMethod }
          });

          // Emit ORDER_CREATED event
          globalEventBus.publish(createEvent(EVENT_TYPES.ORDER_CREATED, {
            orderId: order.id,
            orderNumber: order.order_number,
            userId: user.id,
            customerName: user.name,
            customerMobile: user.mobile,
            customerEmail: user.email,
            totalAmount,
            paymentMethod: paymentMethod.toUpperCase(),
            items
          }));

          // Alert Store Owner directly on WhatsApp from Bot
          try {
            const branding = this.getStoreBranding();
            const storeName = branding.store_name || 'VIENTA';
            const ownerPhone = this.getStoreOwnerWhatsAppPhone();
            const windowFormatted = `${new Date(windowStartIso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })} – ${new Date(windowEndIso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
            const itemNames = (resolvedItems || []).map(it => `${it.product_name || it.name} (x${it.quantity})`).join(', ');
            const ownerOrderAlert = `🛍️ *[${storeName}] New Customer Order!*\n\n• Order: *#${order.order_number}*\n• Customer: *${user.name}* (${user.mobile})\n• Amount: *₹${totalAmount}*\n• Items: ${itemNames}\n• 5-Min UPI Window: *${windowFormatted}*\n• Status: *Awaiting Payment Verification*\n\n👉 Verification required in Admin Panel before dispatch.`;
            this.dispatchWhatsApp({
              to: ownerPhone,
              message: ownerOrderAlert,
              orderId: order.order_number,
              source: 'owner-new-order-alert'
            }).catch(() => {});
          } catch {}

          // 2. Handle Payment Flow
          if (paymentMethod.toUpperCase() === 'CASH') {
            // Cash on Delivery: Order confirmed immediately in cash mode
            jsonResponse(201, {
              success: true,
              order,
              payment: {
                method: 'CASH',
                status: 'PENDING',
                instructions: 'Please keep exact cash ready upon delivery.'
              },
              redirectUrl: null
            });
            return;
          }

          // UPI Flow: Create Payment Session via YouPi Payment Gateway API (Port 6100)
          let paymentSession = null;
          let checkoutPortalUrl = null;

          // Dynamically adapt checkout portal URL and return URL for live domain
          this.reloadEnvConfig();
          const primaryDomain = (process.env.PRIMARY_DOMAIN || '').trim();
          const domainExt = (process.env.DOMAIN_EXTENSION || '.shop').trim();
          const isRealDomain = Boolean(primaryDomain && primaryDomain !== 'localhost' && primaryDomain !== '127.0.0.1');

          const rawHost = req.headers['x-forwarded-host'] || req.headers.host || '';
          const reqHost = rawHost.split(':')[0];
          const isHostLocal = !reqHost || reqHost === 'localhost' || reqHost === '127.0.0.1';

          let checkoutBase = (process.env.BASE_CHECKOUT_URL || '').trim();
          let returnUrlTemplate = (process.env.PAYMENT_SUCCESS_RETURN_URL || '').trim();

          // If Credential Centre has configured domain, prioritize public domain
          if (isRealDomain && (process.env.ENVIRONMENT_MODE === 'PRODUCTION' || checkoutBase.includes(primaryDomain))) {
            checkoutBase = `https://pay.${primaryDomain}${domainExt}`;
            returnUrlTemplate = `https://${primaryDomain}${domainExt}/account/orders/{order_number}?paymentSuccess=true`;
          } else if (!checkoutBase || checkoutBase.includes('localhost') || checkoutBase.includes('127.0.0.1')) {
            if (isRealDomain) {
              checkoutBase = `https://pay.${primaryDomain}${domainExt}`;
              returnUrlTemplate = `https://${primaryDomain}${domainExt}/account/orders/{order_number}?paymentSuccess=true`;
            } else {
              checkoutBase = URLS.CHECKOUT_PORTAL || `http://localhost:${PORTS.CHECKOUT_PORTAL || 7000}`;
              returnUrlTemplate = `${URLS.STOREFRONT}/account/orders/{order_number}?paymentSuccess=true`;
            }
          }

          if (!isHostLocal && reqHost) {
            let rootDomain = reqHost;
            const parts = reqHost.split('.');
            if (parts.length >= 2) {
              if (parts.length > 2 && (parts[0] === 'api' || parts[0] === 'store' || parts[0] === 'www')) {
                rootDomain = parts.slice(1).join('.');
              }
            }
            if (!checkoutBase.startsWith('https://')) {
              checkoutBase = `https://pay.${rootDomain}`;
            }
            if (!returnUrlTemplate.startsWith('https://')) {
              returnUrlTemplate = `https://${rootDomain}/account/orders/{order_number}?paymentSuccess=true`;
            }
          }

          try {
            const amountPaise = Math.round(totalAmount * 100);
            const paymentApiUrl = INTERNAL_URLS.PAYMENT_API || URLS.PAYMENT_API;
            const gatewayRes = await fetch(`${paymentApiUrl}/api/v1/payments`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Merchant-Id': this.merchantId
              },
              body: JSON.stringify({
                merchantId: this.merchantId,
                orderId: order.order_number,
                amount: totalAmount,
                amountPaise,
                currency: 'INR',
                autoActivate: true,
                customer: {
                  name: user.name,
                  fullName: user.name,
                  mobile: user.mobile,
                  mobileNumber: user.mobile,
                  phoneNumber: user.mobile,
                  email: user.email
                },
                metadata: {
                  orderId: order.id,
                  orderNumber: order.order_number,
                  userId: user.id
                },
                returnUrl: returnUrlTemplate.replace('{order_number}', encodeURIComponent(order.order_number))
              })
            });

            if (gatewayRes.ok) {
              const gatewayData = await gatewayRes.json();
              const paymentId = gatewayData.paymentId || gatewayData.id;

              // Link gateway payment ID to order
              if (this.repos.orders.setPaymentDetails) {
                this.repos.orders.setPaymentDetails(order.id, {
                  windowStart: windowStartIso,
                  windowEnd: windowEndIso,
                  gatewayId: paymentId
                });
              }

              // Store payment record in database
              paymentSession = this.repos.payments.createPayment({
                id: paymentId,
                orderId: order.id,
                userId: user.id,
                gateway: 'YOUPI_PG_V2',
                gatewayPaymentId: paymentId,
                amount: totalAmount,
                method: 'UPI',
                status: 'INITIATED',
                metadata: {
                  checkoutUrl: gatewayData.checkoutUrl,
                  upiUri: gatewayData.upiUri,
                  returnUrl: gatewayData.returnUrl || returnUrlTemplate.replace('{order_number}', encodeURIComponent(order.order_number))
                }
              });

              checkoutPortalUrl = gatewayData.checkoutUrl || `${checkoutBase}/checkout/${paymentId}`;
            } else {
              this.logger.warn(`Gateway payment session creation failed for order ${order.order_number}`);
            }
          } catch (err) {
            this.logger.error(`Error connecting to Payment Gateway API: ${err.message}`);
          }

          // Fallback if payment API offline: create local payment record & point to checkout portal
          if (!paymentSession) {
            const fallbackPaymentId = `PAY_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            paymentSession = this.repos.payments.createPayment({
              id: fallbackPaymentId,
              orderId: order.id,
              userId: user.id,
              gateway: 'YOUPI_PG_V2',
              gatewayPaymentId: fallbackPaymentId,
              amount: totalAmount,
              method: 'UPI',
              status: 'INITIATED'
            });
            checkoutPortalUrl = `${checkoutBase}/checkout/${fallbackPaymentId}`;
          }

          jsonResponse(201, {
            success: true,
            order,
            payment: paymentSession,
            checkoutPortalUrl,
            checkoutUrl: checkoutPortalUrl,
            paymentId: paymentSession?.id
          });
          return;
        }

        // List Orders
        if (pathname === '/api/v1/orders' && method === 'GET') {
          const userId = url.searchParams.get('userId');
          const orderStatus = url.searchParams.get('status');
          const paymentStatus = url.searchParams.get('paymentStatus');
          const search = url.searchParams.get('search');
          const limit = Number(url.searchParams.get('limit') || 50);
          const offset = Number(url.searchParams.get('offset') || 0);

          const orders = this.repos.orders.list({ userId, orderStatus, paymentStatus, search, limit, offset });
          jsonResponse(200, { success: true, count: orders.length, orders });
          return;
        }

        // Single Order Consolidated View (Section 12)
        const orderMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)$/);
        if (orderMatch && method === 'GET') {
          const orderIdOrNumber = orderMatch[1];
          const order = this.repos.orders.getOrderFullDetails(orderIdOrNumber);
          if (!order) {
            jsonResponse(404, { error: 'Order not found' });
            return;
          }
          jsonResponse(200, { success: true, order });
          return;
        }

        // Admin Manual Payment Approval (Unlocks Order Lifecycle Actions)
        const orderApproveMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)\/approve-payment$/);
        if (orderApproveMatch && method === 'POST') {
          const orderId = orderApproveMatch[1];
          const existingOrder = this.repos.orders.findById(orderId) || this.repos.orders.findByOrderNumber(orderId);
          if (!existingOrder) {
            jsonResponse(404, { success: false, error: 'Order not found' });
            return;
          }

          const updatedOrder = this.repos.orders.approvePayment(existingOrder.id);
          this.logger.info(`Payment manually verified & approved for order ${updatedOrder.order_number}`, {
            category: 'orders',
            orderId: updatedOrder.order_number
          });

          // Dispatches WhatsApp confirmation to customer and notification to owner
          try {
            const branding = this.getStoreBranding();
            const storeName = branding.store_name || 'VIENTA';
            const custMsg = `✅ *[${storeName}] Payment Confirmed!*\n\nHi ${updatedOrder.customer_name},\nYour payment of *₹${Number(updatedOrder.total_amount).toLocaleString('en-IN')}* for order *#${updatedOrder.order_number}* has been verified and confirmed! We are now preparing your order for dispatch.\n\n— *${storeName}*`;
            const ownerMsg = `🛡️ *[${storeName}] Payment Approved*\n\nOrder: *#${updatedOrder.order_number}* (${updatedOrder.customer_name})\nAmount: *₹${Number(updatedOrder.total_amount).toLocaleString('en-IN')}*\nStatus: *VERIFIED & PAID*\nLifecycle fulfillment actions are now unlocked.`;

            this.dispatchWhatsApp({
              to: updatedOrder.customer_mobile,
              message: custMsg,
              orderId: updatedOrder.order_number,
              source: 'payment_verified_customer',
              alertOwner: true,
              ownerAlertMessage: ownerMsg
            }).catch(() => {});
          } catch {}

          jsonResponse(200, { success: true, order: updatedOrder });
          return;
        }

        // Admin Dispatch WhatsApp Payment Verification Request (Internal Baileys Dispatcher - No wa.me links)
        const orderProofMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)\/request-payment-proof$/);
        if (orderProofMatch && method === 'POST') {
          const orderId = orderProofMatch[1];
          const order = this.repos.orders.findById(orderId) || this.repos.orders.findByOrderNumber(orderId);
          if (!order) {
            jsonResponse(404, { success: false, error: 'Order not found' });
            return;
          }

          if (!order.customer_mobile) {
            jsonResponse(400, { success: false, error: 'Customer mobile number is missing for this order.' });
            return;
          }

          const branding = this.getStoreBranding();
          const storeName = branding.store_name || 'VIENTA';
          const custName = order.customer_name || 'Customer';
          const totalAmt = Number(order.total_amount).toLocaleString('en-IN');

          // 1. WhatsApp message to Customer from Bot
          const custMsg = `Hello ${custName}, we encountered a brief technical delay while automatically confirming your payment of ₹${totalAmt} for order #${order.order_number}.\n\nCould you please share the screenshot of the payment you made with all details like UTR and time so we can verify and dispatch your order promptly?\n\nThank you!\n— *${storeName} Team*`;

          // 2. WhatsApp alert to Owner from Bot
          const windowStart = order.payment_window_start ? new Date(order.payment_window_start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'N/A';
          const windowEnd = order.payment_window_end ? new Date(order.payment_window_end).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'N/A';
          const ownerAlertMsg = `📩 *[${storeName}] Payment Proof Dispatched*\n\nScreenshot request sent to customer *${custName}* (${order.customer_mobile}) for order *#${order.order_number}* (₹${totalAmt}).\n• 5-Min UPI Window: ${windowStart} – ${windowEnd}\n• Awaiting customer payment screenshot.`;

          // Dispatch to Customer via Internal Dispatcher + Alert Owner
          const dispatchRes = await this.dispatchWhatsApp({
            to: order.customer_mobile,
            message: custMsg,
            orderId: order.order_number,
            source: 'payment_screenshot_request',
            alertOwner: true,
            ownerAlertMessage: ownerAlertMsg
          });

          // Log in order timeline
          try {
            this.repos.orders.addTimelineEntry({
              orderId: order.id,
              previousStatus: order.order_status,
              newStatus: order.order_status,
              comment: `Dispatched payment screenshot request to customer WhatsApp (${order.customer_mobile})`,
              actorType: 'ADMIN',
              actorId: req.headers['x-user-id'] || 'ADMIN'
            });
          } catch {}

          const refreshed = this.repos.orders.getOrderFullDetails(order.id);
          jsonResponse(200, {
            success: true,
            message: `WhatsApp payment screenshot request dispatched to customer (${order.customer_mobile}) from bot!`,
            order: refreshed,
            dispatchMode: dispatchRes.mode || 'dispatched'
          });
          return;
        }

        // Admin Revoke Payment Approval (Relocks Order Lifecycle Actions)
        const orderRevokeMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)\/revoke-payment$/);
        if (orderRevokeMatch && method === 'POST') {
          const orderId = orderRevokeMatch[1];
          const existingOrder = this.repos.orders.findById(orderId) || this.repos.orders.findByOrderNumber(orderId);
          if (!existingOrder) {
            jsonResponse(404, { success: false, error: 'Order not found' });
            return;
          }

          const updatedOrder = this.repos.orders.revokePayment(existingOrder.id);
          this.logger.info(`Payment approval revoked for order ${updatedOrder.order_number}`, {
            category: 'orders',
            orderId: updatedOrder.order_number
          });
          jsonResponse(200, { success: true, order: updatedOrder });
          return;
        }

        // Admin Order Lifecycle Transition (Section 13, 15)
        const orderStatusMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)\/status$/);
        if (orderStatusMatch && method === 'POST') {
          const orderId = orderStatusMatch[1];
          const body = await readJsonBody();
          const { status, comment } = body;

          if (!status) {
            jsonResponse(400, { error: 'Status is required' });
            return;
          }

          const existingOrder = this.repos.orders.findById(orderId) || this.repos.orders.findByOrderNumber(orderId);
          if (!existingOrder) {
            jsonResponse(404, { success: false, error: 'Order not found' });
            return;
          }

          // LIFECYCLE LOCK: Cannot execute lifecycle transitions if payment is not verified by admin
          if (!existingOrder.manual_payment_verified && status.toUpperCase() !== 'CANCELLED') {
            jsonResponse(403, {
              success: false,
              error: 'Order lifecycle is locked: payment must be manually verified and approved in Admin Panel before performing this action.'
            });
            return;
          }

          const updatedOrder = this.repos.orders.updateStatus(
            orderId,
            status.toUpperCase(),
            comment,
            'ADMIN',
            req.headers['x-user-id'] || 'ADMIN'
          );

          this.logger.info(`Order ${updatedOrder.order_number} status changed to ${status.toUpperCase()}`, {
            category: 'orders',
            orderId: updatedOrder.order_number,
            details: { newStatus: status, comment }
          });

          // Emit lifecycle event to trigger dynamic WhatsApp notifications (Section 15)
          const eventTypeMap = {
            CONFIRMED: EVENT_TYPES.ORDER_CONFIRMED,
            PROCESSING: EVENT_TYPES.ORDER_PROCESSING,
            SHIPPED: EVENT_TYPES.ORDER_SHIPPED,
            DELAYED: EVENT_TYPES.ORDER_DELAYED,
            DELIVERED: EVENT_TYPES.ORDER_DELIVERED,
            CANCELLED: EVENT_TYPES.ORDER_CANCELLED,
            REFUNDED: EVENT_TYPES.ORDER_REFUNDED
          };

          const eventType = eventTypeMap[status.toUpperCase()] || EVENT_TYPES.ORDER_CONFIRMED;

          globalEventBus.publish(createEvent(eventType, {
            orderId: updatedOrder.id,
            orderNumber: updatedOrder.order_number,
            userId: updatedOrder.user_id,
            customerName: updatedOrder.customer_name,
            customerMobile: updatedOrder.customer_mobile,
            customerEmail: updatedOrder.customer_email,
            totalAmount: updatedOrder.total_amount,
            status: status.toUpperCase(),
            trackingNumber: updatedOrder.shipments?.tracking_number || null,
            carrier: updatedOrder.shipments?.carrier || 'BlueDart Express'
          }));

          jsonResponse(200, { success: true, order: updatedOrder });
          return;
        }

        // Admin Dedicated Order Tracking Dispatch (Dynamic WhatsApp Notification)
        const orderTrackingMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)\/send-tracking$/);
        if (orderTrackingMatch && method === 'POST') {
          const orderIdOrNumber = orderTrackingMatch[1];
          const body = await readJsonBody();
          const order = this.repos.orders.getOrderFullDetails(orderIdOrNumber);
          if (!order) {
            jsonResponse(404, { success: false, error: 'Order not found' });
            return;
          }

          // LIFECYCLE LOCK: Cannot dispatch tracking if payment is not verified by admin
          if (!order.manual_payment_verified) {
            jsonResponse(403, {
              success: false,
              error: 'Order lifecycle is locked: payment must be manually verified and approved in Admin Panel before dispatching tracking details.'
            });
            return;
          }

          const carrier = (body.carrier || '').trim();
          const trackingNumber = (body.trackingNumber || body.tracking_number || '').trim();
          const trackingLink = (body.trackingLink || body.tracking_link || '').trim();

          // 1. Update or create shipments row in database if fields are provided
          try {
            const existingShipment = this.repos.db.queryOne('SELECT id FROM shipments WHERE order_id = $1', [order.id]);
            if (existingShipment) {
              let updateSql = 'UPDATE shipments SET updated_at = datetime("now")';
              const params = [];
              if (carrier) {
                updateSql += `, carrier = $${params.length + 1}`;
                params.push(carrier);
              }
              if (trackingNumber) {
                updateSql += `, tracking_number = $${params.length + 1}`;
                params.push(trackingNumber);
              }
              updateSql += ` WHERE order_id = $${params.length + 1}`;
              params.push(order.id);
              this.repos.db.execute(updateSql, params);
            } else {
              this.repos.db.execute(
                `INSERT INTO shipments (id, order_id, tracking_number, carrier, status, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, 'IN_TRANSIT', datetime('now'), datetime('now'))`,
                [
                  `SHP_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  order.id,
                  trackingNumber || null,
                  carrier || 'Express Courier Surface'
                ]
              );
            }
          } catch (shipErr) {
            this.logger.warn(`Shipment record update warning: ${shipErr.message}`);
          }

          // 2. Build dynamic WhatsApp tracking message (All 3 fields optional)
          const branding = this.getStoreBranding();
          const storeName = branding.store_name || 'VIENTA';
          const storeTagline = branding.store_tagline || 'Premium Clothing';
          const custName = order.customer_name || 'Valued Customer';
          const urls = this.getPublicUrls(req);
          const storeOrderUrl = `${urls.storefront}/account/orders/${order.order_number}`;

          let trackingMsg = `📦 *[${storeName}] Shipment & Tracking Details*\n\n`;
          trackingMsg += `Hi ${custName},\nHere are the live tracking details for your order *#${order.order_number}*:\n\n`;
          trackingMsg += `• Courier Partner: *${carrier || 'Express Courier Surface'}*\n`;
          if (trackingNumber) {
            trackingMsg += `• Tracking AWB / No: *${trackingNumber}*\n`;
          } else {
            trackingMsg += `• Tracking Status: *Dispatched & In Transit*\n`;
          }

          if (trackingLink) {
            trackingMsg += `• Live Courier Tracking Link:\n${trackingLink}\n\n`;
            trackingMsg += `• Order Summary & Status:\n${storeOrderUrl}\n`;
          } else {
            trackingMsg += `• Live Order Tracking Link:\n${storeOrderUrl}\n`;
          }

          trackingMsg += `\n— *${storeName} Logistics*\n_${storeTagline}_`;

          // 3. Dispatch to customer via WhatsApp
          try {
            await fetch(`${URLS.WHATSAPP_AUTH_API || 'http://localhost:4000'}/api/v1/messages/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: order.customer_mobile,
                message: trackingMsg,
                orderId: order.order_number,
                source: 'commerce-api'
              }),
              signal: AbortSignal.timeout(5000)
            }).catch(() => {});
          } catch (e) {}

          // Safely log in notifications repository
          try {
            if (this.repos.notifications) {
              this.repos.notifications.createNotification({
                userId: order.user_id || null,
                channel: 'WHATSAPP',
                recipient: order.customer_mobile,
                destination: order.customer_mobile,
                templateId: 'order_tracking_dispatch',
                template: 'order_tracking_dispatch',
                content: trackingMsg,
                body: trackingMsg,
                status: 'SENT',
                sentAt: new Date().toISOString()
              });
            }
          } catch (e) {}

          // 4. Alert store owner
          try {
            const ownerPhone = this.getStoreOwnerWhatsAppPhone();
            if (ownerPhone) {
              const ownerTrackingMsg = `📦 *[${storeName}] Tracking Dispatched to Customer*\n\nOrder *#${order.order_number}* (${custName})\n• Courier: *${carrier || 'Express Courier Surface'}*\n• AWB: *${trackingNumber || 'Assigned'}*\n• Link: ${trackingLink || storeOrderUrl}\n\n— *${storeName} Operations*`;
              await fetch(`${URLS.WHATSAPP_AUTH_API || 'http://localhost:4000'}/api/v1/messages/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to: ownerPhone,
                  message: ownerTrackingMsg,
                  orderId: order.order_number,
                  source: 'commerce-api'
                }),
                signal: AbortSignal.timeout(5000)
              }).catch(() => {});
            }
          } catch (e) {}

          // Log audit
          this.repos.audit.logAction({
            actor: req.headers['x-user-id'] || 'ADMIN',
            action: 'ORDER_TRACKING_DISPATCHED',
            resource: 'orders',
            resourceId: order.id,
            afterData: { carrier, trackingNumber, trackingLink }
          });

          const refreshed = this.repos.orders.getOrderFullDetails(order.id);
          jsonResponse(200, {
            success: true,
            message: 'Tracking details WhatsApp message dispatched to customer!',
            order: refreshed
          });
          return;
        }

        // =========================================================================
        // 5. PAYMENT WEBHOOK RECEIVER (Section 20 & 21)
        // =========================================================================
        if (pathname === '/api/v1/webhooks/payment' && method === 'POST') {
          const rawBody = await readRawBody();
          let body = {};
          try { body = rawBody ? JSON.parse(rawBody) : {}; } catch {}

          const signature = req.headers['x-gateway-signature'];
          const eventType = req.headers['x-gateway-event'] || body.event || body.status;

          this.logger.info(`Received Payment Gateway Webhook: ${eventType}`, {
            category: 'payments',
            details: body
          });

          // Verify HMAC Signature (Supports both raw and sha256= prefix formats)
          if (signature) {
            const rawSig = signature.startsWith('sha256=') ? signature.replace('sha256=', '') : signature;
            const expectedSig = crypto
              .createHmac('sha256', this.webhookSecret)
              .update(rawBody)
              .digest('hex');

            let isValid = false;
            try {
              if (rawSig.length === expectedSig.length) {
                isValid = crypto.timingSafeEqual(Buffer.from(rawSig, 'utf8'), Buffer.from(expectedSig, 'utf8'));
              }
            } catch {}

            if (!isValid && process.env.NODE_ENV === 'production') {
              this.logger.error('Invalid payment webhook signature');
              jsonResponse(401, { error: 'Invalid HMAC signature' });
              return;
            }
          }

          const orderId = body.orderId || body.order_id || body.data?.orderId;
          const paymentId = body.paymentId || body.payment_id || body.data?.paymentId;
          const status = (body.status || body.event || eventType || '').toUpperCase();
          const amount = body.amount || body.data?.amount;
          const utr = body.utr || body.bankRef || body.reference || body.transactionId || body.data?.utr;

          if (!orderId) {
            jsonResponse(400, { error: 'Missing orderId in webhook payload' });
            return;
          }

          const order = this.repos.orders.findByOrderNumber(orderId) || this.repos.orders.findById(orderId);
          if (!order) {
            this.logger.warn(`Webhook received for non-existent order: ${orderId}`);
            jsonResponse(404, { error: 'Order not found' });
            return;
          }

          if (status === 'SUCCESS' || eventType === 'SUCCESS' || eventType === 'payment.success') {
            // Authoritatively update order payment status
            this.repos.orders.updatePaymentStatus(order.id, 'SUCCESS');
            this.repos.orders.updateStatus(order.id, 'CONFIRMED', `Payment verified via YouPi PG V2 (Txn/UTR: ${utr || paymentId})`, 'GATEWAY');

            // Update payment record
            if (paymentId) {
              try {
                this.repos.payments.updateStatus(paymentId, 'SUCCESS', 'VERIFIED_GATEWAY', {
                  ...body,
                  utr: utr || null
                });
              } catch {}
            }

            // Emit PAYMENT_SUCCESS event -> triggers WhatsApp payment confirmation!
            globalEventBus.publish(createEvent(EVENT_TYPES.PAYMENT_SUCCESS, {
              orderId: order.id,
              orderNumber: order.order_number,
              userId: order.user_id,
              customerName: order.customer_name,
              customerMobile: order.customer_mobile,
              customerEmail: order.customer_email,
              amount: amount || order.total_amount,
              paymentMethod: 'UPI',
              transactionId: utr || paymentId || `TXN_${Date.now()}`
            }));
          } else if (status === 'FAILED' || status === 'EXPIRED' || status === 'CANCELLED' || String(eventType).includes('FAILED') || String(eventType).includes('CANCELLED') || String(eventType).includes('EXPIRED')) {
            this.repos.orders.updatePaymentStatus(order.id, 'FAILED');
            this.repos.orders.updateStatus(order.id, 'CANCELLED', `Payment ${status || 'FAILED'} via Gateway`, 'GATEWAY');
            if (paymentId) {
              try { this.repos.payments.updateStatus(paymentId, 'FAILED', `${status || 'FAILED'}_GATEWAY`, body); } catch {}
            }

            globalEventBus.publish(createEvent(EVENT_TYPES.PAYMENT_FAILED, {
              orderId: order.id,
              orderNumber: order.order_number,
              userId: order.user_id,
              customerName: order.customer_name,
              customerMobile: order.customer_mobile,
              customerEmail: order.customer_email,
              amount: amount || order.total_amount,
              failureReason: body.reason || status || 'Transaction declined or timed out'
            }));
          }

          jsonResponse(200, { success: true, processed: true });
          return;
        }

        // Direct payment failure notification endpoint (called from checkout-portal or storefront upon failed/cancelled payment)
        const orderFailMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)\/payment-failed$/);
        if (orderFailMatch && method === 'POST') {
          const orderIdOrNumber = orderFailMatch[1];
          const body = await readJsonBody();
          const order = this.repos.orders.findByOrderNumber(orderIdOrNumber) || this.repos.orders.findById(orderIdOrNumber);
          if (order) {
            this.repos.orders.updatePaymentStatus(order.id, 'FAILED');
            this.repos.orders.updateStatus(order.id, 'CANCELLED', `Payment failed or expired (${body.reason || 'FAILED'})`, 'GATEWAY');
            if (body.paymentId) {
              try { this.repos.payments.updateStatus(body.paymentId, 'FAILED', `${body.reason || 'FAILED'}_GATEWAY`, body); } catch {}
            }
            this.logger.info(`Order ${order.order_number} marked CANCELLED/PAYMENT_FAILED (Reason: ${body.reason || 'FAILED'})`, { category: 'orders' });

            globalEventBus.publish(createEvent(EVENT_TYPES.ORDER_CANCELLED, {
              orderId: order.id,
              orderNumber: order.order_number,
              customerName: order.customer_name,
              customerMobile: order.customer_mobile,
              totalAmount: order.total_amount,
              reason: body.reason || 'Payment unconfirmed or expired'
            }));

            jsonResponse(200, { success: true, orderId: order.id, orderNumber: order.order_number, status: 'CANCELLED', paymentStatus: 'FAILED' });
            return;
          }
          jsonResponse(404, { error: 'Order not found' });
          return;
        }

        // Confirm Order with Cash on Delivery (COD)
        const orderCodMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)\/confirm-cod$/);
        if (orderCodMatch && method === 'POST') {
          const orderIdOrNumber = orderCodMatch[1];
          const body = await readJsonBody();
          const order = this.repos.orders.findByOrderNumber(orderIdOrNumber) || this.repos.orders.findById(orderIdOrNumber);
          if (order) {
            this.repos.db.execute("UPDATE orders SET payment_method = 'COD', payment_status = 'PENDING', order_status = 'CONFIRMED', updated_at = datetime('now') WHERE id = $1", [order.id]);
            this.repos.orders.updateStatus(order.id, 'CONFIRMED', 'Order confirmed with Cash on Delivery (COD)', 'CUSTOMER');

            const customerName = order.customer_name || body.customerName || 'Customer';
            const customerMobile = order.customer_mobile || body.customerMobile;
            const amount = order.total_amount || body.amount;

            // 1. Dispatch dynamic WhatsApp notification to customer FIRST
            const msg = `🛍️ *Order Confirmed with Cash on Delivery!*\n\nHi ${customerName},\nYour order *#${order.order_number}* for *₹${amount}* has been confirmed!\nYou will pay in cash when the delivery courier arrives at your address.\n\nTrack order: ${URLS.STOREFRONT}/account/orders/${order.order_number}`;

            try {
              await fetch(`${URLS.WHATSAPP_WORKER || 'http://localhost:4001'}/api/v1/messages/send`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${process.env.WORKER_INTERNAL_SECRET || 'worker_secret_key_change_me_in_prod_abcde'}`
                },
                body: JSON.stringify({ to: customerMobile, message: msg })
              });
            } catch (e) {}

            // 2. ONLY AFTER customer notification is dispatched, send incoming order alert to store owner
            const ownerPhone = this.getStoreOwnerWhatsAppPhone();
            if (ownerPhone && ownerPhone !== customerMobile) {
              try {
                const fullOrder = this.repos.orders.getOrderFullDetails(order.id);
                let itemsSummary = '• Items value: ₹' + amount;
                if (fullOrder?.items && fullOrder.items.length > 0) {
                  itemsSummary = fullOrder.items.map(it => `• ${it.product_name || it.name} (x${it.quantity}) - ₹${it.unit_price}`).join('\n');
                }
                const addr = fullOrder?.shipping_address || {};
                const addrStr = [addr.addressLine, addr.city, addr.state, addr.zip].filter(Boolean).join(', ') || 'Standard Delivery';

                const ownerMsg = `🔔 *NEW COD ORDER RECEIVED!*\n\n• Order ID: *#${order.order_number}*\n• Customer: *${customerName}* (${customerMobile || 'No phone'})\n• Amount: *₹${amount}* (Cash on Delivery)\n• Status: *CONFIRMED*\n\n📍 *Delivery Address:*\n${addrStr}\n\n🛒 *Items Ordered:*\n${itemsSummary}\n\n👉 Open Admin Panel: http://localhost:5050/#orders`;

                fetch(`${URLS.WHATSAPP_WORKER || 'http://localhost:4001'}/api/v1/messages/send`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.WORKER_INTERNAL_SECRET || 'worker_secret_key_change_me_in_prod_abcde'}`
                  },
                  body: JSON.stringify({ to: ownerPhone, message: ownerMsg })
                }).catch(() => {});
              } catch (e) {}
            }

            this.logger.info(`Order ${order.order_number} confirmed with Cash on Delivery (Customer & Owner alerted)`, { category: 'orders' });
            jsonResponse(200, { success: true, orderId: order.id, orderNumber: order.order_number, status: 'CONFIRMED', paymentMethod: 'COD' });
            return;
          }
          jsonResponse(404, { error: 'Order not found' });
          return;
        }

        // =========================================================================
        // 6. CUSTOMER SUPPORT (Section 23, 24)
        // =========================================================================
        if (pathname === '/api/v1/support/tickets' && method === 'GET') {
          const userId = url.searchParams.get('userId');
          const status = url.searchParams.get('status');
          const tickets = this.repos.support.listTickets({ userId, status });
          jsonResponse(200, { success: true, tickets });
          return;
        }

        if (pathname === '/api/v1/support/tickets' && method === 'POST') {
          const body = await readJsonBody();
          const { userId, orderId, subject, category, initialMessage } = body;

          if (!userId || !subject || !initialMessage) {
            jsonResponse(400, { error: 'userId, subject, and initialMessage are required' });
            return;
          }

          const ticket = this.repos.support.createTicket({
            userId,
            orderId,
            subject,
            category: category || 'ORDER_INQUIRY',
            initialMessage
          });

          globalEventBus.publish(createEvent(EVENT_TYPES.SUPPORT_TICKET_CREATED, {
            ticketId: ticket.id,
            userId,
            orderId,
            subject
          }));

          jsonResponse(201, { success: true, ticket });
          return;
        }

        const ticketMatch = pathname.match(/^\/api\/v1\/support\/tickets\/([^/]+)$/);
        if (ticketMatch && method === 'GET') {
          const ticketId = ticketMatch[1];
          const ticket = this.repos.support.getTicketWithMessages(ticketId);
          if (!ticket) {
            jsonResponse(404, { error: 'Support ticket not found' });
            return;
          }
          jsonResponse(200, { success: true, ticket });
          return;
        }

        // Update Support Ticket Status: PATCH /api/v1/support/tickets/:id
        if (ticketMatch && (method === 'PATCH' || method === 'PUT')) {
          const ticketId = ticketMatch[1];
          const body = await readJsonBody();
          const { status } = body;
          if (!status) {
            jsonResponse(400, { error: 'Status is required' });
            return;
          }
          this.repos.support.updateTicketStatus(ticketId, status);
          const updated = this.repos.support.getTicketWithMessages(ticketId);
          jsonResponse(200, { success: true, ticket: updated });
          return;
        }

        const msgMatch = pathname.match(/^\/api\/v1\/support\/tickets\/([^/]+)\/messages$/);
        if (msgMatch && method === 'POST') {
          const ticketId = msgMatch[1];
          const body = await readJsonBody();
          const { senderType, senderId, content, messageType } = body;

          if (!content) {
            jsonResponse(400, { error: 'Message content is required' });
            return;
          }

          const message = this.repos.support.addMessage({
            ticketId,
            senderType: senderType || 'customer',
            senderId: senderId || 'ANON',
            messageType: messageType || 'text',
            content
          });

          // If message is from admin, dispatch WhatsApp alert to customer if phone available
          if ((senderType || '').toLowerCase() === 'admin') {
            try {
              const fullTicket = this.repos.support.getTicketWithMessages(ticketId);
              const custPhone = fullTicket?.customer?.mobile;
              if (custPhone) {
                const waPayload = JSON.stringify({
                  to: custPhone,
                  message: `🎧 *Customer Support Reply*\n\nHi ${fullTicket.customer.name || 'Customer'},\nOur support agent has replied to your request (*Ticket #${ticketId}*):\n\n"${content}"\n\nContinue chat: ${URLS.STOREFRONT}/account`
                });
                fetch(`${URLS.WHATSAPP_WORKER || 'http://localhost:4001'}/api/v1/messages/send`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.WORKER_INTERNAL_SECRET || 'worker_secret_key_change_me_in_prod_abcde'}`
                  },
                  body: waPayload
                }).catch(() => {});
              }
            } catch (e) {}
          }

          globalEventBus.publish(createEvent(EVENT_TYPES.SUPPORT_MESSAGE_RECEIVED, {
            ticketId,
            senderType,
            content
          }));

          jsonResponse(201, { success: true, message });
          return;
        }

        // =========================================================================
        // 6.5. COUPON ENGINE & DISCOUNT PROMOTIONS (New Feature)
        // =========================================================================
        // Customer / Storefront: List active eligible coupons
        if (pathname === '/api/v1/coupons' && method === 'GET') {
          const userId = url.searchParams.get('userId');
          const subtotal = Number(url.searchParams.get('subtotal') || url.searchParams.get('itemsSubtotal') || 0);
          const shippingFee = Number(url.searchParams.get('shippingFee') || 0);

          const allCoupons = this.repos.coupons.list({ status: 'ACTIVE', limit: 20 });
          const evaluated = allCoupons.map(c => {
            const validation = this.repos.coupons.validateCoupon({
              code: c.code,
              userId,
              items: [],
              subtotal,
              shippingFee
            });
            return {
              ...c,
              isEligible: validation.valid,
              ineligibilityReason: validation.valid ? null : validation.error,
              potentialDiscount: validation.valid ? validation.discountAmount : 0
            };
          });

          jsonResponse(200, { success: true, count: evaluated.length, coupons: evaluated });
          return;
        }

        // Customer / Storefront: Validate & calculate discount for single coupon
        if (pathname === '/api/v1/coupons/validate' && method === 'POST') {
          const body = await readJsonBody();
          const { code, userId, items = [] } = body;
          const subtotal = Number(body.subtotal !== undefined ? body.subtotal : (body.itemsSubtotal !== undefined ? body.itemsSubtotal : 0));
          const shippingFee = Number(body.shippingFee || 0);

          if (!code) {
            jsonResponse(400, { success: false, error: 'Coupon code is required' });
            return;
          }

          const result = this.repos.coupons.validateCoupon({
            code,
            userId,
            items,
            subtotal,
            shippingFee
          });

          jsonResponse(200, {
            success: true,
            valid: result.valid,
            coupon: result.coupon || null,
            discountAmount: result.discountAmount || 0,
            message: result.message || null,
            error: result.error || null
          });
          return;
        }

        // Admin: List all coupons
        if (pathname === '/api/v1/admin/coupons' && method === 'GET') {
          const coupons = this.repos.coupons.list({ limit: 100 });
          jsonResponse(200, { success: true, count: coupons.length, coupons });
          return;
        }

        // Admin: Create new coupon
        if (pathname === '/api/v1/admin/coupons' && method === 'POST') {
          try {
            const body = await readJsonBody();
            const created = this.repos.coupons.create(body);
            this.logger.info(`Coupon created: ${created.code} (${created.type})`, { category: 'coupons' });
            this.repos.audit.logAction({
              actor: 'ADMIN',
              action: 'COUPON_CREATED',
              resource: 'coupons',
              resourceId: created.id,
              afterData: created
            });
            jsonResponse(201, { success: true, coupon: created });
          } catch (err) {
            jsonResponse(400, { success: false, error: err.message });
          }
          return;
        }

        // Admin: Update / toggle coupon
        const couponIdMatch = pathname.match(/^\/api\/v1\/admin\/coupons\/([^/]+)$/);
        if (couponIdMatch && method === 'PATCH') {
          try {
            const couponId = couponIdMatch[1];
            const body = await readJsonBody();
            const updated = this.repos.coupons.update(couponId, body);
            this.logger.info(`Coupon updated: ${updated.code}`, { category: 'coupons' });
            jsonResponse(200, { success: true, coupon: updated });
          } catch (err) {
            jsonResponse(400, { success: false, error: err.message });
          }
          return;
        }

        // Admin: Delete coupon
        if (couponIdMatch && method === 'DELETE') {
          try {
            const couponId = couponIdMatch[1];
            this.repos.coupons.delete(couponId);
            this.logger.info(`Coupon deleted: ${couponId}`, { category: 'coupons' });
            jsonResponse(200, { success: true, message: 'Coupon deleted successfully' });
          } catch (err) {
            jsonResponse(400, { success: false, error: err.message });
          }
          return;
        }

        // =========================================================================
        // 7. ADMIN OPERATIONS & SECURITY (Section 36, 43)
        // =========================================================================
        if (pathname === '/api/v1/admin/login' && method === 'POST') {
          const body = await readJsonBody();
          const { email, password } = body;

          const expectedEmail = process.env.ADMIN_EMAIL || 'admin@store.local';
          const expectedPass = process.env.ADMIN_PASSWORD || 'AdminPassword123!';

          if (email === expectedEmail && password === expectedPass) {
            // Success: Emit security alert to Telegram (Section 36)
            globalEventBus.publish(createEvent(EVENT_TYPES.ADMIN_LOGIN_SUCCESS, {
              admin: email,
              ipAddress: req.socket.remoteAddress || '127.0.0.1',
              timestamp: new Date().toISOString()
            }));

            this.repos.audit.logAction({
              actor: email,
              action: 'ADMIN_LOGIN_SUCCESS',
              resource: 'admin_auth',
              ipAddress: req.socket.remoteAddress
            });

            jsonResponse(200, {
              success: true,
              token: `ADM_TOKEN_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
              admin: { email, name: 'Lead Store Administrator', role: 'ADMIN' }
            });
          } else {
            // Failed: Emit security alert to Telegram (Section 36)
            globalEventBus.publish(createEvent(EVENT_TYPES.ADMIN_LOGIN_FAILED, {
              account: email,
              reason: 'Invalid credentials',
              ipAddress: req.socket.remoteAddress || '127.0.0.1',
              timestamp: new Date().toISOString()
            }));

            this.repos.audit.logAction({
              actor: email || 'UNKNOWN',
              action: 'ADMIN_LOGIN_FAILED',
              resource: 'admin_auth',
              ipAddress: req.socket.remoteAddress
            });

            jsonResponse(401, { success: false, error: 'Invalid admin credentials' });
          }
          return;
        }

        // Admin Dashboard Stats
        if (pathname === '/api/v1/admin/dashboard' && method === 'GET') {
          const orders = this.repos.orders.list({ limit: 100 });
          let totalRevenue = 0;
          let pendingCount = 0;
          let completedCount = 0;

          for (const o of orders) {
            if (o.payment_status === 'SUCCESS') totalRevenue += Number(o.total_amount);
            if (o.order_status === 'PLACED' || o.order_status === 'PROCESSING') pendingCount++;
            if (o.order_status === 'DELIVERED') completedCount++;
          }

          const products = this.repos.products.list({ limit: 100 });
          const lowStock = products.filter(p => p.stock < 10);
          const recentAudit = this.repos.audit.listLogs({ limit: 10 });
          const recentNotifications = this.repos.notifications.listNotifications({ limit: 10 });
          const unreadNotificationsCount = typeof this.repos.notifications.countUnread === 'function'
            ? this.repos.notifications.countUnread()
            : 0;

          jsonResponse(200, {
            success: true,
            stats: {
              totalOrders: orders.length,
              totalRevenue: Math.round(totalRevenue * 100) / 100,
              pendingOrders: pendingCount,
              completedOrders: completedCount,
              totalProducts: products.length,
              lowStockCount: lowStock.length
            },
            recentOrders: orders.slice(0, 5),
            lowStockProducts: lowStock.slice(0, 5),
            recentAudit,
            recentNotifications,
            unreadNotificationsCount
          });
          return;
        }

        // Admin Notifications Management: Mark All Read & Clear / Declutter
        if (pathname === '/api/v1/admin/notifications/mark-all-read' && method === 'POST') {
          if (typeof this.repos.notifications.markAllRead === 'function') {
            this.repos.notifications.markAllRead();
          }
          jsonResponse(200, { success: true, message: 'All notifications marked as read.' });
          return;
        }

        if (pathname === '/api/v1/admin/notifications/clear' && method === 'POST') {
          if (typeof this.repos.notifications.clearAll === 'function') {
            this.repos.notifications.clearAll();
          }
          jsonResponse(200, { success: true, message: 'All notification logs cleared.' });
          return;
        }

        if (pathname === '/api/v1/admin/notifications' && method === 'GET') {
          const limit = parseInt(url.searchParams.get('limit') || '50', 10);
          const notifications = this.repos.notifications.listNotifications({ limit });
          const unreadCount = typeof this.repos.notifications.countUnread === 'function'
            ? this.repos.notifications.countUnread()
            : 0;
          jsonResponse(200, { success: true, count: notifications.length, unreadCount, notifications });
          return;
        }

        // Admin Audit Logs
        if (pathname === '/api/v1/admin/audit-logs' && method === 'GET') {
          const logs = this.repos.audit.listLogs({ limit: 100 });
          jsonResponse(200, { success: true, count: logs.length, logs });
          return;
        }

        // =========================================================================
        // WHITE-LABEL BRANDING (Section: White Label Capabilities)
        // Store Admin Panel & Storefront White-Labeling Only
        // =========================================================================
        if (pathname === '/api/v1/branding' && method === 'GET') {
          const branding = this.getStoreBranding();
          jsonResponse(200, { success: true, branding });
          return;
        }

        if (pathname === '/api/v1/admin/branding' && method === 'POST') {
          try {
            const body = await readJsonBody();
            const rootDir = path.resolve(__dirname, '../../..');
            const brandingPath = path.resolve(rootDir, 'data/white_label_settings.json');
            const dir = path.dirname(brandingPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const current = this.getStoreBranding();
            const updated = {
              store_name: body.store_name !== undefined ? String(body.store_name).trim() : current.store_name,
              store_tagline: body.store_tagline !== undefined ? String(body.store_tagline).trim() : current.store_tagline,
              store_logo: body.store_logo !== undefined ? String(body.store_logo).trim() : current.store_logo,
              store_favicon: body.store_favicon !== undefined ? String(body.store_favicon).trim() : current.store_favicon,
              updated_at: new Date().toISOString()
            };

            fs.writeFileSync(brandingPath, JSON.stringify(updated, null, 2), 'utf8');

            // Also persist into SQLite store_settings table
            try {
              this.repos.db.execute(`
                CREATE TABLE IF NOT EXISTS store_settings (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
              `);
              for (const [k, v] of Object.entries(updated)) {
                this.repos.db.execute(`
                  INSERT INTO store_settings (key, value, updated_at)
                  VALUES ($1, $2, datetime('now'))
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
                `, [k, String(v)]);
              }
            } catch (e) {}

            this.logger.info(`Store branding updated: ${updated.store_name}`, { category: 'branding' });
            jsonResponse(200, { success: true, branding: updated, message: 'White-label branding updated successfully!' });
          } catch (err) {
            jsonResponse(400, { success: false, error: err.message });
          }
          return;
        }

        // =========================================================================
        // STORE & SHIPPING LABEL SETTINGS (Dynamic Shipping Label & Owner WhatsApp)
        // =========================================================================
        if (pathname === '/api/v1/admin/settings' && method === 'GET') {
          const settings = this.getStoreSettings();
          jsonResponse(200, {
            success: true,
            settings,
            pickupPincode: settings.shipping_pickup_pincode || '110059',
            ownerWhatsApp: settings.owner_whatsapp_phone || ''
          });
          return;
        }

        if (pathname === '/api/v1/admin/settings' && method === 'POST') {
          try {
            const body = await readJsonBody();
            const rootDir = path.resolve(__dirname, '../../..');
            const shippingSettingsPath = path.resolve(rootDir, 'data/shipping_settings.json');
            const storeSettingsPath = path.resolve(rootDir, 'data/store_settings.json');
            const dir = path.dirname(shippingSettingsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const current = this.getStoreSettings();
            const updated = {
              ...current,
              ...body,
              updated_at: new Date().toISOString()
            };

            if (body.pickupPincode) {
              const pin = String(body.pickupPincode).trim();
              if (!/^\d{6}$/.test(pin)) {
                jsonResponse(400, { success: false, error: 'Pickup pincode must be exactly 6 digits.' });
                return;
              }
              updated.shipping_pickup_pincode = pin;
            }

            if (body.shipping_pickup_pincode) {
              const pin = String(body.shipping_pickup_pincode).trim();
              if (!/^\d{6}$/.test(pin)) {
                jsonResponse(400, { success: false, error: 'Pickup pincode must be exactly 6 digits.' });
                return;
              }
              updated.shipping_pickup_pincode = pin;
            }

            // Write both JSON backends
            fs.writeFileSync(shippingSettingsPath, JSON.stringify(updated, null, 2), 'utf8');
            fs.writeFileSync(storeSettingsPath, JSON.stringify(updated, null, 2), 'utf8');

            // Persist all keys in SQLite DB
            try {
              this.repos.db.execute(`
                CREATE TABLE IF NOT EXISTS store_settings (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
              `);
              for (const [k, v] of Object.entries(updated)) {
                if (v !== undefined && v !== null) {
                  this.repos.db.execute(`
                    INSERT INTO store_settings (key, value, updated_at)
                    VALUES ($1, $2, datetime('now'))
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
                  `, [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
                }
              }
            } catch (dbErr) {
              this.logger.warn(`Database store_settings write notice: ${dbErr.message}`);
            }

            // Sync shipping pickup pincode with shipping-service
            if (updated.shipping_pickup_pincode) {
              try {
                const shippingUrl = process.env.SHIPPING_SERVICE_URL || 'http://localhost:5003';
                fetch(`${shippingUrl}/api/v1/shipping/settings`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ pickupPincode: updated.shipping_pickup_pincode })
                }).catch(() => {});
              } catch {}
            }

            // Sync key variables to .env if present
            try {
              const envPath = path.resolve(rootDir, '.env');
              if (fs.existsSync(envPath)) {
                let envContent = fs.readFileSync(envPath, 'utf8');
                const envUpdates = {};
                if (updated.shipping_pickup_pincode) envUpdates.SHIPPING_PICKUP_PINCODE = updated.shipping_pickup_pincode;
                if (updated.owner_whatsapp_phone) envUpdates.STORE_OWNER_WHATSAPP = updated.owner_whatsapp_phone;

                for (const [key, val] of Object.entries(envUpdates)) {
                  process.env[key] = String(val);
                  const regex = new RegExp(`^${key}=.*$`, 'm');
                  if (regex.test(envContent)) {
                    envContent = envContent.replace(regex, `${key}=${val}`);
                  } else {
                    envContent += `\n${key}=${val}`;
                  }
                }
                fs.writeFileSync(envPath, envContent, 'utf8');
              }
            } catch {}

            this.logger.info(`Store and shipping settings updated successfully`, { category: 'settings' });
            jsonResponse(200, {
              success: true,
              settings: updated,
              pickupPincode: updated.shipping_pickup_pincode,
              message: 'Settings updated successfully'
            });
          } catch (err) {
            jsonResponse(400, { success: false, error: err.message });
          }
          return;
        }

        // =========================================================================
        // WHATSAPP BROADCAST ENGINE (Sequential, Confirmed Delivery, 1 Extra Retry, 5s Cooldown, Live ETA)
        // =========================================================================
        if (pathname === '/api/v1/admin/broadcast/status' && method === 'GET') {
          jsonResponse(200, {
            success: true,
            broadcast: this.activeBroadcast || { active: false, currentStep: 'IDLE' }
          });
          return;
        }

        if (pathname === '/api/v1/admin/broadcast/stop' && method === 'POST') {
          if (this.activeBroadcast) {
            this.activeBroadcast.stopRequested = true;
            this.activeBroadcast.active = false;
            this.activeBroadcast.currentStep = 'STOPPED';
          }
          try {
            await fetch(`${URLS.WHATSAPP_AUTH_API || 'http://localhost:4000'}/api/v1/messages/clear-queue`, {
              method: 'POST',
              signal: AbortSignal.timeout(3000)
            }).catch(() => {});
          } catch {}

          jsonResponse(200, {
            success: true,
            message: 'Broadcast emergency stop requested and queue cleared.'
          });
          return;
        }

        // Upload media asset for WhatsApp broadcast (photo / video)
        if (pathname === '/api/v1/admin/broadcast/upload-media' && method === 'POST') {
          try {
            const body = await readJsonBody();
            const { filename = 'media', dataBase64, mimeType } = body;

            if (!dataBase64) {
              jsonResponse(400, { success: false, error: 'dataBase64 payload is required' });
              return;
            }

            const uploadDir = path.resolve(__dirname, '../../../data/broadcast_assets');
            if (!fs.existsSync(uploadDir)) {
              fs.mkdirSync(uploadDir, { recursive: true });
            }

            const cleanBase64 = dataBase64.replace(/^data:[^;]+;base64,/, '');
            const buffer = Buffer.from(cleanBase64, 'base64');

            let ext = path.extname(filename).toLowerCase();
            if (!ext && mimeType) {
              const mimeToExt = {
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/webp': '.webp',
                'image/gif': '.gif',
                'video/mp4': '.mp4',
                'video/webm': '.webm',
                'video/quicktime': '.mov'
              };
              ext = mimeToExt[mimeType] || '.bin';
            }

            const safeName = `${Date.now()}_${path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '')}${ext || '.jpg'}`;
            const targetPath = path.join(uploadDir, safeName);

            fs.writeFileSync(targetPath, buffer);

            const isVideo = ['.mp4', '.webm', '.mov', '.mkv'].includes(ext) || (mimeType && mimeType.startsWith('video/'));
            const urls = this.getPublicUrls(req);
            const mediaUrl = `${urls.commerceApi}/broadcast-assets/${safeName}`;

            this.logger.info(`[Broadcast] Uploaded media asset: ${safeName} (${buffer.length} bytes)`, { category: 'broadcast' });
            jsonResponse(200, {
              success: true,
              filename: safeName,
              url: mediaUrl,
              mediaType: isVideo ? 'video' : 'image',
              size: buffer.length
            });
          } catch (err) {
            this.logger.error(`[Broadcast] Media upload failed: ${err.message}`, { category: 'broadcast' });
            jsonResponse(500, { success: false, error: err.message });
          }
          return;
        }

        if (pathname === '/api/v1/admin/broadcast/whatsapp' && method === 'POST') {
          try {
            const body = await readJsonBody();
            const { message, mediaUrl, mediaType = 'image' } = body;

            if (!message || !message.trim()) {
              jsonResponse(400, { success: false, error: 'Broadcast message text is required' });
              return;
            }

            if (this.activeBroadcast?.active) {
              jsonResponse(409, {
                success: false,
                error: 'A broadcast campaign is already running.',
                broadcast: this.activeBroadcast
              });
              return;
            }

            const branding = this.getStoreBranding();
            const customers = this.repos.users.list({ role: 'CUSTOMER' }) || [];
            const validRecipients = customers.filter(c => c.mobile && String(c.mobile).replace(/[^0-9]/g, '').length >= 10);

            if (validRecipients.length === 0) {
              jsonResponse(200, {
                success: true,
                total: 0,
                sent: 0,
                failed: 0,
                message: 'No registered customers with valid phone numbers found.'
              });
              return;
            }

            const formatEta = (seconds) => {
              if (!seconds || seconds <= 0) return '0s';
              const m = Math.floor(seconds / 60);
              const s = seconds % 60;
              return m > 0 ? `${m}m ${s}s` : `${s}s`;
            };

            const jobId = `BC_${Date.now()}`;
            this.activeBroadcast = {
              id: jobId,
              active: true,
              total: validRecipients.length,
              processed: 0,
              sent: 0,
              failed: 0,
              currentRecipient: null,
              currentStep: 'STARTING',
              etaSeconds: validRecipients.length * 12,
              etaText: formatEta(validRecipients.length * 12),
              startTime: Date.now(),
              stopRequested: false
            };

            // Detached sequential broadcast loop
            (async () => {
              this.logger.info(`Starting confirmed WhatsApp broadcast to ${validRecipients.length} customer(s)...`, { category: 'broadcast' });
              const startTime = Date.now();

              for (let i = 0; i < validRecipients.length; i++) {
                if (this.activeBroadcast.stopRequested) {
                  this.activeBroadcast.currentStep = 'STOPPED';
                  this.activeBroadcast.active = false;
                  this.logger.info('[Broadcast] Campaign stopped by administrator.', { category: 'broadcast' });
                  break;
                }

                const customer = validRecipients[i];
                const custName = customer.name || 'Valued Customer';
                const cleanPhone = this.normalizePhone(customer.mobile);

                this.activeBroadcast.currentRecipient = {
                  index: i + 1,
                  total: validRecipients.length,
                  name: custName,
                  phone: cleanPhone
                };
                this.activeBroadcast.currentStep = `Dispatching to ${custName} (+${cleanPhone})...`;

                // Build dynamic personalized text
                let personalized = message
                  .replace(/\{name\}/gi, custName)
                  .replace(/Hi\s+______/gi, `Hi ${custName}`)
                  .replace(/Hello\s+______/gi, `Hello ${custName}`);

                if (!personalized.toLowerCase().includes(custName.toLowerCase())) {
                  personalized = `Hi ${custName},\n\n${personalized}`;
                }

                personalized += `\n\n— *${branding.store_name}*\n_${branding.store_tagline}_`;

                // Subroutine: Attempt message send via headless worker first
                const attemptSend = async () => {
                  try {
                    const workerRes = await fetch(`${INTERNAL_URLS.WHATSAPP_WORKER}/api/v1/messages/send`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.WORKER_INTERNAL_SECRET || 'worker_secret_key_change_me_in_prod_abcde'}`
                      },
                      body: JSON.stringify({
                        to: cleanPhone,
                        message: personalized,
                        mediaUrl: mediaUrl && mediaUrl.trim() ? mediaUrl.trim() : undefined,
                        mediaType: mediaType || 'image',
                        source: 'broadcast'
                      }),
                      signal: AbortSignal.timeout(15000)
                    });
                    if (workerRes.ok) {
                      const data = await workerRes.json().catch(() => ({}));
                      if (data.success) return true;
                    }
                  } catch (e) {}

                  try {
                    const res = await fetch(`${INTERNAL_URLS.WHATSAPP_AUTH_API}/api/v1/messages/send-and-confirm`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        to: cleanPhone,
                        message: personalized,
                        mediaUrl: mediaUrl && mediaUrl.trim() ? mediaUrl.trim() : undefined,
                        mediaType: mediaType || 'image'
                      }),
                      signal: AbortSignal.timeout(15000)
                    });
                    const data = await res.json().catch(() => ({}));
                    return Boolean(data.success && data.delivered);
                  } catch (e) {
                    return false;
                  }
                };

                // Attempt 1: First try
                let delivered = await attemptSend();

                // If unsuccessful, try 1 time extra as requested by user
                if (!delivered && !this.activeBroadcast.stopRequested) {
                  this.logger.warn(`[Broadcast] Recipient +${cleanPhone} failed initial try. Retrying 1 extra time...`);
                  this.activeBroadcast.currentStep = `⚠️ Try 1 failed for ${custName}. Retrying 1 extra time...`;
                  await new Promise(r => setTimeout(r, 2000));
                  if (!this.activeBroadcast.stopRequested) {
                    delivered = await attemptSend();
                  }
                }

                this.activeBroadcast.processed++;
                if (delivered) {
                  this.activeBroadcast.sent++;
                  this.logger.info(`[Broadcast] ✓ Confirmed delivered to ${custName} (+${cleanPhone}) [${i + 1}/${validRecipients.length}]`);
                } else {
                  this.activeBroadcast.failed++;
                  this.logger.warn(`[Broadcast] ✗ Delivery failed for ${custName} (+${cleanPhone}) after retry`);
                }

                // Dynamic ETA calculation
                const remaining = validRecipients.length - this.activeBroadcast.processed;
                const elapsedMs = Date.now() - startTime;
                const avgMsPerUser = elapsedMs / Math.max(1, this.activeBroadcast.processed);
                this.activeBroadcast.etaSeconds = Math.round((remaining * avgMsPerUser) / 1000);
                this.activeBroadcast.etaText = formatEta(this.activeBroadcast.etaSeconds);

                // If more recipients remain and broadcast is not stopped: Enforce strict 5-second cooldown
                if (i < validRecipients.length - 1 && !this.activeBroadcast.stopRequested) {
                  for (let cd = 5; cd > 0; cd--) {
                    if (this.activeBroadcast.stopRequested) break;
                    this.activeBroadcast.currentStep = `⏳ Confirmed! Cooldown: ${cd}s before next user...`;
                    await new Promise(r => setTimeout(r, 1000));
                  }
                }
              }

              if (!this.activeBroadcast.stopRequested) {
                this.activeBroadcast.currentStep = 'COMPLETED';
                this.activeBroadcast.active = false;
                this.activeBroadcast.etaSeconds = 0;
                this.activeBroadcast.etaText = '0s';
              }
              this.logger.info(`[Broadcast Finished] Total: ${this.activeBroadcast.total}, Sent: ${this.activeBroadcast.sent}, Failed: ${this.activeBroadcast.failed}`);
            })();

            jsonResponse(200, {
              success: true,
              message: `Broadcast initiated for ${validRecipients.length} customer(s).`,
              broadcast: this.activeBroadcast
            });
          } catch (err) {
            jsonResponse(500, { success: false, error: err.message });
          }
          return;
        }

        // Check if customer exists by mobile number
        if (pathname === '/api/v1/customers/check' && (method === 'GET' || method === 'POST')) {
          let mobile = url.searchParams.get('mobile');
          if (!mobile && method === 'POST') {
            const body = await readJsonBody();
            mobile = body.mobile || body.phone_number;
          }
          const user = mobile ? this.repos.users.findByMobile(mobile) : null;
          jsonResponse(200, {
            success: true,
            exists: Boolean(user),
            user: user ? { id: user.id, name: user.name, mobile: user.mobile, email: user.email } : null
          });
          return;
        }

        // Customers List
        if (pathname === '/api/v1/customers' && method === 'GET') {
          const customers = this.repos.users.list({ role: 'CUSTOMER' });
          jsonResponse(200, { success: true, customers });
          return;
        }

        // Canonical Customer Resolution (Section 6)
        if (pathname === '/api/v1/customers/resolve' && method === 'POST') {
          const body = await readJsonBody();
          const { mobile, name, email, whatsappVerified, mode } = body;

          if (!mobile) {
            jsonResponse(400, { error: 'Mobile number is required for identity anchor' });
            return;
          }

          if (mode === 'login') {
            const existing = this.repos.users.findByMobile(mobile);
            if (!existing) {
              jsonResponse(404, {
                success: false,
                exists: false,
                error: 'ACCOUNT_NOT_FOUND',
                message: 'No account found with this mobile number. Please sign up.'
              });
              return;
            }
          }

          const user = this.repos.users.upsertCanonicalUser({ mobile, name, email });

          // Broadcast & record in audit trail so Store Admin Panel maintains records
          this.repos.audit.logAction({
            actor: user.id,
            action: whatsappVerified ? 'WHATSAPP_AUTH_VERIFIED' : 'CUSTOMER_RESOLVED',
            resource: 'customers',
            resourceId: user.id,
            afterData: { mobile: user.mobile, name: user.name, email: user.email, verified: true }
          });

          globalEventBus.publish(createEvent(EVENT_TYPES.USER_LOGIN, {
            userId: user.id,
            name: user.name,
            mobile: user.mobile,
            email: user.email,
            timestamp: new Date().toISOString()
          }));

          jsonResponse(200, { success: true, user });
          return;
        }

        // Customer Authentication Event Broadcast for Store Admin Records
        if (pathname === '/api/v1/customers/auth-event' && method === 'POST') {
          const body = await readJsonBody();
          this.repos.audit.logAction({
            actor: body.userId || body.mobile || 'CUSTOMER',
            action: body.type || 'WHATSAPP_AUTH_EVENT',
            resource: 'customers',
            resourceId: body.attemptId || body.userId || null,
            afterData: body
          });
          jsonResponse(200, { success: true });
          return;
        }

        // Not Found
        jsonResponse(404, { error: `Endpoint not found: ${method} ${pathname}` });
      } catch (err) {
        this.logger.error(`Unhandled API Error: ${err.message}`, { details: { stack: err.stack, pathname } });
        jsonResponse(500, { error: 'Internal Server Error', message: err.message });
      }
    });
  }

  setupLifecycleNotificationListeners() {
    const notifyWhatsApp = async (to, message, meta = {}) => {
      const cleanTo = this.normalizePhone(to);
      if (!cleanTo) return;

      try {
        const payload = JSON.stringify({
          to: cleanTo,
          message,
          orderId: meta.orderNumber || meta.orderId || undefined,
          source: 'commerce-api'
        });

        // Dual dispatch: Try headless WhatsApp Worker (port 4001) first, fallback to Auth API (port 4000)
        let dispatched = false;
        try {
          const workerRes = await fetch(`${INTERNAL_URLS.WHATSAPP_WORKER}/api/v1/messages/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.WORKER_INTERNAL_SECRET || 'worker_secret_key_change_me_in_prod_abcde'}`
            },
            body: payload,
            signal: AbortSignal.timeout(6000)
          });
          if (workerRes.ok) dispatched = true;
        } catch {}

        if (!dispatched) {
          await fetch(`${INTERNAL_URLS.WHATSAPP_AUTH_API}/api/v1/messages/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(6000)
          }).catch(() => {});
        }

        this.logger.info(`[NotificationService] WhatsApp alert scheduled for ${cleanTo}`, { category: 'notification' });
      } catch (networkErr) {
        this.logger.warn(`[NotificationService] WhatsApp delivery notice: ${networkErr.message}`);
      }

      // Safely log to notifications repository in database
      try {
        if (this.repos.notifications) {
          const templateSlug = String(meta.template || 'order_placed').toLowerCase();
          this.repos.notifications.createNotification({
            userId: meta.userId || null,
            channel: 'WHATSAPP',
            recipient: to,
            destination: to,
            templateId: templateSlug,
            template: templateSlug,
            content: message,
            body: message,
            status: 'SENT',
            sentAt: new Date().toISOString()
          });
        }
      } catch (dbErr) {
        this.logger.warn(`[NotificationService] Notification DB record non-fatal warning: ${dbErr.message}`);
      }
    };

    const getBrandDetails = () => {
      const b = this.getStoreBranding();
      const urls = this.getPublicUrls();
      return {
        storeName: b.store_name || 'VIENTA',
        storeTagline: b.store_tagline || 'Premium Quality Store',
        storefrontUrl: urls.storefront,
        adminUrl: urls.admin
      };
    };

    // 1. ORDER_CREATED
    globalEventBus.subscribe(EVENT_TYPES.ORDER_CREATED, async (evt) => {
      const { storeName, storeTagline, storefrontUrl, adminUrl } = getBrandDetails();
      const { orderNumber, customerName, customerMobile, totalAmount, paymentMethod, items, shippingAddress } = evt.data || {};
      const custName = customerName || 'Valued Customer';
      const msg = `🛍️ *[${storeName}] Order Placed Successfully!*\n\nHi ${custName},\nYour order *#${orderNumber}* for *₹${totalAmount}* has been placed on *${storeName}*.\nWe'll notify you as soon as it's confirmed!\n\nTrack order: ${storefrontUrl}/account/orders/${orderNumber}\n\n— *${storeName}*\n_${storeTagline}_`;

      // 1. Dispatch to customer
      await notifyWhatsApp(customerMobile, msg, { template: 'ORDER_CREATED', orderNumber });

      // 2. Dispatch incoming order alert to Store Owner
      try {
        const ownerPhone = this.getStoreOwnerWhatsAppPhone();
        if (ownerPhone) {
          let itemsSummary = '';
          if (Array.isArray(items) && items.length > 0) {
            itemsSummary = items.map(it => `• ${it.productName || it.name || it.product_name} (x${it.quantity}) - ₹${it.unitPrice || it.unit_price}`).join('\n');
          } else {
            itemsSummary = `• Items total: ₹${totalAmount}`;
          }

          let addressSummary = 'Standard Delivery';
          if (shippingAddress) {
            const a = shippingAddress;
            addressSummary = [a.addressLine, a.city, a.state, a.zip].filter(Boolean).join(', ');
          }

          const ownerMsg = `🔔 *[${storeName}] NEW ORDER RECEIVED!*\n\n• Order ID: *#${orderNumber}*\n• Store: *${storeName}*\n• Customer: *${custName}* (${customerMobile || 'No phone'})\n• Total Amount: *₹${totalAmount}*\n• Payment: *${paymentMethod || 'UPI'}*\n• Status: *NEW ORDER*\n\n📍 *Shipping Address:*\n${addressSummary}\n\n🛒 *Items Ordered:*\n${itemsSummary}\n\n👉 Review in Admin: ${adminUrl}/#orders\n\n— *${storeName} Operations*`;
          await notifyWhatsApp(ownerPhone, ownerMsg, { template: 'STORE_OWNER_INCOMING_ORDER', orderNumber });
        }
      } catch (err) {
        this.logger.warn(`Store owner order notification warning: ${err.message}`);
      }
    });

    // 2. ORDER_CONFIRMED
    globalEventBus.subscribe(EVENT_TYPES.ORDER_CONFIRMED, async (evt) => {
      const { storeName, storefrontUrl, adminUrl } = getBrandDetails();
      const { orderNumber, customerName, customerMobile, totalAmount } = evt.data || {};
      const custName = customerName || 'Valued Customer';
      const msg = `✅ *[${storeName}] Order Confirmed!*\n\nHi ${custName},\nYour order *#${orderNumber}* (₹${totalAmount}) on *${storeName}* has been confirmed and is being prepared.\n\nTrack order: ${storefrontUrl}/account/orders/${orderNumber}\n\n— *${storeName}*`;

      await notifyWhatsApp(customerMobile, msg, { template: 'ORDER_CONFIRMED', orderNumber });

      try {
        const ownerPhone = this.getStoreOwnerWhatsAppPhone();
        if (ownerPhone) {
          const ownerMsg = `✅ *[${storeName}] ORDER CONFIRMED!*\n\nOrder *#${orderNumber}* for customer *${custName}* (₹${totalAmount}) is confirmed on *${storeName}* and ready for packaging & label printing.\n\n👉 Open Admin: ${adminUrl}/#orders\n\n— *${storeName} Operations*`;
          await notifyWhatsApp(ownerPhone, ownerMsg, { template: 'STORE_OWNER_ORDER_CONFIRMED', orderNumber });
        }
      } catch (e) {}
    });

    // 3. ORDER_PROCESSING
    globalEventBus.subscribe(EVENT_TYPES.ORDER_PROCESSING, async (evt) => {
      const { storeName, storefrontUrl, adminUrl } = getBrandDetails();
      const { orderNumber, customerName, customerMobile } = evt.data || {};
      const custName = customerName || 'Valued Customer';
      const msg = `⚙️ *[${storeName}] Order in Processing!*\n\nHi ${custName},\nYour order *#${orderNumber}* is currently being packed and verified at our fulfillment center.\n\nTrack order: ${storefrontUrl}/account/orders/${orderNumber}\n\n— *${storeName}*`;

      await notifyWhatsApp(customerMobile, msg, { template: 'ORDER_PROCESSING', orderNumber });

      try {
        const ownerPhone = this.getStoreOwnerWhatsAppPhone();
        if (ownerPhone) {
          const ownerMsg = `⚙️ *[${storeName}] Order Marked Processing!*\n\nOrder *#${orderNumber}* (${custName}) is now marked as PROCESSING on *${storeName}*.\n\n👉 Open Admin: ${adminUrl}/#orders`;
          await notifyWhatsApp(ownerPhone, ownerMsg, { template: 'STORE_OWNER_ORDER_PROCESSING', orderNumber });
        }
      } catch (e) {}
    });

    // 4. ORDER_SHIPPED
    globalEventBus.subscribe(EVENT_TYPES.ORDER_SHIPPED, async (evt) => {
      const { storeName, storefrontUrl, adminUrl } = getBrandDetails();
      const { orderNumber, customerName, customerMobile, carrier, trackingNumber } = evt.data || {};
      const custName = customerName || 'Valued Customer';
      const msg = `🚚 *[${storeName}] Order Shipped!*\n\nHi ${custName},\nYour order *#${orderNumber}* from *${storeName}* is on its way and will be delivered to your address soon!\n\nTrack order status: ${storefrontUrl}/account/orders/${orderNumber}\n\n— *${storeName}*`;

      await notifyWhatsApp(customerMobile, msg, { template: 'ORDER_SHIPPED', orderNumber });

      try {
        const ownerPhone = this.getStoreOwnerWhatsAppPhone();
        if (ownerPhone) {
          const ownerMsg = `🚚 *[${storeName}] Order Dispatched!*\n\nOrder *#${orderNumber}* (${custName}) has been marked as SHIPPED.\n\n— *${storeName} Operations*`;
          await notifyWhatsApp(ownerPhone, ownerMsg, { template: 'STORE_OWNER_ORDER_SHIPPED', orderNumber });
        }
      } catch (e) {}
    });

    // 5. ORDER_DELAYED
    globalEventBus.subscribe(EVENT_TYPES.ORDER_DELAYED, async (evt) => {
      const { storeName, storefrontUrl, adminUrl } = getBrandDetails();
      const { orderNumber, customerName, customerMobile } = evt.data || {};
      const custName = customerName || 'Valued Customer';
      const msg = `⏳ *[${storeName}] Order Transit Update*\n\nHi ${custName},\nYour order *#${orderNumber}* is experiencing a brief logistics delay. Our fulfillment team is actively expediting delivery.\n\nTrack: ${storefrontUrl}/account/orders/${orderNumber}\n\n— *${storeName} Support*`;

      await notifyWhatsApp(customerMobile, msg, { template: 'ORDER_DELAYED', orderNumber });

      try {
        const ownerPhone = this.getStoreOwnerWhatsAppPhone();
        if (ownerPhone) {
          const ownerMsg = `⏳ *[${storeName}] Order Flagged Delayed!*\n\nOrder *#${orderNumber}* (${custName}) has been flagged as delayed in transit.\n\n👉 Open Admin: ${adminUrl}/#orders`;
          await notifyWhatsApp(ownerPhone, ownerMsg, { template: 'STORE_OWNER_ORDER_DELAYED', orderNumber });
        }
      } catch (e) {}
    });

    // 6. ORDER_DELIVERED
    globalEventBus.subscribe(EVENT_TYPES.ORDER_DELIVERED, async (evt) => {
      const { storeName, storefrontUrl } = getBrandDetails();
      const { orderNumber, customerName, customerMobile } = evt.data || {};
      const custName = customerName || 'Valued Customer';
      const msg = `🎉 *[${storeName}] Order Delivered!*\n\nHi ${custName},\nYour order *#${orderNumber}* from *${storeName}* has been successfully delivered!\nThank you for shopping with *${storeName}*. Please share your feedback on our store:\n${storefrontUrl}/account/orders/${orderNumber}\n\n— *${storeName}*`;

      await notifyWhatsApp(customerMobile, msg, { template: 'ORDER_DELIVERED', orderNumber });

      try {
        const ownerPhone = this.getStoreOwnerWhatsAppPhone();
        if (ownerPhone) {
          const ownerMsg = `🌟 *[${storeName}] Order Delivered Successfully!*\n\nOrder *#${orderNumber}* for customer *${custName}* has been marked DELIVERED.\n\n— *${storeName} Operations*`;
          await notifyWhatsApp(ownerPhone, ownerMsg, { template: 'STORE_OWNER_ORDER_DELIVERED', orderNumber });
        }
      } catch (e) {}
    });

    // 7. ORDER_CANCELLED
    globalEventBus.subscribe(EVENT_TYPES.ORDER_CANCELLED, async (evt) => {
      const { storeName, adminUrl } = getBrandDetails();
      const { orderNumber, customerName, customerMobile, totalAmount } = evt.data || {};
      const custName = customerName || 'Valued Customer';
      const msg = `❌ *[${storeName}] Order Cancelled*\n\nHi ${custName},\nYour order *#${orderNumber}* on *${storeName}* for *₹${totalAmount || '0'}* has been cancelled.\nIf money was debited from your account, it will be automatically refunded by your bank within 24-48 hours.\n\n— *${storeName} Support*`;

      await notifyWhatsApp(customerMobile, msg, { template: 'ORDER_CANCELLED', orderNumber });

      try {
        const ownerPhone = this.getStoreOwnerWhatsAppPhone();
        if (ownerPhone) {
          const ownerMsg = `⚠️ *[${storeName}] Order Cancelled!*\n\nOrder *#${orderNumber}* (${custName}, ₹${totalAmount || '0'}) has been cancelled.\n\n👉 Open Admin: ${adminUrl}/#orders`;
          await notifyWhatsApp(ownerPhone, ownerMsg, { template: 'STORE_OWNER_ORDER_CANCELLED', orderNumber });
        }
      } catch (e) {}
    });

    // 8. PAYMENT_SUCCESS
    globalEventBus.subscribe(EVENT_TYPES.PAYMENT_SUCCESS, async (evt) => {
      const { storeName, storefrontUrl, adminUrl } = getBrandDetails();
      const { orderNumber, customerName, customerMobile, amount, paymentId } = evt.data || {};
      const custName = customerName || 'Valued Customer';
      const msg = `💳 *[${storeName}] Payment Confirmed!*\n\nHi ${custName},\nPayment of *₹${amount}* for order *#${orderNumber}* on *${storeName}* was successful (Ref: ${paymentId || 'ONLINE'}).\n\nView details: ${storefrontUrl}/account/orders/${orderNumber}\n\n— *${storeName}*`;

      await notifyWhatsApp(customerMobile, msg, { template: 'PAYMENT_SUCCESS', orderNumber });

      try {
        const ownerPhone = this.getStoreOwnerWhatsAppPhone();
        if (ownerPhone) {
          const ownerMsg = `💰 *[${storeName}] PAYMENT RECEIVED!*\n\nCustomer *${custName}* has paid *₹${amount}* for Order *#${orderNumber}* (Ref: ${paymentId || 'ONLINE'}).\n\n👉 Open Admin: ${adminUrl}/#orders\n\n— *${storeName} Operations*`;
          await notifyWhatsApp(ownerPhone, ownerMsg, { template: 'STORE_OWNER_PAYMENT_SUCCESS', orderNumber });
        }
      } catch (e) {}
    });
  }

  async start() {
    const server = this.createServer();
    return new Promise((resolve, reject) => {
      server.listen(this.port, () => {
        console.log(`[CommerceAPI] Listening and serving on http://localhost:${this.port}`);
        resolve(server);
      });
      server.on('error', reject);
    });
  }
}
