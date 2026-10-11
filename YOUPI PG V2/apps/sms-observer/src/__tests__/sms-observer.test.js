import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Database } from '@youpi/db';
import { startServer as startPaymentApi } from '../../../payment-api/src/index.js';
import { startSmsObserver } from '../index.js';
import { BankSmsParser } from '../sms-parser.js';
import { PaymentStatus } from '@youpi/common';

describe('Google Messages / SMS Payment Observer Integration Tests', () => {
  let apiInstance;
  let smsInstance;
  let smsBaseUrl;
  let testDb;

  before(async () => {
    testDb = new Database({ inMemory: true });
    apiInstance = await startPaymentApi(6196, testDb);
    smsInstance = await startSmsObserver(6098, {
      apiBaseUrl: `http://localhost:${apiInstance.port}`,
      receivingAccountId: '00000000-0000-0000-0000-000000000002'
    });
    smsBaseUrl = `http://localhost:${smsInstance.port}`;
  });

  after(async () => {
    await smsInstance.close();
    await apiInstance.close();
    testDb.close();
  });

  function get(path) {
    return new Promise((resolve, reject) => {
      http.get(`${smsBaseUrl}${path}`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, text: data });
        });
      }).on('error', reject);
    });
  }

  describe('Bank SMS Parser', () => {
    test('correctly parses credit SMS with amount, UTR, and sender VPA', () => {
      const sms = {
        text: 'Dear SBI user, A/C 1234 credited by Rs 499.00 on 08Sep26 by UPI/CR/667788/buyer@okhdfcbank Ref: 667788.',
        sender: 'VK-SBIUPI'
      };

      const parsed = BankSmsParser.parse(sms);
      assert.ok(parsed);
      assert.equal(parsed.amountPaise, 49900n);
      assert.equal(parsed.amount, '499.00');
      assert.equal(parsed.bankReferenceNumber, '667788');
      assert.equal(parsed.senderVpa, 'buyer@okhdfcbank');
    });

    test('ignores debit SMS alerts', () => {
      const debitSms = {
        text: 'Your a/c 1234 debited by Rs 250.00 at Grocery Store.',
        sender: 'VK-HDFCBK'
      };

      const parsed = BankSmsParser.parse(debitSms);
      assert.equal(parsed, null);
    });
  });

  describe('SMS Observer HTTP Service & Attribution', () => {
    test('GET /health returns UP', async () => {
      const res = await get('/health');
      assert.equal(res.status, 200);
      const json = JSON.parse(res.text);
      assert.equal(json.status, 'UP');
      assert.equal(json.service, 'sms-observer');
    });

    test('End-to-End: processing bank SMS confirms active payment session in Payment API', async () => {
      // 1. Create a payment in Payment API for ₹499
      const session = apiInstance.app.context.sessionRepo.create({
        merchantId: '00000000-0000-0000-0000-000000000001',
        receivingAccountId: '00000000-0000-0000-0000-000000000002',
        orderId: 'SMS-ORD-499',
        amountPaise: 49900n
      });

      apiInstance.app.context.queueEngine.enqueueOrActivate(session.id, '00000000-0000-0000-0000-000000000002');
      apiInstance.app.context.timingEngine.handlePaymentDone(session.id);

      // 2. Process incoming SMS alert via SMS Observer
      const result = await smsInstance.service.processSms({
        text: 'A/C 1234 credited with Rs. 499.00 on 08-Sep-2026. Ref: UTR-SMS-499 from payer@upi',
        sender: 'VM-ICICIB'
      });

      assert.ok(result);
      assert.equal(result.accepted, true);
      assert.equal(result.attribution.attributed, true);
      assert.equal(result.attribution.paymentSessionId, session.id);
      assert.equal(result.attribution.outcomeStatus, PaymentStatus.SUCCESS);

      // 3. Verify session in DB updated to SUCCESS
      const updated = apiInstance.app.context.sessionRepo.findById(session.id);
      assert.equal(updated.status, PaymentStatus.SUCCESS);
    });
  });
});
