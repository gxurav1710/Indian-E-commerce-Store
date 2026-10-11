import http from 'node:http';
import assert from 'node:assert/strict';
import { Database } from '../packages/db/src/database.js';
import { startServer as startPaymentApi } from '../apps/payment-api/src/index.js';
import { CoinWalletStoreServer } from '../apps/coin-wallet-store/src/server.js';

async function verifyProductionCheckoutUrl() {
  console.log('============================================================');
  console.log('🔍 VERIFYING PRODUCTION CHECKOUT REDIRECT FLOW');
  console.log('============================================================');

  console.log('1. Checking environment variables in process...');
  console.log('   BASE_CHECKOUT_URL =', process.env.BASE_CHECKOUT_URL);
  console.log('   BASE_PAYMENT_API_URL =', process.env.BASE_PAYMENT_API_URL);

  assert.equal(
    process.env.BASE_CHECKOUT_URL,
    'https://checkout.example.com',
    'BASE_CHECKOUT_URL must be https://checkout.example.com'
  );

  // 2. Start Payment API on test port 6198 with in-memory DB
  const testDb = new Database({ inMemory: true });
  const paymentApi = await startPaymentApi(6198, testDb);
  console.log('[✓] Payment API started on port', paymentApi.port);

  // 3. Create a payment session directly on Payment API
  const payPayload = JSON.stringify({
    orderId: 'VERIFY-PROD-ORD-001',
    amount: '250.00'
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

  console.log('2. Payment API response:');
  console.log('   Payment ID:  ', payRes.paymentId);
  console.log('   Status:      ', payRes.status);
  console.log('   Checkout URL:', payRes.checkoutUrl);

  assert.ok(
    payRes.checkoutUrl.startsWith('https://checkout.example.com/checkout/'),
    `Expected checkoutUrl to start with https://checkout.example.com/checkout/, but got: ${payRes.checkoutUrl}`
  );
  console.log('   [✓] Payment API correctly returned production checkout URL!');

  // 4. Start Demo Coin Wallet Store pointing to the Payment API
  const coinStore = new CoinWalletStoreServer({
    gatewayApiUrl: `http://127.0.0.1:${paymentApi.port}`
  });
  const coinServer = coinStore.createServer();
  await new Promise(resolve => coinServer.listen(5098, resolve));
  console.log('[✓] Demo Coin Store started on port 5098');

  // 5. Customer clicks buy coins on Demo Store (POST /api/checkout)
  const storePayload = JSON.stringify({
    price: '100.00',
    coins: 100,
    packName: 'Novice Pack',
    phoneNumber: '9876543210',
    gamerTag: 'GamerOne'
  });

  const storeRes = await new Promise((resolve, reject) => {
    const req = http.request('http://127.0.0.1:5098/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(storePayload),
        'Host': 'demo.example.com',
        'X-Forwarded-Proto': 'https'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(storePayload);
    req.end();
  });

  console.log('3. Demo Coin Store purchase response:');
  console.log('   Order ID:    ', storeRes.orderId);
  console.log('   Payment ID:  ', storeRes.paymentId);
  console.log('   Checkout URL:', storeRes.checkoutUrl);

  assert.ok(
    storeRes.checkoutUrl.startsWith('https://checkout.example.com/checkout/'),
    `Expected Demo Store to return https://checkout.example.com/checkout/, but got: ${storeRes.checkoutUrl}`
  );
  console.log('   [✓] Demo Coin Store checkoutUrl points to https://checkout.example.com/checkout/<id>!');

  // Cleanup
  await paymentApi.close();
  await new Promise(resolve => coinServer.close(resolve));
  testDb.close();

  console.log('============================================================');
  console.log('🎉 PRODUCTION CHECKOUT REDIRECT VERIFICATION PASSED 100%');
  console.log('============================================================');
}

verifyProductionCheckoutUrl().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
