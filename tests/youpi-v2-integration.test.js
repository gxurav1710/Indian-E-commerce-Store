import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database, createRepositories } from '../packages/db/src/index.js';
import { CommerceApiServer } from '../services/commerce-api/src/server.js';
import { StorefrontServer } from '../apps/storefront/src/server.js';
import { globalEventBus, EVENT_TYPES } from '../packages/common/src/events.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('YOUPI PG V2 — Universal Gateway Integration Test Suite', () => {
  let db;
  let repos;
  let commerceServer;
  let commerceHttp;
  let storefrontServer;
  let storefrontHttp;
  const testCommercePort = 5891;
  const testStorefrontPort = 5892;
  const webhookSecret = 'test_webhook_secret_v2_sha256_key';

  before(async () => {
    // In-memory test database for clean, isolated state
    db = new Database({ inMemory: true });
    repos = createRepositories(db);

    // Seed test category, product, and user
    const cat = repos.categories.create({ name: 'Streetwear', slug: 'streetwear' });
    const prod = repos.products.create({
      name: 'Oversized Acid Wash Tee',
      slug: 'oversized-tee',
      categoryId: cat.id,
      price: 799,
      sku: 'TEE-ACID-01',
      stock: 50
    });
    const user = repos.users.upsertCanonicalUser({
      name: 'Gaurav Kumar',
      mobile: '+919876543210',
      email: 'gaurav@example.com'
    });

    // Seed test order
    const order = repos.orders.createOrder({
      orderNumber: 'ORD-YOUPI-V2-001',
      userId: user.id,
      customerName: user.name,
      customerMobile: user.mobile,
      customerEmail: user.email,
      shippingAddress: {
        fullName: user.name,
        phone: user.mobile,
        addressLine1: 'Connaught Place',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110001'
      },
      items: [{
        productId: prod.id,
        name: prod.title,
        quantity: 1,
        unitPrice: 799
      }],
      subtotalAmount: 799,
      shippingFee: 0,
      discountAmount: 0,
      totalAmount: 799,
      paymentMethod: 'UPI'
    });

    // Spin up Commerce API Server on test port
    commerceServer = new CommerceApiServer({ port: testCommercePort });
    commerceServer.repos = repos;
    commerceServer.webhookSecret = webhookSecret;
    commerceHttp = commerceServer.createServer();
    await new Promise(resolve => commerceHttp.listen(testCommercePort, resolve));

    // Spin up Storefront Server on test port
    storefrontServer = new StorefrontServer({ port: testStorefrontPort, commerceApiUrl: `http://localhost:${testCommercePort}` });
    storefrontHttp = storefrontServer.createServer();
    await new Promise(resolve => storefrontHttp.listen(testStorefrontPort, resolve));
  });

  after(async () => {
    await new Promise(resolve => storefrontHttp.close(resolve));
    await new Promise(resolve => commerceHttp.close(resolve));
    db.close();
  });

  // 1. SDK Script Serving Test
  it('should serve official YOUPI PG V2 SDK script at /youpi.js with CORS and proper content-type', async () => {
    const res = await fetch(`http://localhost:${testStorefrontPort}/youpi.js`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('application/javascript'));
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');

    const body = await res.text();
    assert.ok(body.includes('YOUPI PG V2 — Universal One-Script Integration SDK'));
    assert.ok(body.includes('YoupiCheckout'));
    assert.ok(body.includes('globalScope.Youpi = YoupiCheckout'));
  });

  // 2. Authoritative Server Webhook HMAC-SHA256 Verification
  it('should authoritatively process signed webhook from YOUPI PG V2 and mark order as PAID', async () => {
    const payload = {
      event: 'SUCCESS',
      paymentId: 'pay_v2_session_test_9988',
      orderId: 'ORD-YOUPI-V2-001',
      amount: '799.00',
      amountPaise: 79900,
      currency: 'INR',
      method: 'UPI',
      utr: '123456789012',
      completedAt: new Date().toISOString(),
      metadata: { sku: 'TEE-ACID-01' }
    };
    const rawPayload = JSON.stringify(payload);

    // Compute expected HMAC-SHA256 signature
    const signature = crypto.createHmac('sha256', webhookSecret).update(rawPayload).digest('hex');

    let paymentSuccessEventFired = false;
    const unsub = globalEventBus.subscribe(EVENT_TYPES.PAYMENT_SUCCESS, (evt) => {
      if (evt.data?.orderNumber === 'ORD-YOUPI-V2-001') {
        paymentSuccessEventFired = true;
      }
    });

    const res = await fetch(`http://localhost:${testCommercePort}/api/v1/webhooks/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Event': 'SUCCESS',
        'X-Gateway-Signature': `sha256=${signature}`,
        'X-Gateway-Delivery-Id': crypto.randomUUID(),
        'X-Gateway-Timestamp': String(Date.now())
      },
      body: rawPayload
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.processed, true);

    // Verify DB update
    const updatedOrder = repos.orders.findByOrderNumber('ORD-YOUPI-V2-001');
    assert.strictEqual(updatedOrder.payment_status, 'SUCCESS');
    assert.strictEqual(updatedOrder.order_status, 'CONFIRMED');
    assert.ok(paymentSuccessEventFired, 'PAYMENT_SUCCESS event must be dispatched to trigger notifications');
  });

  // 3. Rejection of Tampered Webhook Signature in Production
  it('should reject tampered or invalid webhook signature in production mode', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const payload = {
        event: 'SUCCESS',
        paymentId: 'pay_tampered_001',
        orderId: 'ORD-YOUPI-V2-001',
        amount: '1.00'
      };
      const rawPayload = JSON.stringify(payload);

      const res = await fetch(`http://localhost:${testCommercePort}/api/v1/webhooks/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Event': 'SUCCESS',
          'X-Gateway-Signature': 'sha256=invalid_fake_tampered_hex_signature_here',
          'X-Gateway-Delivery-Id': crypto.randomUUID(),
          'X-Gateway-Timestamp': String(Date.now())
        },
        body: rawPayload
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error, 'Invalid HMAC signature');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  // 4. Missing Order ID Guardrail
  it('should return 400 when orderId is missing from webhook payload', async () => {
    const payload = {
      event: 'SUCCESS',
      amount: '500.00'
    };
    const rawPayload = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', webhookSecret).update(rawPayload).digest('hex');

    const res = await fetch(`http://localhost:${testCommercePort}/api/v1/webhooks/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Signature': `sha256=${signature}`
      },
      body: rawPayload
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Missing orderId'));
  });

  // 5. Storefront Proxy Route Test
  it('should forward /webhook on storefront port 5000 to commerce-api with gateway headers', async () => {
    const payload = {
      event: 'SUCCESS',
      paymentId: 'pay_proxy_test',
      orderId: 'ORD-YOUPI-V2-001',
      amount: '799.00',
      utr: '987654321098'
    };
    const rawPayload = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', webhookSecret).update(rawPayload).digest('hex');

    const res = await fetch(`http://localhost:${testStorefrontPort}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Event': 'SUCCESS',
        'X-Gateway-Signature': `sha256=${signature}`
      },
      body: rawPayload
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });
});
