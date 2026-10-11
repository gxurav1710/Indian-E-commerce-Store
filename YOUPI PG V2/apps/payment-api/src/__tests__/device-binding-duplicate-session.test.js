import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Database, CustomerRepository, PaymentSessionRepository, MerchantRepository } from '@youpi/db';
import { startServer as startPaymentApi } from '../index.js';

describe('YOUPI PG: Device Binding & Duplicate Session Detection', () => {
  let apiInstance;
  let baseUrl;
  let testDb;
  let merchantRepo;
  let sessionRepo;
  let customerRepo;
  const merchantId = '00000000-0000-0000-0000-000000000001';
  const receivingAccountId = '00000000-0000-0000-0000-000000000002';

  before(async () => {
    testDb = new Database({ inMemory: true });
    merchantRepo = new MerchantRepository(testDb);
    sessionRepo = new PaymentSessionRepository(testDb);
    customerRepo = new CustomerRepository(testDb);

    apiInstance = await startPaymentApi(6201, testDb);
    baseUrl = `http://localhost:${apiInstance.port}`;
  });

  after(async () => {
    if (apiInstance) await apiInstance.close();
    if (testDb) testDb.close();
  });

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-merchant-id': merchantId,
          ...(options.headers || {})
        }
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
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  test('1. Device registration (POST /api/v1/devices/register) generates unique deviceId and JWT deviceToken', async () => {
    const res = await request('/api/v1/devices/register', {
      method: 'POST',
      body: {
        publicKey: 'mock-public-key-device-alpha',
        signals: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
          platform: 'Win32',
          screenSignature: '1920x1080x24',
          canvasSignature: 'test-canvas-hash-alpha'
        }
      }
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.deviceId);
    assert.ok(res.body.deviceToken);
    assert.equal(res.body.success, true);
    assert.ok(res.body.deviceId.startsWith('dev_'));
  });

  test('2. Checkout session binds to the first device that accesses it', async () => {
    // Create a payment session
    const createRes = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        orderId: 'ORDER_DEV_001',
        amount: 499.00,
        customerName: 'Aarav Sharma',
        customerPhone: '+919876543210',
        customerEmail: 'aarav@example.com'
      }
    });

    assert.equal(createRes.status, 201);
    const sessionId = createRes.body.paymentId;
    assert.ok(sessionId);

    // Device 1 registers
    const regRes1 = await request('/api/v1/devices/register', {
      method: 'POST',
      body: {
        publicKey: 'dev-1-public-key',
        signals: { userAgent: 'Device-1-Agent' }
      }
    });
    const dev1Id = regRes1.body.deviceId;
    const dev1Token = regRes1.body.deviceToken;

    // Device 1 accesses the checkout session state
    const stateRes1 = await request(`/api/v1/checkout/${sessionId}/state`, {
      headers: {
        'x-device-id': dev1Id,
        'x-device-token': dev1Token
      }
    });

    assert.equal(stateRes1.status, 200);
    assert.equal(stateRes1.body.paymentId, sessionId);
    assert.equal(stateRes1.body.deviceId, dev1Id);

    // Verify session in database is bound to dev1Id
    const row = testDb.db.prepare('SELECT device_id FROM payment_sessions WHERE id = ?').get(sessionId);
    assert.equal(row.device_id, dev1Id);
  });

  test('3. Same bound device can perform repeated requests without conflict', async () => {
    const row = testDb.db.prepare('SELECT id, device_id FROM payment_sessions WHERE order_id = ?').get('ORDER_DEV_001');
    const sessionId = row.id;
    const dev1Id = row.device_id;

    // Access again with device 1
    const res = await request(`/api/v1/checkout/${sessionId}/state`, {
      headers: { 'x-device-id': dev1Id }
    });
    assert.equal(res.status, 200);

    // Select payment method with device 1
    const methodRes = await request(`/api/v1/checkout/${sessionId}/select-method`, {
      method: 'POST',
      headers: { 'x-device-id': dev1Id },
      body: { method: 'UPI' }
    });
    assert.equal(methodRes.status, 200);
  });

  test('4. Different device (dev-2) attempting to access session triggers DUPLICATE_SESSION_DETECTED (HTTP 409)', async () => {
    const row = testDb.db.prepare('SELECT id, device_id FROM payment_sessions WHERE order_id = ?').get('ORDER_DEV_001');
    const sessionId = row.id;

    // Device 2 registers
    const regRes2 = await request('/api/v1/devices/register', {
      method: 'POST',
      body: {
        publicKey: 'dev-2-public-key',
        signals: { userAgent: 'Device-2-Agent' }
      }
    });
    const dev2Id = regRes2.body.deviceId;
    const dev2Token = regRes2.body.deviceToken;

    // Device 2 attempts to fetch state of session bound to Device 1
    const conflictRes = await request(`/api/v1/checkout/${sessionId}/state`, {
      headers: {
        'x-device-id': dev2Id,
        'x-device-token': dev2Token
      }
    });

    assert.equal(conflictRes.status, 409);
    assert.equal(conflictRes.body.error, 'DUPLICATE_SESSION_DETECTED');
    assert.equal(conflictRes.body.action, 'END_SESSION_AND_CREATE_NEW');
    assert.ok(conflictRes.body.message.includes('another device'));
  });

  test('5. Non-bound device (dev-2) is blocked from taking payment actions', async () => {
    const row = testDb.db.prepare('SELECT id, device_id FROM payment_sessions WHERE order_id = ?').get('ORDER_DEV_001');
    const sessionId = row.id;

    // Device 2 attempts to select method
    const resMethod = await request(`/api/v1/checkout/${sessionId}/select-method`, {
      method: 'POST',
      headers: { 'x-device-id': 'dev_unauthorized_999' },
      body: { method: 'COD' }
    });
    assert.equal(resMethod.status, 409);
    assert.equal(resMethod.body.error, 'DUPLICATE_SESSION_DETECTED');

    // Device 2 attempts to confirm COD
    const resCod = await request(`/api/v1/checkout/${sessionId}/confirm-cod`, {
      method: 'POST',
      headers: { 'x-device-id': 'dev_unauthorized_999' }
    });
    assert.equal(resCod.status, 409);
    assert.equal(resCod.body.error, 'DUPLICATE_SESSION_DETECTED');
  });

  test('6. "End Session & Start New Payment" terminates the old session and creates a fresh session bound to the requesting device', async () => {
    const row = testDb.db.prepare('SELECT id, device_id FROM payment_sessions WHERE order_id = ?').get('ORDER_DEV_001');
    const oldSessionId = row.id;

    const newDevId = 'dev_recovery_replacement_888';

    // Call POST /api/v1/checkout/:id/end-and-restart-payment with new device
    const restartRes = await request(`/api/v1/checkout/${oldSessionId}/end-and-restart-payment`, {
      method: 'POST',
      headers: { 'x-device-id': newDevId },
      body: { deviceId: newDevId }
    });

    assert.equal(restartRes.status, 201);
    assert.equal(restartRes.body.success, true);
    assert.equal(restartRes.body.oldSessionId, oldSessionId);
    assert.ok(restartRes.body.newSessionId);
    assert.notEqual(restartRes.body.newSessionId, oldSessionId);
    assert.ok(restartRes.body.checkoutUrl.includes(restartRes.body.newSessionId));

    // Verify old session in DB is terminated
    const oldSessionDb = testDb.db.prepare('SELECT status FROM payment_sessions WHERE id = ?').get(oldSessionId);
    assert.equal(oldSessionDb.status, 'CANCELLED');

    // Verify new session in DB is bound to newDevId
    const newSessionDb = testDb.db.prepare('SELECT id, status, device_id, amount_paise, order_id FROM payment_sessions WHERE id = ?').get(restartRes.body.newSessionId);
    assert.ok(newSessionDb);
    assert.equal(newSessionDb.device_id, newDevId);
    assert.equal(newSessionDb.amount_paise, 49900);

    // Verify new device can seamlessly load new session state
    const newStateRes = await request(`/api/v1/checkout/${restartRes.body.newSessionId}/state`, {
      headers: { 'x-device-id': newDevId }
    });
    assert.equal(newStateRes.status, 200);
    assert.equal(newStateRes.body.paymentId, restartRes.body.newSessionId);
  });

  test('7. If a customer binds to a session, another session for the same customer triggers active session conflict', async () => {
    // Create customer
    const cust = customerRepo.create({
      merchantId,
      name: 'Concurrent User',
      email: 'concurrent@example.com',
      mobileNumber: '+919999888877'
    });

    // Create session 1
    const s1Res = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        orderId: 'ORDER_CONC_1',
        amount: 250.00,
        customerName: 'Concurrent User',
        customerPhone: '+919999888877',
        customerEmail: 'concurrent@example.com'
      }
    });
    const s1Id = s1Res.body.paymentId;

    // Bind customer to session 1
    const bind1Res = await request(`/api/v1/checkout/${s1Id}/bind-customer`, {
      method: 'POST',
      body: { customerId: cust.id }
    });

    // Create session 2 for same customer
    const s2Res = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        orderId: 'ORDER_CONC_2',
        amount: 350.00,
        customerName: 'Concurrent User',
        customerPhone: '+919999888877',
        customerEmail: 'concurrent@example.com'
      }
    });
    const s2Id = s2Res.body.paymentId;

    // Bind customer to session 2 -> conflict detected!
    const bind2Res = await request(`/api/v1/checkout/${s2Id}/bind-customer`, {
      method: 'POST',
      body: { customerId: cust.id }
    });

    assert.equal(bind2Res.body.hasActiveSessionConflict, true);
    assert.ok(bind2Res.body.conflictingSession);
    assert.equal(bind2Res.body.conflictingSession.paymentId, s1Id);
  });

  test('8. Prompt 64 Regression: Device A creates ACTIVE Session A, Device B attempts access, Device B chooses "End Session & Start New Payment" -> Session A becomes terminal, slot is released, and Device B\'s new Session B becomes ACTIVE immediately (not queued behind Session A)', async () => {
    // Reset any lingering sessions and clear receiving account slot from prior tests
    testDb.execute("UPDATE payment_sessions SET status = 'CANCELLED' WHERE status IN ('ACTIVE', 'PROCESSING', 'QUEUED')");
    testDb.execute("UPDATE payment_receiving_accounts SET is_slot_busy = 0, current_active_session_id = NULL");

    const devLaptopId = 'dev_laptop_prompt64_alpha';
    const devMobileId = 'dev_mobile_prompt64_beta';

    // 1. Register devices
    await request('/api/v1/devices/register', {
      method: 'POST',
      body: { publicKey: 'key_laptop_p64', signals: { userAgent: 'Laptop Chrome' } }
    });
    await request('/api/v1/devices/register', {
      method: 'POST',
      body: { publicKey: 'key_mobile_p64', signals: { userAgent: 'Mobile Safari' } }
    });

    // 2. Create customer
    const custP64 = customerRepo.create({
      merchantId,
      name: 'Mohit Laptop User',
      email: 'mohit.p64@example.com',
      mobileNumber: '+918796266491'
    });

    // 3. Create Session A with autoActivate: true
    const createRes = await request('/api/v1/payments', {
      method: 'POST',
      headers: { 'x-device-id': devLaptopId },
      body: {
        orderId: 'ORDER_P64_ALPHA',
        amount: 499.00,
        customerName: 'Mohit Laptop User',
        customerPhone: '+918796266491',
        customerEmail: 'mohit.p64@example.com',
        autoActivate: true
      }
    });

    assert.equal(createRes.status, 201);
    const sessionAId = createRes.body.paymentId;
    assert.ok(sessionAId);

    // Bind Session A to Laptop device
    const bindResA = await request(`/api/v1/checkout/${sessionAId}/bind-customer`, {
      method: 'POST',
      headers: { 'x-device-id': devLaptopId },
      body: { customerId: custP64.id }
    });
    assert.equal(bindResA.status, 200);

    // Verify Session A is ACTIVE in database and slot is occupied
    const sessionADbBefore = testDb.db.prepare('SELECT id, status, queue_position, device_id, receiving_account_id FROM payment_sessions WHERE id = ?').get(sessionAId);
    assert.equal(sessionADbBefore.status, 'ACTIVE');
    assert.equal(sessionADbBefore.queue_position, 0);
    assert.equal(sessionADbBefore.device_id, devLaptopId);

    const receivingAccBefore = testDb.db.prepare('SELECT is_slot_busy, current_active_session_id FROM payment_receiving_accounts WHERE id = ?').get(sessionADbBefore.receiving_account_id);
    assert.equal(receivingAccBefore.is_slot_busy, 1);
    assert.equal(receivingAccBefore.current_active_session_id, sessionAId);

    // 4. Device B attempts to access Session A -> triggers DUPLICATE_SESSION_DETECTED (HTTP 409)
    const accessResB = await request(`/api/v1/checkout/${sessionAId}/state`, {
      headers: { 'x-device-id': devMobileId }
    });
    assert.equal(accessResB.status, 409);
    assert.equal(accessResB.body.error, 'DUPLICATE_SESSION_DETECTED');
    assert.equal(accessResB.body.action, 'END_SESSION_AND_CREATE_NEW');
    assert.equal(accessResB.body.boundDeviceId, devLaptopId);

    // 5. Device B chooses "End Session & Start New Payment"
    const restartRes = await request(`/api/v1/checkout/${sessionAId}/end-and-restart-payment`, {
      method: 'POST',
      headers: { 'x-device-id': devMobileId },
      body: {
        deviceId: devMobileId,
        conflictingSessionId: sessionAId
      }
    });

    assert.equal(restartRes.status, 201);
    assert.equal(restartRes.body.success, true);
    assert.equal(restartRes.body.oldSessionId, sessionAId);
    assert.ok(restartRes.body.newSessionId);
    assert.notEqual(restartRes.body.newSessionId, sessionAId);

    // CRITICAL: Session B must become ACTIVE immediately, NOT QUEUED behind Session A!
    assert.equal(restartRes.body.status, 'ACTIVE', 'New session on Device B must become ACTIVE immediately');
    assert.equal(restartRes.body.queuePosition, 0, 'New session must have queuePosition 0, not queued');

    // 6. Verify database invariants
    // Old Session A must be CANCELLED / terminal
    const sessionADbAfter = testDb.db.prepare('SELECT status, completed_at FROM payment_sessions WHERE id = ?').get(sessionAId);
    assert.equal(sessionADbAfter.status, 'CANCELLED');
    assert.ok(sessionADbAfter.completed_at);

    // Receiving account active slot must be occupied by new Session B
    const receivingAccAfter = testDb.db.prepare('SELECT is_slot_busy, current_active_session_id FROM payment_receiving_accounts WHERE id = ?').get(sessionADbBefore.receiving_account_id);
    assert.equal(receivingAccAfter.is_slot_busy, 1);
    assert.equal(receivingAccAfter.current_active_session_id, restartRes.body.newSessionId);

    // New Session B in DB must be ACTIVE and bound to devMobileId
    const sessionBDb = testDb.db.prepare('SELECT id, status, queue_position, device_id FROM payment_sessions WHERE id = ?').get(restartRes.body.newSessionId);
    assert.equal(sessionBDb.status, 'ACTIVE');
    assert.equal(sessionBDb.queue_position, 0);
    assert.equal(sessionBDb.device_id, devMobileId);

    // 7. Device B loads state for new session seamlessly
    const stateB = await request(`/api/v1/checkout/${restartRes.body.newSessionId}/state`, {
      headers: { 'x-device-id': devMobileId }
    });
    assert.equal(stateB.status, 200);
    assert.equal(stateB.body.status, 'ACTIVE');
    assert.equal(stateB.body.queuePosition, 0);
    assert.equal(stateB.body.canClickPaymentDone, true);
  });

  test('9. Prompt 64 Queue Invariant: When Session A is terminated, existing queued Customer C is promoted to ACTIVE, and new Session B is queued at position 1', async () => {
    // Reset any lingering sessions and clear receiving account slot from prior tests
    testDb.execute("UPDATE payment_sessions SET status = 'CANCELLED' WHERE status IN ('ACTIVE', 'PROCESSING', 'QUEUED')");
    testDb.execute("UPDATE payment_receiving_accounts SET is_slot_busy = 0, current_active_session_id = NULL");

    const devLId = 'dev_laptop_p64_q9';
    const devMId = 'dev_mobile_p64_q9';
    const devCId = 'dev_other_customer_q9';

    // 1. Create active Session A on devLId
    const sARes = await request('/api/v1/payments', {
      method: 'POST',
      headers: { 'x-device-id': devLId },
      body: {
        orderId: 'ORDER_P64_Q9_A',
        amount: 500.00,
        customerName: 'User A',
        customerPhone: '+918888777701',
        customerEmail: 'usera@example.com',
        autoActivate: true
      }
    });
    const sAId = sARes.body.paymentId;

    // Verify Session A is active
    const sADb = testDb.db.prepare('SELECT status, receiving_account_id FROM payment_sessions WHERE id = ?').get(sAId);
    assert.equal(sADb.status, 'ACTIVE');

    // 2. Customer C arrives concurrently and gets queued
    const sCRes = await request('/api/v1/payments', {
      method: 'POST',
      headers: { 'x-device-id': devCId },
      body: {
        orderId: 'ORDER_P64_Q9_C',
        amount: 300.00,
        customerName: 'Queued Customer C',
        customerPhone: '+918888777702',
        customerEmail: 'userc@example.com',
        autoActivate: true
      }
    });
    const sCId = sCRes.body.paymentId;
    const sCDb = testDb.db.prepare('SELECT status, queue_position FROM payment_sessions WHERE id = ?').get(sCId);
    assert.equal(sCDb.status, 'QUEUED');
    assert.equal(sCDb.queue_position, 1);

    // 3. User A moves from Laptop (devLId) to Mobile (devMId) and ends Session A
    const restartRes = await request(`/api/v1/checkout/${sAId}/end-and-restart-payment`, {
      method: 'POST',
      headers: { 'x-device-id': devMId },
      body: {
        deviceId: devMId,
        conflictingSessionId: sAId
      }
    });

    assert.equal(restartRes.status, 201);
    assert.equal(restartRes.body.success, true);

    // Old Session A must be CANCELLED
    const sADbAfter = testDb.db.prepare('SELECT status FROM payment_sessions WHERE id = ?').get(sAId);
    assert.equal(sADbAfter.status, 'CANCELLED');

    // Customer C must be promoted to ACTIVE with slot
    const sCDbAfter = testDb.db.prepare('SELECT status, queue_position FROM payment_sessions WHERE id = ?').get(sCId);
    assert.equal(sCDbAfter.status, 'ACTIVE');
    assert.equal(sCDbAfter.queue_position, 0);

    const receivingAcc = testDb.db.prepare('SELECT is_slot_busy, current_active_session_id FROM payment_receiving_accounts WHERE id = ?').get(sADb.receiving_account_id);
    assert.equal(receivingAcc.is_slot_busy, 1);
    assert.equal(receivingAcc.current_active_session_id, sCId);

    // New Session B on devMId must be legitimately queued behind Customer C
    assert.equal(restartRes.body.status, 'QUEUED');
    assert.equal(restartRes.body.queuePosition, 1);

    const sBDb = testDb.db.prepare('SELECT status, queue_position, device_id FROM payment_sessions WHERE id = ?').get(restartRes.body.newSessionId);
    assert.equal(sBDb.status, 'QUEUED');
    assert.equal(sBDb.queue_position, 1);
    assert.equal(sBDb.device_id, devMId);
  });

  test('10. When duplicate payment session is detected and user starts new payment, admin queue receives info about ongoing session', async () => {
    // Reset sessions and clear slot
    testDb.execute("UPDATE payment_sessions SET status = 'CANCELLED' WHERE status IN ('ACTIVE', 'PROCESSING', 'QUEUED')");
    testDb.execute("UPDATE payment_receiving_accounts SET is_slot_busy = 0, current_active_session_id = NULL");

    const devA = 'dev_admin_sync_A';
    const devB = 'dev_admin_sync_B';

    // 1. Create session from scratch
    const createRes = await request('/api/v1/payments', {
      method: 'POST',
      headers: { 'x-device-id': devA },
      body: {
        orderId: 'ORDER_ADMIN_SYNC_001',
        amount: 750.00,
        autoActivate: true
      }
    });
    assert.equal(createRes.status, 201);
    const session1Id = createRes.body.paymentId;

    // Verify admin queue sees session 1
    const qRes1 = await request('/api/v1/admin/queue');
    assert.equal(qRes1.status, 200);
    assert.ok(qRes1.body.currentSlot);
    assert.equal(qRes1.body.currentSlot.id, session1Id);
    assert.equal(qRes1.body.currentSlot.orderId, 'ORDER_ADMIN_SYNC_001');

    // 2. Duplicate session detected on Device B
    const conflictRes = await request(`/api/v1/checkout/${session1Id}/state`, {
      headers: { 'x-device-id': devB }
    });
    assert.equal(conflictRes.status, 409);
    assert.equal(conflictRes.body.error, 'DUPLICATE_SESSION_DETECTED');

    // 3. Device B clicks "End Session & Start New Payment"
    const restartRes = await request(`/api/v1/checkout/${session1Id}/end-and-restart-payment`, {
      method: 'POST',
      headers: { 'x-device-id': devB },
      body: {
        deviceId: devB,
        conflictingSessionId: session1Id
      }
    });
    assert.equal(restartRes.status, 201);
    assert.equal(restartRes.body.success, true);
    assert.equal(restartRes.body.status, 'ACTIVE');
    const newSessionId = restartRes.body.newSessionId;

    // 4. CRITICAL: Verify admin queue immediately reflects the new ongoing active session!
    const qRes2 = await request('/api/v1/admin/queue');
    assert.equal(qRes2.status, 200);
    assert.ok(qRes2.body.currentSlot, 'Admin queue currentSlot must not be null');
    assert.equal(qRes2.body.currentSlot.id, newSessionId, 'Admin queue must show the new session ID');
    assert.equal(qRes2.body.currentSlot.status, 'ACTIVE', 'Admin queue currentSlot must be ACTIVE');
    assert.equal(qRes2.body.currentSlot.orderId, restartRes.body.orderId, 'Admin queue must show new session order ID');
    assert.ok(qRes2.body.currentSlot.expiresAt, 'Admin queue must have active timer expiresAt');
  });
});
