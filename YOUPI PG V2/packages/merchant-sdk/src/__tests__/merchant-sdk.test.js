import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '@youpi/db';
import { startServer as startPaymentApi } from '../../../../apps/payment-api/src/index.js';
import { YoupiPaymentClient } from '../index.js';
import { generateHmac } from '@youpi/common';

describe('Merchant SDK Integration Tests', () => {
  let apiInstance;
  let client;
  let testDb;
  const merchantSecret = 'sdk_test_webhook_secret_9988';

  before(async () => {
    testDb = new Database({ inMemory: true });
    apiInstance = await startPaymentApi(6195, testDb);

    // Update demo merchant with our known secret
    testDb.execute('UPDATE merchants SET webhook_secret = ? WHERE id = ?', [
      merchantSecret,
      '00000000-0000-0000-0000-000000000001'
    ]);

    client = new YoupiPaymentClient({
      apiUrl: `http://localhost:${apiInstance.port}`,
      merchantId: '00000000-0000-0000-0000-000000000001',
      webhookSecret: merchantSecret
    });
  });

  after(async () => {
    await apiInstance.close();
    testDb.close();
  });

  test('creates a payment session using SDK client', async () => {
    const payment = await client.createPayment({
      orderId: 'SDK-ORDER-1001',
      amount: '299.00',
      currency: 'INR',
      returnUrl: 'https://store.example/paid',
      customer: {
        phoneNumber: '9876543210',
        fullName: 'SDK User'
      },
      metadata: { sku: 'PRO-PLAN' }
    });

    assert.ok(payment.paymentId);
    assert.equal(payment.orderId, 'SDK-ORDER-1001');
    assert.equal(payment.amount, '299.00');
    assert.equal(payment.amountPaise, '29900');
    assert.ok(payment.checkoutUrl);
    assert.ok(['INITIATED', 'ACTIVE', 'QUEUED'].includes(payment.status));
  });

  test('queries payment status and details', async () => {
    const created = await client.createPayment({
      orderId: 'SDK-ORDER-1002',
      amount: '150.00'
    });

    const queried = await client.getPayment(created.paymentId);
    assert.equal(queried.paymentId, created.paymentId);
    assert.equal(queried.orderId, 'SDK-ORDER-1002');
    assert.equal(queried.amount, '150.00');
  });

  describe('Webhook Verification', () => {
    test('successfully verifies authentic HMAC-SHA256 webhook payload', () => {
      const payloadObj = {
        event: 'SUCCESS',
        paymentId: 'pay_999',
        orderId: 'ORD-999',
        amount: '200.00',
        amountPaise: 20000,
        currency: 'INR'
      };
      const rawString = JSON.stringify(payloadObj);
      const signature = generateHmac(rawString, merchantSecret);
      const signatureHeader = `sha256=${signature}`;

      const verified = client.verifyWebhook(rawString, signatureHeader);
      assert.equal(verified.event, 'SUCCESS');
      assert.equal(verified.paymentId, 'pay_999');
      assert.equal(verified.amount, '200.00');
    });

    test('rejects tampered webhook payload or incorrect secret', () => {
      const payloadObj = { event: 'SUCCESS', amount: '200.00' };
      const rawString = JSON.stringify(payloadObj);
      const signature = generateHmac(rawString, merchantSecret);
      const signatureHeader = `sha256=${signature}`;

      // Tampered payload
      const tamperedString = JSON.stringify({ event: 'SUCCESS', amount: '500.00' });
      assert.throws(
        () => client.verifyWebhook(tamperedString, signatureHeader),
        /signature mismatch/
      );

      // Wrong secret
      assert.throws(
        () => client.verifyWebhook(rawString, signatureHeader, 'wrong_secret_key'),
        /signature mismatch/
      );
    });

    test('rejects malformed signature header', () => {
      const rawString = JSON.stringify({ ok: true });
      assert.throws(
        () => client.verifyWebhook(rawString, 'invalid_header_no_sha_prefix'),
        /invalid signature header format/
      );
    });
  });
});
