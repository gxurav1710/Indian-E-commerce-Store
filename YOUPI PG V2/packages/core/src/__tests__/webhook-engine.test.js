import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Database, runMigrations, MerchantRepository, PaymentSessionRepository } from '@youpi/db';
import { WebhookEngine } from '../webhook-engine.js';
import { verifyHmac } from '@youpi/common';

describe('Webhook Engine Integration Tests', () => {
  let db;
  let merchantRepo;
  let sessionRepo;
  let webhookEngine;
  let receiverServer;
  let receiverPort;
  let receivedWebhooks = [];
  let shouldReceiverFail = false;

  before(async () => {
    db = new Database({ inMemory: true });
    runMigrations(db);
    merchantRepo = new MerchantRepository(db);
    sessionRepo = new PaymentSessionRepository(db);

    webhookEngine = new WebhookEngine({
      db,
      merchantRepo,
      maxRetries: 3
    });

    // Start a mock merchant webhook receiver HTTP server
    receiverServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        receivedWebhooks.push({
          headers: req.headers,
          body: JSON.parse(body || '{}')
        });

        if (shouldReceiverFail) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Merchant Error');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        }
      });
    });

    await new Promise(resolve => {
      receiverServer.listen(0, () => {
        receiverPort = receiverServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(cb => receiverServer.close(cb));
    db.close();
  });

  test('successfully dispatches HMAC-SHA256 signed webhook on payment event', async () => {
    const merchant = merchantRepo.create({
      businessName: 'Webhook Test Store',
      slug: 'webhook-store',
      contactEmail: 'store@example.com',
      contactPhone: '9876543210',
      webhookUrl: `http://localhost:${receiverPort}/webhook`,
      webhookSecret: 'test_secret_for_merchant_signatures_123'
    });

    const session = sessionRepo.create({
      merchantId: merchant.id,
      orderId: 'HOOK-ORD-001',
      amountPaise: 20000n
    });

    receivedWebhooks = [];
    shouldReceiverFail = false;

    const result = await webhookEngine.dispatch('SUCCESS', session);

    assert.equal(result.delivered, true);
    assert.equal(result.status, 200);
    assert.ok(result.deliveryId);

    // Verify received payload & signature
    assert.equal(receivedWebhooks.length, 1);
    const hook = receivedWebhooks[0];

    assert.equal(hook.headers['x-gateway-event'], 'SUCCESS');
    assert.ok(hook.headers['x-gateway-signature'].startsWith('sha256='));
    assert.equal(hook.headers['x-gateway-delivery-id'], result.deliveryId);

    assert.equal(hook.body.event, 'SUCCESS');
    assert.equal(hook.body.orderId, 'HOOK-ORD-001');
    assert.equal(hook.body.amount, '200.00');
    assert.equal(hook.body.amountPaise, 20000);

    // Cryptographically verify signature using merchant webhookSecret
    const rawSig = hook.headers['x-gateway-signature'].replace('sha256=', '');
    const isValid = verifyHmac(JSON.stringify(hook.body), merchant.webhookSecret, rawSig);
    assert.equal(isValid, true);

    // Verify recorded in DB as successful
    const delivery = db.queryOne('SELECT * FROM webhook_deliveries WHERE id = ?', [result.deliveryId]);
    assert.ok(delivery);
    assert.equal(delivery.is_successful, 1);
    assert.equal(delivery.response_status, 200);
  });

  test('records failure and supports retry on merchant HTTP 500 error', async () => {
    const merchant = merchantRepo.create({
      businessName: 'Failing Store',
      slug: 'failing-store',
      contactEmail: 'fail@example.com',
      contactPhone: '9876543210',
      webhookUrl: `http://localhost:${receiverPort}/webhook-fail`,
      webhookSecret: 'secret_abc_123'
    });

    const session = sessionRepo.create({
      merchantId: merchant.id,
      orderId: 'HOOK-ORD-FAIL',
      amountPaise: 50000n
    });

    shouldReceiverFail = true;
    const result = await webhookEngine.dispatch('FAILED', session);

    assert.equal(result.delivered, false);
    assert.equal(result.status, 500);

    // Verify recorded as failed with next_retry_at set
    const delivery = db.queryOne('SELECT * FROM webhook_deliveries WHERE id = ?', [result.deliveryId]);
    assert.equal(delivery.is_successful, 0);
    assert.equal(delivery.attempt_count, 1);
    assert.ok(delivery.next_retry_at);

    // Now make receiver healthy and simulate retry worker
    shouldReceiverFail = false;
    const pastIso = new Date(Date.now() - 60000).toISOString();
    db.execute('UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?', [pastIso, result.deliveryId]);

    const retryResults = await webhookEngine.retryPending();
    assert.equal(retryResults.length, 1);
    assert.equal(retryResults[0].success, true);
    assert.equal(retryResults[0].attempt, 2);

    const updatedDelivery = db.queryOne('SELECT * FROM webhook_deliveries WHERE id = ?', [result.deliveryId]);
    assert.equal(updatedDelivery.is_successful, 1);
  });
});
