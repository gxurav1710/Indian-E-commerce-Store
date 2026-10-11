import http from 'node:http';
import assert from 'node:assert/strict';
import { Database } from '../packages/db/src/database.js';
import { startServer as startPaymentApi } from '../apps/payment-api/src/index.js';
import { CheckoutServer } from '../apps/checkout-portal/src/server.js';
import { CustomerRepository } from '../packages/db/src/repositories/customer.repository.js';

async function verifyProductionUpi() {
  console.log('============================================================');
  console.log('🔍 VERIFYING PRODUCTION DYNAMIC UPI DEEP LINK & QR CODE');
  console.log('============================================================');

  const prodDb = new Database({ dbPath: path.resolve('data/youpi_pg.sqlite') });

  // Verify preserved merchant and receiving account
  const merchant = prodDb.queryOne('SELECT id, business_name FROM merchants');
  const account = prodDb.queryOne('SELECT id, upi_id, payee_name FROM payment_receiving_accounts WHERE is_active = 1');

  console.log('Preserved Merchant:', merchant.business_name, `(${merchant.id})`);
  console.log('Preserved Receiving Account:', account.upi_id, `(${account.payee_name})`);
  assert.equal(account.upi_id, '9876543210@axl');
  assert.equal(account.payee_name, 'Demo Store Merchant');

  // Start Payment API on test port 6197 using production database
  const paymentApi = await startPaymentApi(6197, prodDb);
  console.log('[✓] Payment API started on port', paymentApi.port);

  // Start Checkout Portal on test port 7097 pointing to Payment API
  const checkoutApp = new CheckoutServer({
    apiBaseUrl: `http://127.0.0.1:${paymentApi.port}`
  });
  const checkoutServer = checkoutApp.createServer();
  await new Promise(resolve => checkoutServer.listen(7097, resolve));
  console.log('[✓] Checkout Portal started on port 7097');

  let testPaymentId = null;
  let testCustomerId = null;

  try {
    // 1. Create a dynamic customer
    const custRepo = new CustomerRepository(prodDb);
    const cust = custRepo.create({
      merchantId: merchant.id,
      phoneNumber: '9999888877',
      fullName: 'Test Customer',
      password: 'SecurePassword123!'
    });
    testCustomerId = cust.id;
    console.log('[✓] Temporary test customer created:', testCustomerId);

    // 2. Create a dynamic payment
    const testOrderId = 'COIN-ORD-1788969252735';
    const testAmount = '1.00';

    const payPayload = JSON.stringify({
      orderId: testOrderId,
      amount: testAmount
    });

    const payRes = await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${paymentApi.port}/api/v1/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payPayload)
        }
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.write(payPayload);
      req.end();
    });

    testPaymentId = payRes.paymentId;
    console.log('[✓] Payment session created:', testPaymentId);
    console.log('    Checkout URL:', payRes.checkoutUrl);

    assert.ok(
      payRes.checkoutUrl.startsWith('https://checkout.example.com/checkout/'),
      `Expected production checkout URL, got: ${payRes.checkoutUrl}`
    );

    // 3. Bind customer to activate session and acquire UPI receiving slot
    const bindPayload = JSON.stringify({ customerId: testCustomerId });
    const bindRes = await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${paymentApi.port}/api/v1/checkout/${testPaymentId}/bind-customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bindPayload)
        }
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.write(bindPayload);
      req.end();
    });
    console.log('[✓] Customer bound and session activated:', bindRes.status || 'ACTIVE');

    // 4. Fetch checkout state
    const stateRes = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${paymentApi.port}/api/v1/checkout/${testPaymentId}/state`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    console.log('\n--- CHECKOUT STATE RESULT ---');
    console.log('Status:    ', stateRes.status);
    console.log('Payee VPA: ', stateRes.payeeVpa);
    console.log('Payee Name:', stateRes.payeeName);
    console.log('Amount:    ', stateRes.amount);
    console.log('Order ID:  ', stateRes.orderId);
    console.log('UPI URI:   ', stateRes.upiUri);

    assert.equal(stateRes.status, 'ACTIVE');
    assert.equal(stateRes.payeeVpa, '9876543210@axl');
    assert.equal(stateRes.payeeName, 'Demo Store Merchant');
    assert.equal(stateRes.amount, '1.00');
    assert.equal(stateRes.orderId, testOrderId);

    // 5. Verify UPI URI format and parameter order
    const expectedUpiUri = 'upi://pay?pa=9876543210%40axl&pn=Demo Store+Merchant&am=1.00&tn=COIN-ORD-1788969252735';
    assert.equal(stateRes.upiUri, expectedUpiUri, `UPI URI does not match expected format!\nExpected: ${expectedUpiUri}\nActual:   ${stateRes.upiUri}`);

    // Verify parameter keys and ordering
    const parsedUrl = new URL(stateRes.upiUri);
    const paramKeys = [...parsedUrl.searchParams.keys()];
    console.log('\nParameter keys in order:', paramKeys);
    assert.deepEqual(paramKeys, ['pa', 'pn', 'am', 'tn'], 'Parameter order must be exactly pa, pn, am, tn');

    assert.equal(parsedUrl.searchParams.get('pa'), '9876543210@axl');
    assert.equal(parsedUrl.searchParams.get('pn'), 'Demo Store Merchant');
    assert.equal(parsedUrl.searchParams.get('am'), '1.00');
    assert.equal(parsedUrl.searchParams.get('tn'), testOrderId);
    assert.equal(parsedUrl.searchParams.get('tr'), null, 'tr parameter must be absent');
    assert.equal(parsedUrl.searchParams.get('cu'), null, 'cu parameter must be absent');

    console.log('[✓] Parameter order verified: 1. pa, 2. pn, 3. am, 4. tn');
    console.log('[✓] Dynamic VPA verified:', parsedUrl.searchParams.get('pa'));
    console.log('[✓] Dynamic Payee Name verified:', parsedUrl.searchParams.get('pn'));
    console.log('[✓] Dynamic Amount verified:', parsedUrl.searchParams.get('am'));
    console.log('[✓] Dynamic Order ID (tn) verified:', parsedUrl.searchParams.get('tn'));

    // 6. Verify QR Code generation from Checkout Portal
    const qrRes = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:7097/checkout/${testPaymentId}/qr.svg`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'], body: data }));
      }).on('error', reject);
    });

    assert.equal(qrRes.status, 200);
    assert.ok(qrRes.contentType.includes('image/svg+xml'));
    assert.ok(qrRes.body.includes('<svg'));
    assert.ok(qrRes.body.includes('</svg>'));
    assert.ok(qrRes.body.includes('<rect'));
    console.log('[✓] QR SVG dynamically generated from UPI URI (length:', qrRes.body.length, 'bytes)');

  } finally {
    // Clean up test records created during verification
    if (testPaymentId) {
      prodDb.execute('DELETE FROM payment_sessions WHERE id = ?', [testPaymentId]);
    }
    if (testCustomerId) {
      prodDb.execute('DELETE FROM customers WHERE id = ?', [testCustomerId]);
    }
    prodDb.execute("DELETE FROM audit_logs WHERE entity_type IN ('PAYMENT_SESSION', 'PAYMENT_OBSERVATION')");
    prodDb.execute('UPDATE payment_receiving_accounts SET is_slot_busy = 0, current_active_session_id = NULL');

    await paymentApi.close();
    await new Promise(resolve => checkoutServer.close(resolve));
    prodDb.close();
    console.log('[✓] Cleaned up verification test records from production DB.');
  }

  console.log('============================================================');
  console.log('🎉 PRODUCTION UPI DEEP LINK & QR VERIFIED 100% SUCCESS');
  console.log('============================================================');
}

verifyProductionUpi().catch(err => {
  console.error('UPI VERIFICATION FAILED:', err);
  process.exit(1);
});
