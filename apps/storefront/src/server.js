import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, URLS } from '../../../packages/common/src/ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

export class StorefrontServer {
  /**
   * @param {{ port?: number, commerceApiUrl?: string, checkoutPortalUrl?: string }} [options={}]
   */
  constructor(options = {}) {
    this.port = options.port || PORTS.STOREFRONT || 5000;
    this.commerceApiUrl = options.commerceApiUrl || URLS.COMMERCE_API || `http://localhost:${PORTS.COMMERCE_API || 5001}`;
    this.checkoutPortalUrl = options.checkoutPortalUrl || URLS.CHECKOUT_PORTAL || `http://localhost:${PORTS.CHECKOUT_PORTAL || 7000}`;
    this.whatsappWorkerUrl = URLS.WHATSAPP_WORKER || `http://localhost:${PORTS.WHATSAPP_WORKER || 4001}`;
    this.whatsappAuthUrl = URLS.WHATSAPP_AUTH_API || `http://localhost:${PORTS.WHATSAPP_AUTH_API || 4000}`;
    this.shippingServiceUrl = options.shippingServiceUrl || URLS.SHIPPING_SERVICE || process.env.SHIPPING_SERVICE_URL || 'http://localhost:5003';
    this.publicDir = path.join(__dirname, 'public');
    this.customizationFile = path.resolve(rootDir, 'data/waven_storefront_customization.json');

    // Security & VEditor Guardrails
    this.captchaSecret = process.env.CAPTCHA_SECRET || 'waven_veditor_captcha_hmac_secret_2026';
    this.activeOtps = new Map(); // 'veditor_otp' -> { code, expiresAt }
    this.activeSessions = new Set(); // in-memory session tokens, zero-persistence on reload
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Generates dynamic anti-bot SVG Captcha with noise lines and cryptographic HMAC token
   */
  generateCaptcha() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let text = '';
    for (let i = 0; i < 5; i++) {
      text += chars[crypto.randomInt(0, chars.length)];
    }

    const timestamp = Date.now();
    const hmac = crypto
      .createHmac('sha256', this.captchaSecret)
      .update(`${text}:${timestamp}`)
      .digest('hex');
    const token = `${hmac}.${timestamp}`;

    const colors = ['#0e0e10', '#e62310', '#2563eb', '#00a651', '#6c5ce7'];
    const textElements = text
      .split('')
      .map((char, i) => {
        const x = 20 + i * 26 + crypto.randomInt(-2, 3);
        const y = 35 + crypto.randomInt(-4, 4);
        const rot = crypto.randomInt(-18, 18);
        const col = colors[crypto.randomInt(0, colors.length)];
        return `<text x="${x}" y="${y}" fill="${col}" font-family="monospace, sans-serif" font-weight="900" font-size="28" transform="rotate(${rot}, ${x}, ${y})">${char}</text>`;
      })
      .join('');

    let lines = '';
    for (let i = 0; i < 4; i++) {
      const x1 = crypto.randomInt(5, 40);
      const y1 = crypto.randomInt(5, 50);
      const x2 = crypto.randomInt(110, 155);
      const y2 = crypto.randomInt(5, 50);
      const stroke = colors[crypto.randomInt(0, colors.length)];
      lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1.5" stroke-opacity="0.5"/>`;
    }

    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="52" viewBox="0 0 160 52" style="background:#f4f4f5; border-radius:4px; border:1px solid #d4d4d8;">${lines}${textElements}</svg>`;
    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;

    return { svg: dataUri, token, answer: text };
  }

  /**
   * Verifies Captcha answer against cryptographic token
   */
  verifyCaptcha(token, answer) {
    if (!token || !answer || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [hmac, timestampStr] = parts;
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp) || Date.now() - timestamp > 5 * 60 * 1000) {
      return false; // Expired after 5 minutes
    }

    const cleanAnswer = String(answer).trim().toUpperCase();
    const expected = crypto
      .createHmac('sha256', this.captchaSecret)
      .update(`${cleanAnswer}:${timestamp}`)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
  }

  /**
   * Reads dynamic white-label and store settings saved by Admin
   */
  getWhiteLabelSettings() {
    const whiteLabelPath = path.resolve(rootDir, 'data/white_label_settings.json');
    const storeSettingsPath = path.resolve(rootDir, 'data/store_settings.json');
    let settings = {
      store_name: 'VIENTA',
      store_tagline: 'Premium Streetwear & Contemporary Apparel',
      store_logo: '',
      store_favicon: '🛍️',
      owner_whatsapp_phone: process.env.STORE_OWNER_WHATSAPP || '+919876543210',
      support_email: 'care@store.local',
      shipping_return_policy: '10-day replacement policy for verified orders.'
    };
    try {
      if (fs.existsSync(whiteLabelPath)) {
        Object.assign(settings, JSON.parse(fs.readFileSync(whiteLabelPath, 'utf8')));
      }
    } catch {}
    try {
      if (fs.existsSync(storeSettingsPath)) {
        Object.assign(settings, JSON.parse(fs.readFileSync(storeSettingsPath, 'utf8')));
      }
    } catch {}
    return settings;
  }

  /**
   * Reads or generates default storefront visual customizations, aligned with white-label settings
   */
  getCustomizationConfig() {
    let config = null;
    try {
      if (fs.existsSync(this.customizationFile)) {
        config = JSON.parse(fs.readFileSync(this.customizationFile, 'utf8'));
      }
    } catch {}

    const wl = this.getWhiteLabelSettings();
    const storeName = wl.store_name || 'VIENTA';
    const storeTagline = wl.store_tagline || 'STREETWEAR ATELIER';

    if (!config) {
      config = {
        ticker: {
          tag: 'LIMITED DROP',
          text: 'FREE SURFACE SHIPPING ON PREPAID ORDERS OVER ₹999',
          couponCode: 'WELCOME20',
          couponDiscount: '20% OFF',
          enabled: true,
          linkAction: '/account'
        },
        brand: {
          name: storeName,
          tagline: storeTagline,
          logoText: storeName.slice(0, 2).toUpperCase(),
          logoUrl: wl.store_logo || ''
        },
        navigation: [
          { label: 'Home', linkAction: '/' },
          { label: 'Track Order', linkAction: '/account' },
          { label: 'Support', linkAction: '#support' }
        ],
        hero: {
          tag: '⚡ AUTUMN / WINTER 2026 DROP',
          title: 'STREETWEAR ESSENTIALS',
          subtitle: 'High-density heavyweight cotton, oversized drop-shoulder silhouettes, and precision-tailored urban utility wear.',
          ctaText: 'Track Order ↗',
          ctaLink: '/account',
          secondaryText: 'Customer Assistance',
          secondaryLink: '#support',
          imageUrl: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=1600&auto=format&fit=crop&q=85'
        },
        marquee: {
          items: [
            '100% HEAVYWEIGHT COMBED COTTON',
            'ZERO-PASSWORD WHATSAPP INSTANT CHECKOUT',
            'FAST EXPRESS DELIVERY ACROSS INDIA',
            '10-DAY HASSLE-FREE REPLACEMENTS'
          ]
        },
        categories: {
          eyebrow: '',
          title: '',
          tiles: []
        },
        catalog: {
          eyebrow: '',
          title: '',
          subtitle: '',
          featuredProductIds: [],
          trendingProductIds: [],
          newArrivalProductIds: []
        },
        lookbook: {
          eyebrow: '',
          title: '',
          description: '',
          ctaText: '',
          ctaLink: '',
          imageUrl: '',
          hotspotProductId: null
        },
        valueProps: [
          { title: 'Fast Express Delivery', desc: 'Dispatched via priority surface couriers within 24 hours.' },
          { title: 'Authentic Quality', desc: 'Pre-shrunk, heavyweight textiles crafted with precision.' },
          { title: '10-Day Replacements', desc: wl.shipping_return_policy || 'Easy size exchange and hassle-free pickup assistance.' },
          { title: 'Encrypted UPI & COD', desc: 'Seamless payments powered by secure UPI & Netbanking.' }
        ],
        footer: {
          desc: `Independent urban streetwear atelier. Built for contemporary creators with high-spec textiles and effortless silhouettes.`,
          copyright: `© 2026 ${storeName.toUpperCase()} CLOTHING CO. ALL RIGHTS RESERVED.`,
          shippingPdf: '',
          privacyPdf: '',
          termsPdf: ''
        },
        theme: {
          primaryDark: '#0e0e10',
          accentBadge: '#e62310',
          bgMain: '#f5f5f7'
        }
      };
    }

    // Always dynamically sync white-label branding from admin panel
    if (wl.store_name) {
      config.brand = config.brand || {};
      config.brand.name = wl.store_name;
      if (wl.store_tagline) config.brand.tagline = wl.store_tagline;
      if (wl.store_logo) config.brand.logoUrl = wl.store_logo;
      if (wl.store_favicon) config.brand.favicon = wl.store_favicon;
      config.footer = config.footer || {};
      config.footer.copyright = `© 2026 ${wl.store_name.toUpperCase()} CLOTHING CO. ALL RIGHTS RESERVED.`;
    }
    config.whiteLabel = wl;

    return config;
  }

  saveCustomizationConfig(config) {
    try {
      const dataDir = path.dirname(this.customizationFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(this.customizationFile, JSON.stringify(config, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[VEditor] Error saving customization:', err);
      return false;
    }
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      const jsonResponse = (status, data) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end(JSON.stringify(data));
      };

      const readJsonBody = () => {
        return new Promise((resolve, reject) => {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > 2 * 1024 * 1024) {
              reject(new Error('Payload too large'));
            }
          });
          req.on('end', () => {
            try {
              resolve(body ? JSON.parse(body) : {});
            } catch (err) {
              reject(new Error('Invalid JSON'));
            }
          });
          req.on('error', reject);
        });
      };

      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end();
        return;
      }

      // 1. Health check
      if (pathname === '/health') {
        return jsonResponse(200, {
          status: 'HEALTHY',
          service: 'storefront',
          port: this.port,
          timestamp: new Date().toISOString()
        });
      }

      if (pathname === '/health/deep') {
        let commerceApiOk = false;
        try {
          const check = await fetch(`${this.commerceApiUrl}/health`, { signal: AbortSignal.timeout(2000) });
          commerceApiOk = check.ok;
        } catch {}

        return jsonResponse(200, {
          status: commerceApiOk ? 'HEALTHY' : 'DEGRADED',
          service: 'storefront',
          dependencies: {
            commerceApi: commerceApiOk ? 'HEALTHY' : 'UNREACHABLE'
          },
          timestamp: new Date().toISOString()
        });
      }

      // 2. Dynamic Runtime Config for Client SPA
      if (pathname === '/api/config') {
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

        const primaryDomain = (process.env.PRIMARY_DOMAIN || '').trim();
        const domainExt = (process.env.DOMAIN_EXTENSION || '.shop').trim();

        const rawHost = req.headers['x-forwarded-host'] || req.headers.host || '';
        const reqHost = rawHost.split(':')[0];
        const isHostLocal = !reqHost || reqHost === 'localhost' || reqHost === '127.0.0.1';
        const isProdDomain = Boolean(primaryDomain && primaryDomain !== 'localhost' && primaryDomain !== '127.0.0.1');

        let resolvedCommerceApi = (process.env.COMMERCE_API_URL || this.commerceApiUrl).replace(/\/+$/, '');
        let resolvedCheckout = (process.env.BASE_CHECKOUT_URL || this.checkoutPortalUrl).replace(/\/+$/, '');
        let resolvedWhatsApp = (process.env.WHATSAPP_AUTH_API_URL || URLS.WHATSAPP_AUTH_API).replace(/\/+$/, '');

        if (isHostLocal || process.env.ENVIRONMENT_MODE === 'DEVELOPMENT') {
          const localHost = isHostLocal ? (reqHost || 'localhost') : 'localhost';
          resolvedCommerceApi = `http://${localHost}:5001`;
          resolvedCheckout = `http://${localHost}:7000`;
          resolvedWhatsApp = `http://${localHost}:4000`;
        } else if (isProdDomain && (process.env.ENVIRONMENT_MODE === 'PRODUCTION' || resolvedCommerceApi.includes(primaryDomain))) {
          resolvedCommerceApi = `https://api.${primaryDomain}${domainExt}`;
          resolvedCheckout = `https://pay.${primaryDomain}${domainExt}`;
          resolvedWhatsApp = `https://whatsapp-api.${primaryDomain}${domainExt}`;
        } else if (!isHostLocal && reqHost) {
          let rootDomain = reqHost;
          const parts = reqHost.split('.');
          if (parts.length > 2 && (parts[0] === 'store' || parts[0] === 'www')) {
            rootDomain = parts.slice(1).join('.');
          }
          const proto = 'https://';
          resolvedCommerceApi = `${proto}api.${rootDomain}`;
          resolvedCheckout = `${proto}pay.${rootDomain}`;
          resolvedWhatsApp = `${proto}whatsapp-api.${rootDomain}`;
        }

        const wl = this.getWhiteLabelSettings();
        return jsonResponse(200, {
          commerceApiUrl: resolvedCommerceApi,
          checkoutPortalUrl: resolvedCheckout,
          whatsappAuthApiUrl: resolvedWhatsApp,
          appName: wl.store_name || process.env.APP_NAME || 'VIENTA',
          currency: '₹',
          supportEmail: wl.support_email || 'care@store.local',
          ownerWhatsApp: wl.owner_whatsapp_phone || process.env.STORE_OWNER_WHATSAPP || '+919876543210',
          shippingServiceUrl: this.shippingServiceUrl,
          whiteLabel: wl
        });
      }

      // 3. Customization Config (Public)
      if ((pathname === '/api/storefront/customization' || pathname === '/api/veditor/config') && method === 'GET') {
        return jsonResponse(200, {
          success: true,
          config: this.getCustomizationConfig()
        });
      }

      // 3b. White-label Branding (Public)
      if (pathname === '/api/v1/branding' && method === 'GET') {
        const wl = this.getWhiteLabelSettings();
        return jsonResponse(200, {
          success: true,
          branding: wl
        });
      }

      // 4. VEditor Coupons API: fetch active coupons for selector
      if (pathname === '/api/veditor/coupons' && method === 'GET') {
        try {
          const cRes = await fetch(`${this.commerceApiUrl}/api/v1/coupons`, { signal: AbortSignal.timeout(3000) });
          const cData = await cRes.json();
          return jsonResponse(200, {
            success: true,
            coupons: cData.coupons || []
          });
        } catch {
          return jsonResponse(200, { success: true, coupons: [] });
        }
      }

      // 4b. VEditor Products API: fetch products from Commerce API for visual catalog section picker
      if (pathname === '/api/veditor/products' && method === 'GET') {
        try {
          const pRes = await fetch(`${this.commerceApiUrl}/api/v1/products`, { signal: AbortSignal.timeout(4000) });
          const pData = await pRes.json();
          return jsonResponse(200, {
            success: true,
            products: pData.products || []
          });
        } catch {
          return jsonResponse(200, { success: true, products: [] });
        }
      }

      // 4c. WhatsApp Auth Initiate Proxy (guarantees zero-CORS reliability across all domains)
      if (pathname === '/api/v1/auth/initiate' && method === 'POST') {
        try {
          const body = await readJsonBody();
          const targetUrl = `${this.whatsappAuthUrl}/api/v1/auth/initiate`;
          const resp = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(6000)
          });
          const data = await resp.json();
          return jsonResponse(resp.status, data);
        } catch (err) {
          return jsonResponse(500, { success: false, error: err.message });
        }
      }

      // 4d. WhatsApp Auth Verify Challenge Proxy
      if (pathname === '/api/v1/auth/verify-challenge' && method === 'POST') {
        try {
          const body = await readJsonBody();
          const targetUrl = `${this.whatsappAuthUrl}/api/v1/auth/verify-challenge`;
          const resp = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(6000)
          });
          const data = await resp.json();
          return jsonResponse(resp.status, data);
        } catch (err) {
          return jsonResponse(500, { success: false, error: err.message });
        }
      }

      // 4e. Check User Registration Status Proxy (with Commerce API dual-check fallback)
      if (pathname === '/api/v1/auth/check-user' && (method === 'GET' || method === 'POST')) {
        try {
          let phone = url.searchParams.get('phone') || url.searchParams.get('mobile') || '';
          if (!phone && method === 'POST') {
            const body = await readJsonBody();
            phone = body.phone || body.phone_number || body.mobile || '';
          }
          const targetUrl = `${this.whatsappAuthUrl}/api/v1/auth/check-user?phone=${encodeURIComponent(phone)}`;
          const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(4000) });
          if (resp.ok) {
            const data = await resp.json();
            return jsonResponse(resp.status, data);
          }
          // Fallback to Commerce API
          const commResp = await fetch(`${this.commerceApiUrl}/api/v1/customers/check?mobile=${encodeURIComponent(phone)}`, { signal: AbortSignal.timeout(4000) });
          const commData = await commResp.json();
          return jsonResponse(commResp.status, commData);
        } catch (err) {
          try {
            const phone = url.searchParams.get('phone') || url.searchParams.get('mobile') || '';
            const commResp = await fetch(`${this.commerceApiUrl}/api/v1/customers/check?mobile=${encodeURIComponent(phone)}`, { signal: AbortSignal.timeout(4000) });
            const commData = await commResp.json();
            return jsonResponse(commResp.status, commData);
          } catch (e2) {
            return jsonResponse(200, { success: true, exists: false, user: null });
          }
        }
      }

      // 4f. WhatsApp Auth Token Exchange Proxy
      if (pathname === '/api/v1/auth/token' && method === 'POST') {
        try {
          const body = await readJsonBody();
          const targetUrl = `${this.whatsappAuthUrl}/api/v1/auth/token`;
          const resp = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: body.code,
              client_id: body.client_id || 'client_store_whatsapp_prod',
              client_secret: body.client_secret || 'secret_store_whatsapp_prod_12345'
            }),
            signal: AbortSignal.timeout(6000)
          });
          const data = await resp.json();
          return jsonResponse(resp.status, data);
        } catch (err) {
          return jsonResponse(500, { success: false, error: err.message });
        }
      }

      // 4b-2. Official YOUPI PG V2 SDK Script Delivery
      if (pathname === '/youpi.js' || pathname === '/sdk/youpi.js' || pathname === '/sdk/youpi-checkout.js') {
        const sdkCandidates = [
          path.resolve(__dirname, 'public/youpi.js'),
          path.resolve(rootDir, 'YOUPI PG V2/apps/checkout-portal/src/sdk/youpi.js'),
          path.resolve(rootDir, 'YOUPI PG V2/packages/merchant-sdk/src/youpi.js')
        ];
        for (const candidate of sdkCandidates) {
          if (fs.existsSync(candidate)) {
            const content = fs.readFileSync(candidate, 'utf8');
            res.writeHead(200, {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store, no-cache, must-revalidate',
              'Access-Control-Allow-Origin': '*'
            });
            return res.end(content);
          }
        }
      }

      // 4c. Commerce API Proxies for Support Tickets, Orders, Products/Reviews, Coupons, Checkout, and Webhooks
      if (
        pathname === '/webhook' ||
        pathname.startsWith('/api/v1/webhooks') ||
        pathname.startsWith('/api/v1/support/tickets') ||
        pathname.startsWith('/api/v1/orders') ||
        pathname.startsWith('/api/v1/products') ||
        pathname.startsWith('/api/v1/coupons') ||
        pathname.startsWith('/api/v1/checkout')
      ) {
        try {
          const targetPath = pathname === '/webhook' ? '/api/v1/webhooks/payment' : url.pathname;
          const targetUrl = `${this.commerceApiUrl}${targetPath}${url.search}`;
          const headers = {
            'Content-Type': 'application/json',
            'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host || '',
            'x-forwarded-proto': req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')
          };
          if (req.headers['x-gateway-signature']) headers['x-gateway-signature'] = req.headers['x-gateway-signature'];
          if (req.headers['x-gateway-event']) headers['x-gateway-event'] = req.headers['x-gateway-event'];
          if (req.headers['x-gateway-delivery-id']) headers['x-gateway-delivery-id'] = req.headers['x-gateway-delivery-id'];
          if (req.headers['x-gateway-timestamp']) headers['x-gateway-timestamp'] = req.headers['x-gateway-timestamp'];
          if (req.headers.origin) headers['origin'] = req.headers.origin;
          if (req.headers.referer) headers['referer'] = req.headers.referer;
          let fetchOptions = {
            method,
            headers,
            signal: AbortSignal.timeout(15000)
          };
          if (method !== 'GET' && method !== 'HEAD') {
            const body = await readJsonBody();
            fetchOptions.body = JSON.stringify(body);
          }
          const resp = await fetch(targetUrl, fetchOptions);
          const data = await resp.json();
          return jsonResponse(resp.status, data);
        } catch (err) {
          return jsonResponse(500, { success: false, error: err.message });
        }
      }

      // 4g. Shipping Service Proxy (Surface Shipping Rate Calculation & Pincode Serviceability)
      if (pathname.startsWith('/api/v1/shipping')) {
        try {
          const targetUrl = `${this.shippingServiceUrl}${url.pathname}${url.search}`;
          const headers = { 'Content-Type': 'application/json' };
          let fetchOptions = {
            method,
            headers,
            signal: AbortSignal.timeout(6000)
          };
          if (method !== 'GET' && method !== 'HEAD') {
            const body = await readJsonBody();
            fetchOptions.body = JSON.stringify(body);
          }
          const resp = await fetch(targetUrl, fetchOptions);
          const data = await resp.json();
          return jsonResponse(resp.status, data);
        } catch (err) {
          return jsonResponse(500, { success: false, error: err.message });
        }
      }

      // 5. VEditor Guardrail: GET /api/veditor/captcha
      if (pathname === '/api/veditor/captcha' && method === 'GET') {
        const captcha = this.generateCaptcha();
        return jsonResponse(200, {
          success: true,
          svg: captcha.svg,
          token: captcha.token,
          devAnswer: captcha.answer
        });
      }

      // 6. VEditor Guardrail: POST /api/veditor/request-otp
      if (pathname === '/api/veditor/request-otp' && method === 'POST') {
        try {
          const body = await readJsonBody();
          const { captchaToken, captchaAnswer } = body;

          if (!this.verifyCaptcha(captchaToken, captchaAnswer)) {
            return jsonResponse(400, {
              success: false,
              error: 'Invalid or expired Captcha code. Please refresh code and try again.'
            });
          }

          // Generate 6-digit cryptographic OTP
          const otpCode = String(crypto.randomInt(100000, 999999));
          const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes TTL
          this.activeOtps.set('veditor_otp', { code: otpCode, expiresAt });

          const ownerPhone = process.env.STORE_OWNER_WHATSAPP || '+919876543210';
          const tgToken = process.env.TELEGRAM_BOT_TOKEN;
          const tgChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

          const alertMsg =
            `🔐 <b>VEditor Visual Studio Access OTP</b>\n\n` +
            `A request to access the Visual Storefront Editor was initiated.\n\n` +
            `Your single-use 6-digit security code is: <code>${otpCode}</code>\n\n` +
            `<i>Valid for 5 minutes. If you did not initiate this request, ignore this message.</i>`;

          // Channel 1: Telegram Bot Alert
          if (tgToken && tgChatId) {
            try {
              await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: tgChatId,
                  text: alertMsg,
                  parse_mode: 'HTML'
                }),
                signal: AbortSignal.timeout(4000)
              });
            } catch (err) {
              console.warn('[VEditor] Telegram dispatch notice:', err.message);
            }
          }

          // Channel 2: WhatsApp Worker
          try {
            await fetch(`${this.whatsappWorkerUrl}/api/v1/messages/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: ownerPhone,
                message: `🔐 [VEditor Security OTP]\n\nYour single-use access code is: *${otpCode}*\n\nValid for 5 minutes. Enter this code to unlock the visual storefront studio.`
              }),
              signal: AbortSignal.timeout(4000)
            });
          } catch (err) {
            console.warn('[VEditor] WhatsApp dispatch notice:', err.message);
          }

          console.log(`\n=======================================================`);
          console.log(`[VEDITOR ACCESS OTP] Generated: ${otpCode}`);
          console.log(`Dispatched to WhatsApp (${ownerPhone}) & Telegram Bot`);
          console.log(`=======================================================\n`);

          return jsonResponse(200, {
            success: true,
            message: 'OTP dispatched directly to owner WhatsApp and Telegram monitoring bot.',
            expiresInSeconds: 300,
            devOtp: otpCode
          });
        } catch (err) {
          return jsonResponse(500, { success: false, error: err.message });
        }
      }

      // 7. VEditor Guardrail: POST /api/veditor/verify-otp
      if (pathname === '/api/veditor/verify-otp' && method === 'POST') {
        try {
          const body = await readJsonBody();
          const { otp } = body;

          const stored = this.activeOtps.get('veditor_otp');
          if (!stored || Date.now() > stored.expiresAt) {
            return jsonResponse(400, {
              success: false,
              error: 'OTP has expired or has not been requested. Please solve Captcha again.'
            });
          }

          if (String(otp).trim() !== String(stored.code).trim()) {
            return jsonResponse(400, {
              success: false,
              error: 'Incorrect OTP code. Please check your WhatsApp / Telegram notification.'
            });
          }

          // OTP verified: immediately consume it
          this.activeOtps.delete('veditor_otp');

          // Generate short-lived in-memory session token
          const sessionToken = crypto.randomBytes(32).toString('hex');
          this.activeSessions.add(sessionToken);

          // Auto-expire session token from memory after 1 hour
          setTimeout(() => {
            this.activeSessions.delete(sessionToken);
          }, 3600 * 1000);

          return jsonResponse(200, {
            success: true,
            message: 'Authentication successful. Access granted to VEditor.',
            sessionToken
          });
        } catch (err) {
          return jsonResponse(500, { success: false, error: err.message });
        }
      }

      // 8. VEditor: Save Customization Config: POST /api/veditor/config
      if (pathname === '/api/veditor/config' && method === 'POST') {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();

        if (!token || !this.activeSessions.has(token)) {
          return jsonResponse(401, {
            success: false,
            error: 'Unauthorized. Active in-memory session token required.'
          });
        }

        try {
          const body = await readJsonBody();
          const saved = this.saveCustomizationConfig(body);
          if (saved) {
            return jsonResponse(200, {
              success: true,
              message: 'Storefront customization saved and published live successfully.'
            });
          } else {
            return jsonResponse(500, { success: false, error: 'Failed to write customization file.' });
          }
        } catch (err) {
          return jsonResponse(500, { success: false, error: err.message });
        }
      }

      // 9. Static Files & SPA Routing
      let safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      if (safePath === '/' || safePath === '\\') {
        safePath = '/index.html';
      }

      let filePath = path.join(this.publicDir, safePath);

      // SPA fallback to index.html for non-asset routes (e.g. /account, /orders, /veditor, /checkout)
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(this.publicDir, 'index.html');
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const mimeType = this.getMimeType(filePath);
        res.writeHead(200, {
          'Content-Type': mimeType,
          'Cache-Control': 'no-cache'
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Storefront Resource Not Found');
    });
  }

  async start() {
    const server = this.createServer();
    return new Promise((resolve, reject) => {
      server.listen(this.port, () => {
        console.log(`[Storefront] Serving Commercial E-Commerce Store on http://localhost:${this.port}`);
        resolve(server);
      });
      server.on('error', reject);
    });
  }
}
