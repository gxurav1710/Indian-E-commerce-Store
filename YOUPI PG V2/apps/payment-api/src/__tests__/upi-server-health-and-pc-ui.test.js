import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Database } from '@youpi/db';
import { startServer as startPaymentApi } from '../index.js';
import { PaymentStatus, PaymentMethod } from '@youpi/common';

describe('UPI Server Health Indicator & Checkout State Invariants', () => {
  let apiInstance;
  let baseUrl;
  let testDb;

  const origSmsPort = process.env.SMS_OBSERVER_PORT;
  const origGmailPort = process.env.GMAIL_OBSERVER_PORT;

  before(async () => {
    process.env.SMS_OBSERVER_PORT = '6999';
    process.env.GMAIL_OBSERVER_PORT = '6998';
    testDb = new Database({ inMemory: true });
    apiInstance = await startPaymentApi(6207, testDb);
    baseUrl = `http://localhost:${apiInstance.port}`;
  });

  after(async () => {
    process.env.SMS_OBSERVER_PORT = origSmsPort;
    process.env.GMAIL_OBSERVER_PORT = origGmailPort;
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

  test('GET /api/v1/checkout/server-health returns valid health object', async () => {
    const res = await request('/api/v1/checkout/server-health');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.isWorking === 'boolean');
    assert.ok(['WORKING', 'ISSUES'].includes(res.body.status));
    assert.ok(['Server Is Working', 'Server Facing Issues'].includes(res.body.label));
    assert.ok(typeof res.body.reason === 'string');
  });

  test('Server health indicator detects offline pollers and issues warning', async () => {
    // Ensure no android devices
    testDb.execute('DELETE FROM android_devices');

    // Create session
    const createRes = await request('/api/v1/payments', {
      method: 'POST',
      body: {
        amount: 250.00,
        orderId: 'ORD-TEST-HEALTH-1',
        currency: 'INR'
      }
    });
    assert.equal(createRes.status, 201);
    const paymentId = createRes.body.paymentId;

    const stateRes = await request(`/api/v1/checkout/${paymentId}/state`);
    assert.equal(stateRes.status, 200);
    assert.ok(stateRes.body.upiServerIndicator);
    
    // Check fields
    const indicator = stateRes.body.upiServerIndicator;
    assert.ok(indicator.status);
    assert.ok(indicator.label);
    if (!indicator.isWorking) {
      assert.equal(indicator.status, 'ISSUES');
      assert.equal(indicator.label, 'Server Facing Issues');
      assert.ok(indicator.warning.includes('not recommended to pay by UPI'));
    }
  });

  test('Server health switches to WORKING when both Gmail OAuth and active SMS device are connected', async () => {
    // 1. Configure Gmail credentials on merchant
    const merchant = testDb.queryOne(`SELECT branding FROM merchants WHERE id = '00000000-0000-0000-0000-000000000001'`);
    const branding = JSON.parse(merchant?.branding || '{}');
    branding.gmailConfig = {
      refreshToken: 'test-refresh-token',
      clientId: 'test-client-id',
      clientSecret: 'test-secret'
    };
    testDb.execute(`UPDATE merchants SET branding = ? WHERE id = '00000000-0000-0000-0000-000000000001'`, [JSON.stringify(branding)]);

    // 2. Enroll and set recent heartbeat on an Android device
    testDb.execute(`
      INSERT INTO android_devices (id, merchant_id, device_name, device_model, signing_key_hash, is_active, last_heartbeat_at, created_at)
      VALUES ('dev-test-1', '00000000-0000-0000-0000-000000000001', 'Samsung Galaxy S22', 'SM-S901B', 'hash123', 1, datetime('now'), datetime('now'))
    `);

    // 3. Mock active Gmail observer server
    let mockGmailServer = null;
    const testGmailPort = 6189;
    process.env.GMAIL_OBSERVER_PORT = String(testGmailPort);
    try {
      mockGmailServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'UP', isRunning: true, isPolling: true, isLoggedIn: true }));
      });
      await new Promise((resolve, reject) => {
        mockGmailServer.once('error', reject);
        mockGmailServer.listen(testGmailPort, () => resolve());
      });
    } catch (e) {
      console.warn('Could not start mock Gmail server:', e.message);
    }

    try {
      const healthRes = await request('/api/v1/checkout/server-health');
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.body.status, 'WORKING');
      assert.equal(healthRes.body.label, 'Server Is Working');
      assert.equal(healthRes.body.isWorking, true);
      assert.ok(healthRes.body.reason.includes('All observers active'));
      assert.equal(healthRes.body.warning, null);
    } finally {
      if (mockGmailServer) {
        await new Promise(r => mockGmailServer.close(r));
      }
      delete process.env.GMAIL_OBSERVER_PORT;
    }
  });

  test('Dev settings: False narrative switch enables 10-minute override and forces WORKING status', async () => {
    // Ensure no android devices or active gmail observers (so live status would be ISSUES)
    testDb.execute('DELETE FROM android_devices');
    const merchant = testDb.queryOne(`SELECT branding FROM merchants WHERE id = '00000000-0000-0000-0000-000000000001'`);
    const branding = JSON.parse(merchant?.branding || '{}');
    delete branding.gmailConfig;
    testDb.execute(`UPDATE merchants SET branding = ? WHERE id = '00000000-0000-0000-0000-000000000001'`, [JSON.stringify(branding)]);

    // 1. Enable false narrative via admin dev API
    const enableRes = await request('/api/v1/admin/dev/false-narrative', {
      method: 'POST',
      body: { enabled: true }
    });
    assert.equal(enableRes.status, 200);
    assert.equal(enableRes.body.enabled, true);
    assert.ok(enableRes.body.falseNarrativeUntil > Date.now());
    assert.ok(enableRes.body.remainingSeconds > 590 && enableRes.body.remainingSeconds <= 600);

    // 2. Query server health - must report WORKING and no downtime warning
    const healthRes = await request('/api/v1/checkout/server-health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.status, 'WORKING');
    assert.equal(healthRes.body.label, 'Server Is Working');
    assert.equal(healthRes.body.isWorking, true);
    assert.equal(healthRes.body.warning, null);
    assert.equal(healthRes.body.isFalseNarrative, true);
    assert.ok(healthRes.body.falseNarrativeRemainingSeconds > 0);
  });

  test('Dev settings: False narrative automatically expires after 10 minutes and reverts to live status', async () => {
    // Set falseNarrativeUntil in the past (simulating 10 minutes elapsed)
    const merchant = testDb.queryOne(`SELECT branding FROM merchants WHERE id = '00000000-0000-0000-0000-000000000001'`);
    const branding = JSON.parse(merchant?.branding || '{}');
    branding.falseNarrativeUntil = Date.now() - 5000; // Expired 5 seconds ago
    testDb.execute(`UPDATE merchants SET branding = ? WHERE id = '00000000-0000-0000-0000-000000000001'`, [JSON.stringify(branding)]);

    // Query admin status - must report disabled
    const adminRes = await request('/api/v1/admin/dev/false-narrative');
    assert.equal(adminRes.status, 200);
    assert.equal(adminRes.body.enabled, false);
    assert.equal(adminRes.body.remainingSeconds, 0);

    // Query server health - must automatically revert to live observer status (ISSUES)
    const healthRes = await request('/api/v1/checkout/server-health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.status, 'ISSUES');
    assert.equal(healthRes.body.label, 'Server Facing Issues');
    assert.equal(healthRes.body.isWorking, false);
    assert.ok(healthRes.body.warning.includes('not recommended to pay by UPI'));
  });

  test('Dev settings: Disabling false narrative explicitly immediately reverts to live status', async () => {
    // 1. Enable
    await request('/api/v1/admin/dev/false-narrative', {
      method: 'POST',
      body: { enabled: true }
    });

    // 2. Disable
    const disableRes = await request('/api/v1/admin/dev/false-narrative', {
      method: 'POST',
      body: { enabled: false }
    });
    assert.equal(disableRes.status, 200);
    assert.equal(disableRes.body.enabled, false);
    assert.equal(disableRes.body.falseNarrativeUntil, null);

    // 3. Health check reverts to live status
    const healthRes = await request('/api/v1/checkout/server-health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.status, 'ISSUES');
    assert.equal(healthRes.body.isWorking, false);
  });
});

