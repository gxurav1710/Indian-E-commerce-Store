import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Database } from '@youpi/db';
import { startServer as startPaymentApi } from '../index.js';
import { PaymentStatus, PaymentMethod } from '@youpi/common';

describe('COD Parallel Timer & UPI Queue Decoupling Suite', () => {
  let apiInstance;
  let baseUrl;
  let testDb;

  before(async () => {
    testDb = new Database({ inMemory: true });
    apiInstance = await startPaymentApi(6196, testDb);
    baseUrl = `http://localhost:${apiInstance.port}`;

    const merchantId = '00000000-0000-0000-0000-000000000001';
    testDb.execute(
      `UPDATE merchants
       SET branding = ?
       WHERE id = ?`,
      [
        JSON.stringify({
          sellingMode: 'ONLINE',
          enabledPaymentMethods: ['UPI', 'COD']
        }),
        merchantId
      ]
    );

    // Create an active receiving account
    testDb.execute(`
      UPDATE payment_receiving_accounts
      SET is_slot_busy = 0, current_active_session_id = NULL
    `);

    testDb.execute(
      `INSERT INTO customers (id, name, mobile_number, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ['00000000-0000-0000-0000-000000000099', 'Rohan Verma', '9123456789', 'rohan@example.com']
    );
  });

  after(async () => {
    if (apiInstance?.close) {
      await apiInstance.close();
    }
    if (testDb?.close) {
      testDb.close();
    }
  });

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(
        url,
        {
          method: options.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode, body: data });
            }
          });
        }
      );
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  test('Switching from UPI to COD decouples UPI queue, promotes queued customer, and starts parallel 5-min timer', async () => {
    // 1. Session A starts on UPI and holds the active UPI queue slot
    const payA = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        orderId: 'ORD-UPI-TIMER-1',
        amount: '500.00',
        method: PaymentMethod.UPI,
        customerId: '00000000-0000-0000-0000-000000000099',
        autoActivate: true
      }
    });
    assert.equal(payA.status, 201);
    assert.equal(payA.body.status, PaymentStatus.ACTIVE);
    const sessionAId = payA.body.paymentId;

    // Simulate time running down to 30 seconds left on Session A's UPI slot
    const expiringSoon = new Date(Date.now() + 30000);
    testDb.execute(`UPDATE payment_sessions SET expires_at = ? WHERE id = ?`, [expiringSoon.toISOString(), sessionAId]);

    // 2. Session B starts on UPI and enters the queue behind Session A
    const payB = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        orderId: 'ORD-UPI-QUEUE-2',
        amount: '750.00',
        method: PaymentMethod.UPI,
        autoActivate: true
      }
    });
    assert.equal(payB.status, 201);
    assert.equal(payB.body.status, PaymentStatus.QUEUED);
    assert.equal(payB.body.queuePosition, 1);
    const sessionBId = payB.body.paymentId;

    // 3. Customer A switches payment mode from UPI to COD via /select-method
    const switchRes = await request(`/api/v1/checkout/${sessionAId}/select-method`, {
      method: 'POST',
      body: { method: 'COD' }
    });
    assert.equal(switchRes.status, 200);
    assert.equal(switchRes.body.success, true);
    assert.equal(switchRes.body.method, 'COD');
    assert.equal(switchRes.body.status, PaymentStatus.ACTIVE);
    // Parallel timer must be ~300 seconds (5 minutes), NOT the old 30 seconds!
    assert.ok(switchRes.body.timeRemainingSeconds >= 295 && switchRes.body.timeRemainingSeconds <= 300);

    // 4. Invariant: Session A must be completely decoupled from the UPI receiving account slot
    const stateA = await request(`/api/v1/checkout/${sessionAId}/state`);
    assert.equal(stateA.body.method, 'COD');
    assert.equal(stateA.body.queuePosition, 0);

    // In DB, Session A receiving_account_id must be NULL
    const rowA = testDb.queryOne(`SELECT * FROM payment_sessions WHERE id = ?`, [sessionAId]);
    assert.equal(rowA.receiving_account_id, null);
    assert.equal(rowA.method, 'COD');

    // 5. Invariant: Session B must be immediately promoted to ACTIVE in the UPI slot
    const stateB = await request(`/api/v1/checkout/${sessionBId}/state`);
    assert.equal(stateB.body.status, PaymentStatus.ACTIVE);
    assert.equal(stateB.body.queuePosition, 0);

    // 6. Invariant: Admin queue now shows Session B occupying the active UPI concurrency slot
    const adminQueue = await request('/api/v1/admin/queue');
    assert.equal(adminQueue.status, 200);
    assert.ok(adminQueue.body.currentSlot);
    assert.equal(adminQueue.body.currentSlot.id, sessionBId);
    assert.equal(adminQueue.body.currentSlot.orderId, 'ORD-UPI-QUEUE-2');

    // Clean up
    await request(`/api/v1/checkout/${sessionBId}/cancel`, { method: 'POST' });
  });

  test('COD session expires after parallel 5-minute window without touching UPI queue', async () => {
    // 1. Create COD session
    const payCod = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        orderId: 'ORD-COD-EXPIRE-1',
        amount: '450.00',
        method: PaymentMethod.COD,
        customerId: '00000000-0000-0000-0000-000000000099',
        autoActivate: true
      }
    });
    assert.equal(payCod.status, 201);
    const codSessionId = payCod.body.paymentId;

    // Explicitly select COD to ensure parallel timer is armed
    const switchRes = await request(`/api/v1/checkout/${codSessionId}/select-method`, {
      method: 'POST',
      body: { method: 'COD' }
    });
    assert.equal(switchRes.status, 200);
    assert.equal(switchRes.body.timeRemainingSeconds, 300);

    // Fast-forward / trigger expiration
    const expireRes = await request(`/api/v1/checkout/${codSessionId}/expire`, {
      method: 'POST'
    });
    assert.equal(expireRes.status, 200);
    assert.equal(expireRes.body.status, PaymentStatus.EXPIRED);

    // Verify session in DB is EXPIRED
    const row = testDb.queryOne(`SELECT * FROM payment_sessions WHERE id = ?`, [codSessionId]);
    assert.equal(row.status, PaymentStatus.EXPIRED);
    assert.equal(row.receiving_account_id, null);
  });
});
