import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Database } from '@youpi/db';
import { startServer as startPaymentApi } from '../index.js';
import { PaymentStatus, PaymentMethod, SellingMode } from '@youpi/common';

describe('Architectural Update: Selling Modes (Online vs Offline), COD Flow, & Clean VPA Config', () => {
  let apiInstance;
  let baseUrl;
  let testDb;

  before(async () => {
    testDb = new Database({ inMemory: true });
    apiInstance = await startPaymentApi(6195, testDb);
    baseUrl = `http://localhost:${apiInstance.port}`;
  });

  after(async () => {
    await apiInstance.close();
    testDb.close();
  });

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(url, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let body;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({ status: res.statusCode, body });
        });
      });

      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  test('1. Admin VPA Configuration: Clean VPA + Payee Name without merchant/personal distinction', async () => {
    const res = await request('/api/v1/admin/upi-accounts', {
      method: 'POST',
      body: {
        upiId: 'superstore@okhdfcbank',
        payeeName: 'SuperStore Retail',
        isActive: true
      }
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.account.upiId, 'superstore@okhdfcbank');
    assert.equal(res.body.account.payeeName, 'SuperStore Retail');
    assert.equal(res.body.account.isActive, true);

    // Verify in upi-settings endpoint
    const getRes = await request('/api/v1/admin/upi-settings');
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.upiId, 'superstore@okhdfcbank');
    assert.equal(getRes.body.payeeName, 'SuperStore Retail');
  });

  test('2. Online Selling Mode Configuration & Method Invariants', async () => {
    // Merchant configures Online Selling Mode with Cash on Delivery enabled
    const saveRes = await request('/api/v1/admin/merchant-settings', {
      method: 'POST',
      body: {
        sellingMode: 'ONLINE',
        codEnabled: true,
        branding: {
          appName: 'YouPI Online Store',
          sellingMode: 'ONLINE'
        }
      }
    });

    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.body.sellingMode, 'ONLINE');
    assert.deepEqual(saveRes.body.enabledPaymentMethods, ['UPI', 'COD']);
    assert.equal(saveRes.body.codEnabled, true);

    // Create a payment session
    const payRes = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        orderId: 'ORDER-ONLINE-101',
        amount: '499.00',
        method: PaymentMethod.UPI,
        autoActivate: true
      }
    });
    assert.equal(payRes.status, 201);
    const paymentId = payRes.body.paymentId;

    // Checkout state must return ONLINE mode and enabledMethods: ['UPI', 'COD']
    const stateRes = await request(`/api/v1/checkout/${paymentId}/state`);
    assert.equal(stateRes.status, 200);
    assert.equal(stateRes.body.sellingMode, 'ONLINE');
    assert.deepEqual(stateRes.body.enabledMethods, ['UPI', 'COD']);

    // Attempting to select CASH_COUNTER or CARD_COUNTER in ONLINE mode must be rejected
    const invalidSwitchRes = await request(`/api/v1/checkout/${paymentId}/select-method`, {
      method: 'POST',
      body: { method: 'CASH_COUNTER' }
    });
    assert.equal(invalidSwitchRes.status, 400);

    // Turning off COD in ONLINE mode leaves only UPI
    const codOffRes = await request('/api/v1/admin/merchant-settings', {
      method: 'POST',
      body: {
        sellingMode: 'ONLINE',
        codEnabled: false
      }
    });
    assert.equal(codOffRes.status, 200);
    assert.deepEqual(codOffRes.body.enabledPaymentMethods, ['UPI']);

    const stateCodOff = await request(`/api/v1/checkout/${paymentId}/state`);
    assert.deepEqual(stateCodOff.body.enabledMethods, ['UPI']);
  });

  test('3. COD Pre-Purchase Confirmation, Slot Release, & Developer API Endpoints', async () => {
    // Ensure slot is free
    testDb.execute(`UPDATE payment_sessions SET status = 'CANCELLED' WHERE status IN ('ACTIVE', 'PROCESSING', 'QUEUED')`);
    testDb.execute(`UPDATE payment_receiving_accounts SET is_slot_busy = 0, current_active_session_id = NULL`);

    // Re-enable COD in Online mode
    await request('/api/v1/admin/merchant-settings', {
      method: 'POST',
      body: {
        sellingMode: 'ONLINE',
        codEnabled: true
      }
    });

    // Create customer to attach to checkout
    testDb.execute(
      `INSERT INTO customers (id, name, mobile_number, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ['00000000-0000-0000-0000-000000000099', 'Rahul Sharma', '9876543210', 'rahul@example.com']
    );

    // Session A is created and holds the active UPI slot
    const payARes = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        orderId: 'ORDER-COD-A',
        amount: '899.00',
        method: PaymentMethod.UPI,
        customerId: '00000000-0000-0000-0000-000000000099',
        autoActivate: true
      }
    });
    const paymentIdA = payARes.body.paymentId;
    assert.equal(payARes.body.status, PaymentStatus.ACTIVE);

    // Session B is created and enters the waiting queue behind Session A
    const payBRes = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        orderId: 'ORDER-UPI-B',
        amount: '1200.00',
        method: PaymentMethod.UPI,
        autoActivate: true
      }
    });
    const paymentIdB = payBRes.body.paymentId;
    assert.equal(payBRes.body.status, PaymentStatus.QUEUED);
    assert.equal(payBRes.body.queuePosition, 1);

    // Customer A switches to COD and confirms Cash on Delivery order
    const confirmCodRes = await request(`/api/v1/checkout/${paymentIdA}/confirm-cod`, {
      method: 'POST'
    });

    assert.equal(confirmCodRes.status, 200);
    assert.equal(confirmCodRes.body.success, true);
    assert.equal(confirmCodRes.body.method, 'COD');
    assert.equal(confirmCodRes.body.status, PaymentStatus.SUCCESS);
    assert.equal(confirmCodRes.body.verificationTag, 'COD_ORDER_PLACED');

    // INVARIANT: When Customer A confirmed COD, Session B must immediately be promoted to ACTIVE!
    const checkBRes = await request(`/api/v1/checkout/${paymentIdB}/state`);
    assert.equal(checkBRes.body.status, PaymentStatus.ACTIVE);
    assert.equal(checkBRes.body.queuePosition, 0);

    // Developer API endpoint: GET /api/v1/orders/:orderId/cod
    const devOrderRes = await request('/api/v1/orders/ORDER-COD-A/cod');
    assert.equal(devOrderRes.status, 200);
    assert.equal(devOrderRes.body.orderId, 'ORDER-COD-A');
    assert.equal(devOrderRes.body.paymentId, paymentIdA);
    assert.equal(devOrderRes.body.method, 'COD');
    assert.equal(devOrderRes.body.status, 'SUCCESS');
    assert.equal(devOrderRes.body.isCod, true);
    assert.equal(devOrderRes.body.amount, '899.00');
    assert.equal(devOrderRes.body.customer.name, 'Rahul Sharma');
    assert.equal(devOrderRes.body.customer.mobileNumber, '9876543210');

    // Developer API endpoint: GET /api/v1/payments/:id/cod
    const devPayRes = await request(`/api/v1/payments/${paymentIdA}/cod`);
    assert.equal(devPayRes.status, 200);
    assert.equal(devPayRes.body.paymentId, paymentIdA);
    assert.equal(devPayRes.body.orderId, 'ORDER-COD-A');
    assert.equal(devPayRes.body.method, 'COD');

    // Merchant Admin COD Orders listing: GET /api/v1/admin/cod-orders
    const adminCodListRes = await request('/api/v1/admin/cod-orders');
    assert.equal(adminCodListRes.status, 200);
    assert.ok(Array.isArray(adminCodListRes.body.codOrders));
    const foundOrder = adminCodListRes.body.codOrders.find(o => o.orderId === 'ORDER-COD-A');
    assert.ok(foundOrder);
    assert.equal(foundOrder.paymentId, paymentIdA);
    assert.equal(foundOrder.customerName, 'Rahul Sharma');
  });

  test('4. Offline Selling Mode: Cash and Card (renamed), COD completely removed', async () => {
    // Switch to OFFLINE mode with Cash & Card enabled
    const offlineSaveRes = await request('/api/v1/admin/merchant-settings', {
      method: 'POST',
      body: {
        sellingMode: 'OFFLINE',
        cashEnabled: true,
        cardEnabled: true
      }
    });

    assert.equal(offlineSaveRes.status, 200);
    assert.equal(offlineSaveRes.body.sellingMode, 'OFFLINE');
    assert.deepEqual(offlineSaveRes.body.enabledPaymentMethods, ['UPI', 'CASH_COUNTER', 'CARD_COUNTER']);
    assert.equal(offlineSaveRes.body.cashEnabled, true);
    assert.equal(offlineSaveRes.body.cardEnabled, true);

    // Create session in OFFLINE mode
    const payRes = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        orderId: 'ORDER-OFFLINE-201',
        amount: '150.00',
        method: PaymentMethod.UPI,
        autoActivate: true
      }
    });
    const paymentId = payRes.body.paymentId;

    const stateRes = await request(`/api/v1/checkout/${paymentId}/state`);
    assert.equal(stateRes.status, 200);
    assert.equal(stateRes.body.sellingMode, 'OFFLINE');
    assert.deepEqual(stateRes.body.enabledMethods, ['UPI', 'CASH_COUNTER', 'CARD_COUNTER']);
    assert.equal(stateRes.body.enabledMethods.includes('COD'), false);

    // Attempting to confirm COD in OFFLINE mode must be rejected
    const invalidCodRes = await request(`/api/v1/checkout/${paymentId}/confirm-cod`, {
      method: 'POST'
    });
    assert.equal(invalidCodRes.status, 400);

    // Disable Card: only Cash + UPI remain
    const cardOffRes = await request('/api/v1/admin/merchant-settings', {
      method: 'POST',
      body: {
        sellingMode: 'OFFLINE',
        cashEnabled: true,
        cardEnabled: false
      }
    });
    assert.equal(cardOffRes.status, 200);
    assert.deepEqual(cardOffRes.body.enabledPaymentMethods, ['UPI', 'CASH_COUNTER']);

    const stateCardOff = await request(`/api/v1/checkout/${paymentId}/state`);
    assert.deepEqual(stateCardOff.body.enabledMethods, ['UPI', 'CASH_COUNTER']);
  });
});
