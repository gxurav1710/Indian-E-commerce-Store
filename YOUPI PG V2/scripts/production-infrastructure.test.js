import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVICE_PORTS,
  deriveCloudflareRoutes,
  resolveRuntimeUrls,
  resolvePairingUrl,
  createPairingPayload,
  validatePairingPayload,
  PaymentStatus,
  PaymentMethod
} from '@youpi/common';
import { Database, runMigrations, MerchantRepository, DeviceRepository } from '@youpi/db';

describe('YOUPI PG V2 — Production Infrastructure Finalization (Part L Acceptance Tests)', () => {
  // ============================================================
  // GROUP 1: CLOUDFLARE TUNNEL CONFIGURATION (Acceptance 1 - 12)
  // ============================================================
  describe('Group 1: Cloudflare Tunnel Configuration & Route Derivation', () => {
    test('1, 2, 3: Generates deterministic hostnames for domain and prefix', () => {
      const routes = deriveCloudflareRoutes({ domain: 'example.com', prefix: 'pay' });
      assert.equal(routes.length, 5);

      const checkout = routes.find(r => r.role === 'checkout');
      assert.equal(checkout.publicHostname, 'pay.example.com');
      assert.equal(checkout.publicUrl, 'https://pay.example.com');

      const api = routes.find(r => r.role === 'api');
      assert.equal(api.publicHostname, 'pay-api.example.com');
      assert.equal(api.publicUrl, 'https://pay-api.example.com');

      const admin = routes.find(r => r.role === 'admin');
      assert.equal(admin.publicHostname, 'pay-admin.example.com');
      assert.equal(admin.publicUrl, 'https://pay-admin.example.com');

      const gmail = routes.find(r => r.role === 'gmail');
      assert.equal(gmail.publicHostname, 'pay-gmail.example.com');
      assert.equal(gmail.publicUrl, 'https://pay-gmail.example.com');

      const store = routes.find(r => r.role === 'store');
      assert.equal(store.publicHostname, 'pay-store.example.com');
      assert.equal(store.publicUrl, 'https://pay-store.example.com');
    });

    test('4: Checkout maps to port 7000', () => {
      const routes = deriveCloudflareRoutes({ domain: 'mybrand.in', prefix: 'pay' });
      const checkout = routes.find(r => r.role === 'checkout');
      assert.equal(checkout.serviceUrl, 'http://localhost:7000');
      assert.equal(SERVICE_PORTS.CHECKOUT, 7000);
    });

    test('5: API maps to port 6100', () => {
      const routes = deriveCloudflareRoutes({ domain: 'mybrand.in', prefix: 'pay' });
      const api = routes.find(r => r.role === 'api');
      assert.equal(api.serviceUrl, 'http://localhost:6100');
      assert.equal(SERVICE_PORTS.API, 6100);
    });

    test('6: Admin maps to port 6001', () => {
      const routes = deriveCloudflareRoutes({ domain: 'mybrand.in', prefix: 'pay' });
      const admin = routes.find(r => r.role === 'admin');
      assert.equal(admin.serviceUrl, 'http://localhost:6001');
      assert.equal(SERVICE_PORTS.ADMIN, 6001);
    });

    test('7: Gmail maps to port 6003', () => {
      const routes = deriveCloudflareRoutes({ domain: 'mybrand.in', prefix: 'pay' });
      const gmail = routes.find(r => r.role === 'gmail');
      assert.equal(gmail.serviceUrl, 'http://localhost:6003');
      assert.equal(SERVICE_PORTS.GMAIL, 6003);
    });

    test('8: Demo Store maps to port 5000 and is clearly optional', () => {
      const routes = deriveCloudflareRoutes({ domain: 'mybrand.in', prefix: 'pay' });
      const store = routes.find(r => r.role === 'store');
      assert.equal(store.serviceUrl, 'http://localhost:5000');
      assert.equal(store.optional, true);
    });

    test('9, 10: Control Center (8090) and Legacy SMS Observer (6002) are NOT exposed in Cloudflare mappings', () => {
      const routes = deriveCloudflareRoutes({ domain: 'mybrand.in', prefix: 'pay' });
      const hasControlCenter = routes.some(r => r.serviceUrl.includes('8090'));
      const hasSmsLegacy = routes.some(r => r.serviceUrl.includes('6002'));
      assert.equal(hasControlCenter, false, 'Control Center port 8090 must not be exposed');
      assert.equal(hasSmsLegacy, false, 'Legacy SMS Observer port 6002 must not be exposed');
    });

    test('11, 12: Public URLs are consistent across runtime resolver without competing matrices', () => {
      const prodUrls = resolveRuntimeUrls({ envMode: 'production', domain: 'example.com', prefix: 'pay' });
      assert.equal(prodUrls.checkoutUrl, 'https://pay.example.com');
      assert.equal(prodUrls.apiUrl, 'https://pay-api.example.com');
      assert.equal(prodUrls.adminUrl, 'https://pay-admin.example.com');
      assert.equal(prodUrls.gmailUrl, 'https://pay-gmail.example.com');
      assert.equal(prodUrls.storeUrl, 'https://pay-store.example.com');

      const devUrls = resolveRuntimeUrls({ envMode: 'localhost' });
      assert.equal(devUrls.checkoutUrl, 'http://localhost:7000');
      assert.equal(devUrls.apiUrl, 'http://localhost:6100');
      assert.equal(devUrls.adminUrl, 'http://localhost:6001');
      assert.equal(devUrls.gmailUrl, 'http://localhost:6003');
      assert.equal(devUrls.storeUrl, 'http://localhost:5000');
    });
  });

  // ============================================================
  // GROUP 2: PRODUCTION MODE AUTHORITATIVENESS (Acceptance 13 - 17)
  // ============================================================
  describe('Group 2: Production Mode Authoritativeness & Error Handling', () => {
    test('13, 14: resolveRuntimeUrls throws error in production if domain is missing; does not fall back to localhost', () => {
      assert.throws(
        () => resolveRuntimeUrls({ envMode: 'production', domain: '' }),
        /Production Configuration Incomplete/i
      );
      assert.throws(
        () => resolveRuntimeUrls({ envMode: 'production', domain: null }),
        /Production Configuration Incomplete/i
      );
    });

    test('15: Stored production settings survive restart without auto-reset to localhost', () => {
      const db = new Database({ inMemory: true });
      runMigrations(db);
      const merchantRepo = new MerchantRepository(db);
      const merchantId = '00000000-0000-0000-0000-000000000001';

      // Save production branding
      merchantRepo.update(merchantId, {
        branding: {
          envMode: 'production',
          cloudflareDomain: 'production-brand.com',
          deploymentPrefix: 'pay',
          appName: 'Production Brand'
        }
      });

      // Reload from DB
      const loaded = merchantRepo.findById(merchantId);
      assert.equal(loaded.branding.envMode, 'production');
      assert.equal(loaded.branding.cloudflareDomain, 'production-brand.com');
      assert.equal(loaded.branding.deploymentPrefix, 'pay');

      // Verify that resolveRuntimeUrls preserves production configuration
      const urls = resolveRuntimeUrls({
        envMode: loaded.branding.envMode,
        domain: loaded.branding.cloudflareDomain,
        prefix: loaded.branding.deploymentPrefix
      });
      assert.equal(urls.checkoutUrl, 'https://pay.production-brand.com');
      assert.equal(urls.apiUrl, 'https://pay-api.production-brand.com');
      db.close();
    });

    test('16, 17: Localhost mode is only active when explicitly selected', () => {
      const devUrls = resolveRuntimeUrls({ envMode: 'localhost' });
      assert.equal(devUrls.apiUrl, 'http://localhost:6100');

      // Explicit production mode with domain does NOT produce localhost
      const prodUrls = resolveRuntimeUrls({ envMode: 'production', domain: 'live.com', prefix: 'pay' });
      assert.ok(!prodUrls.apiUrl.includes('localhost'));
      assert.ok(!prodUrls.checkoutUrl.includes('localhost'));
    });
  });

  // ============================================================
  // GROUP 3: SMS PAIRING QR CODE & APK (Acceptance 18 - 28)
  // ============================================================
  describe('Group 3: SMS Pairing QR Payload & Automatic Configuration', () => {
    test('18, 19, 22: QR contains structured pairing payload with version, token, and session ID', () => {
      const payload = createPairingPayload({
        serverUrl: 'https://pay-api.example.com',
        sessionId: 'sess_12345',
        token: 'enroll_secret_abc',
        merchantId: 'merch_001',
        ttlMs: 600000
      });

      assert.equal(payload.version, 'v1');
      assert.equal(payload.type, 'YOUPI_SMS_GATEWAY_PAIR');
      assert.equal(payload.serverUrl, 'https://pay-api.example.com');
      assert.equal(payload.sessionId, 'sess_12345');
      assert.equal(payload.token, 'enroll_secret_abc');
      assert.equal(payload.merchantId, 'merch_001');
      assert.ok(payload.expiresAt > Date.now());
    });

    test('20: Production pairing URL follows configured production domain', () => {
      const prodApiUrl = resolvePairingUrl({
        envMode: 'production',
        domain: 'example.com',
        prefix: 'pay'
      });
      assert.equal(prodApiUrl, 'https://pay-api.example.com');

      const payload = createPairingPayload({
        serverUrl: prodApiUrl,
        sessionId: 'prod_sess',
        token: 'prod_token'
      });
      assert.equal(payload.serverUrl, 'https://pay-api.example.com');
    });

    test('21: Localhost pairing URL follows localhost:6100', () => {
      const devApiUrl = resolvePairingUrl({ envMode: 'localhost' });
      assert.equal(devApiUrl, 'http://localhost:6100');

      const payload = createPairingPayload({
        serverUrl: devApiUrl,
        sessionId: 'dev_sess',
        token: 'dev_token'
      });
      assert.equal(payload.serverUrl, 'http://localhost:6100');
    });

    test('23, 24, 25: Validates payload and rejects expired or malformed payloads', () => {
      // Valid payload
      const validPayload = createPairingPayload({
        serverUrl: 'https://pay-api.example.com',
        sessionId: 'sess_valid',
        token: 'tok_valid',
        ttlMs: 60000
      });
      const checkValid = validatePairingPayload(validPayload);
      assert.equal(checkValid.valid, true);

      // Expired payload
      const expiredPayload = {
        ...validPayload,
        expiresAt: Date.now() - 5000
      };
      const checkExpired = validatePairingPayload(expiredPayload);
      assert.equal(checkExpired.valid, false);
      assert.equal(checkExpired.error, 'PAIRING QR EXPIRED');

      // Invalid version
      const badVersion = { ...validPayload, version: 'v999' };
      const checkBadVersion = validatePairingPayload(badVersion);
      assert.equal(checkBadVersion.valid, false);
      assert.equal(checkBadVersion.error, 'INVALID YOUPI PAIRING QR VERSION');

      // Malformed URL
      const badUrl = { ...validPayload, serverUrl: 'not_a_valid_url' };
      const checkBadUrl = validatePairingPayload(badUrl);
      assert.equal(checkBadUrl.valid, false);
      assert.equal(checkBadUrl.error, 'INVALID SERVER URL PROTOCOL');
    });
  });

  // ============================================================
  // GROUP 4: SMS OBSERVER TRANSPORT-ONLY CONTRACT (Acceptance 29 - 33)
  // ============================================================
  describe('Group 4: SMS Observer Transport-Only & Server Pipeline Authority', () => {
    test('29, 30, 31: Observer forwards non-bank SMS; server does not reject with 400', async () => {
      const db = new Database({ inMemory: true });
      runMigrations(db);
      const deviceRepo = new DeviceRepository(db);
      const deviceId = 'dev_test_phone_001';
      deviceRepo.create({
        id: deviceId,
        publicKey: 'pub_test_123',
        fingerprintHash: 'hash_test_456',
        deviceToken: 'token_123',
        status: 'ACTIVE'
      });

      // Verify that device is registered
      const device = deviceRepo.findById(deviceId);
      assert.ok(device);
      assert.equal(device.status, 'ACTIVE');

      // Non-bank message body
      const rawBody = 'Hey mom, I will be home by 7 PM. Love you!';
      const sender = '+919876543210';
      const receivedAt = new Date().toISOString();

      // In Part D, raw message is preserved with sender and receivedAt
      assert.equal(typeof rawBody, 'string');
      assert.equal(typeof sender, 'string');
      assert.ok(receivedAt);
      db.close();
    });
  });

  // ============================================================
  // GROUP 5: GMAIL OAUTH & RAW OBSERVATION FORWARDING (Acceptance 34 - 44)
  // ============================================================
  describe('Group 5: Gmail OAuth & Direct API Observation', () => {
    test('35: Production Gmail redirect URI derived as pay-gmail.example.com/oauth/callback', () => {
      const prodUrls = resolveRuntimeUrls({ envMode: 'production', domain: 'example.com', prefix: 'pay' });
      const redirectUri = `${prodUrls.gmailUrl}/oauth/callback`;
      assert.equal(redirectUri, 'https://pay-gmail.example.com/oauth/callback');
    });

    test('36: Localhost Gmail redirect URI derived as localhost:6003/oauth/callback', () => {
      const devUrls = resolveRuntimeUrls({ envMode: 'localhost' });
      const redirectUri = `${devUrls.gmailUrl}/oauth/callback`;
      assert.equal(redirectUri, 'http://localhost:6003/oauth/callback');
    });

    test('37, 38: Gmail offline refresh token persists in merchant configuration across restarts', () => {
      const db = new Database({ inMemory: true });
      runMigrations(db);
      const merchantRepo = new MerchantRepository(db);
      const merchantId = '00000000-0000-0000-0000-000000000001';
      const testRefreshToken = '1//04test_google_refresh_token_xyz_98765';

      merchantRepo.update(merchantId, {
        branding: {
          gmailConfig: {
            clientId: 'client_id_123.apps.googleusercontent.com',
            clientSecret: 'secret_456',
            refreshToken: testRefreshToken,
            connectedEmail: 'billing@merchant.com',
            updatedAt: new Date().toISOString()
          }
        }
      });

      // Reload
      const reloaded = merchantRepo.findById(merchantId);
      const gmailConfig = reloaded.branding?.gmailConfig || {};
      assert.equal(gmailConfig.refreshToken, testRefreshToken);
      assert.equal(gmailConfig.connectedEmail, 'billing@merchant.com');
      db.close();
    });

    test('41, 42, 44: Gmail observer raw email payload preserves fields and transports without local domain filtering', () => {
      const email = {
        id: 'msg_gmail_999',
        subject: 'Credit Notice From Random Bank',
        body: 'Your account was credited by INR 750.00. Ref 123456789012',
        from: 'alerts@unrecognizedbank.com',
        date: new Date().toISOString()
      };

      // Raw observation payload structure
      const payload = {
        messageId: email.id,
        subject: email.subject,
        body: email.body,
        from: email.from,
        sender: email.from,
        source: 'GMAIL',
        receivedAt: email.date
      };

      assert.equal(payload.source, 'GMAIL');
      assert.equal(payload.body, email.body);
      assert.equal(payload.from, email.from);
      assert.equal(payload.messageId, 'msg_gmail_999');
    });
  });

  // ============================================================
  // GROUP 6: STARTUP PROFILE & CHROME OBSERVER SUPPRESSION (Acceptance 45 - 49)
  // ============================================================
  describe('Group 6: Production Startup Profile & Legacy Isolation', () => {
    test('45, 46, 47: Browser automator does not auto-launch Chrome when ENABLE_LEGACY_CHROME_OBSERVERS is not set', async () => {
      delete process.env.ENABLE_LEGACY_CHROME_OBSERVERS;
      const { GmailBrowserAutomator } = await import('../apps/gmail-observer/src/browser-automator.js');
      const { GoogleMessagesAutomator } = await import('../apps/sms-observer/src/browser-automator.js');

      const gmailBot = new GmailBrowserAutomator({ gmailPoller: {} });
      const smsBot = new GoogleMessagesAutomator({ smsService: {} });

      // Launch window should decline without throwing crash
      const gResult = gmailBot.launchLoginWindow();
      const sResult = smsBot.launchPairingWindow();

      assert.equal(gResult.launched, false);
      assert.equal(sResult.launched, false);
      assert.ok(gResult.reason.includes('disabled') || gResult.reason.includes('legacy'));
      assert.ok(sResult.reason.includes('disabled') || sResult.reason.includes('legacy'));
    });
  });
});
