import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Database, CustomerRepository, SupportTicketRepository, runMigrations } from '@youpi/db';
import { startHelpServer } from '../index.js';

describe('Customer Payment Help Portal Integration Tests', () => {
  let serverInstance;
  let baseUrl;
  let testDb;
  let customerRepo;
  let ticketRepo;
  let testCustomer;

  before(async () => {
    testDb = new Database({ inMemory: true });
    runMigrations(testDb);
    customerRepo = new CustomerRepository(testDb);
    ticketRepo = new SupportTicketRepository(testDb);

    testCustomer = customerRepo.create({
      merchantId: '00000000-0000-0000-0000-000000000001',
      phoneNumber: '9123491234',
      fullName: 'Customer Test',
      password: 'Password123!'
    });

    ticketRepo.createTicket({
      merchantId: '00000000-0000-0000-0000-000000000001',
      customerId: testCustomer.id,
      subject: 'UPI money debited but page timed out',
      initialMessage: {
        senderType: 'CUSTOMER',
        senderId: testCustomer.id,
        message: 'I made the UPI transfer on 08-Sep.'
      }
    });

    serverInstance = await startHelpServer(3199, { db: testDb });
    baseUrl = `http://localhost:${serverInstance.port}`;
  });

  after(async () => {
    await serverInstance.close();
    testDb.close();
  });

  function get(path) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${path}`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        });
      }).on('error', reject);
    });
  }

  test('GET /health returns UP', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    const json = JSON.parse(res.text);
    assert.equal(json.status, 'UP');
    assert.equal(json.service, 'payment-help');
  });

  test('GET / and GET /support and GET /help display ONLY "Feature not available"', async () => {
    for (const path of ['/', '/support', '/help']) {
      const res = await get(path);
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.text.includes('Feature not available'));
      // Verify old customer help portal elements are completely absent
      assert.equal(res.text.includes('Live Support'), false);
      assert.equal(res.text.includes('Claim Deducted Payment'), false);
      assert.equal(res.text.includes('Customer Sign In'), false);
      assert.equal(res.text.includes('My Transaction'), false);
    }
  });

  test('GET /api/customer/tickets is decommissioned and returns 404', async () => {
    const res = await get(`/api/customer/tickets?customerId=${testCustomer.id}`);
    assert.equal(res.status, 404);
    const body = JSON.parse(res.text);
    assert.equal(body.error, 'Feature not available');
  });
});
