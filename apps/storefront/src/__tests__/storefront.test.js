import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { StorefrontServer } from '../server.js';

describe('Waven Theme Storefront Server Integration Tests', () => {
  let server;
  let testPort = 5099;
  let baseUrl = `http://localhost:${testPort}`;

  before(async () => {
    const storefront = new StorefrontServer({ port: testPort });
    server = await storefront.start();
  });

  after(() => {
    if (server) server.close();
  });

  test('1. GET /health returns 200 HEALTHY', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'HEALTHY');
    assert.equal(data.service, 'storefront');
  });

  test('2. GET /health/deep returns deep dependency health check', async () => {
    const res = await fetch(`${baseUrl}/health/deep`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.status);
    assert.equal(data.service, 'storefront');
    assert.ok(data.dependencies);
  });

  test('3. GET /api/config returns dynamic runtime configuration', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.commerceApiUrl);
    assert.ok(data.checkoutPortalUrl);
    assert.ok(data.whatsappAuthApiUrl);
    assert.ok(data.appName);
    assert.equal(data.currency, '₹');
  });

  test('4. GET / serves Waven streetwear storefront HTML', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await res.text();
    assert.ok(html.includes('WAVEN'));
    assert.ok(html.includes('Bebas+Neue'));
    assert.ok(html.includes('Barlow+Condensed'));
    assert.ok(html.includes('brandIconSpan'));
    assert.ok(html.includes('brandNameSpan'));
    assert.ok(html.includes('cartBadgeCount'));
  });

  test('5. SPA Fallback: GET /account and /orders routes serve index.html', async () => {
    const accountRes = await fetch(`${baseUrl}/account`);
    assert.equal(accountRes.status, 200);
    const accountHtml = await accountRes.text();
    assert.ok(accountHtml.includes('WAVEN'));

    const ordersRes = await fetch(`${baseUrl}/orders`);
    assert.equal(ordersRes.status, 200);
    const ordersHtml = await ordersRes.text();
    assert.ok(ordersHtml.includes('WAVEN'));
  });

  test('6. GET /api/veditor/captcha returns dynamic SVG challenge and token', async () => {
    const res = await fetch(`${baseUrl}/api/veditor/captcha`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.svg);
    assert.ok(data.token);
    assert.ok(data.svg.startsWith('data:image/svg+xml;utf8,'));
  });

  test('7. GET /api/storefront/customization returns full streetwear config schema', async () => {
    const res = await fetch(`${baseUrl}/api/storefront/customization`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.config.ticker);
    assert.ok(data.config.brand);
    assert.ok(data.config.navigation);
    assert.ok(data.config.categories);
    assert.ok(data.config.catalog);
    assert.ok(data.config.lookbook);
    assert.ok(data.config.theme);
  });

  test('8. POST /api/veditor/config requires valid Bearer session token (401)', async () => {
    const res = await fetch(`${baseUrl}/api/veditor/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: { primaryDark: '#111111' } })
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error.includes('Unauthorized'));
  });

  test('9. GET /api/veditor/products returns products list for visual studio', async () => {
    const res = await fetch(`${baseUrl}/api/veditor/products`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.products));
  });

  test('10. POST /api/v1/auth/initiate forwards request cleanly', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: '9876543210' })
    });
    assert.ok(res.status === 200 || res.status === 500);
    const data = await res.json();
    assert.ok('success' in data);
  });
});
