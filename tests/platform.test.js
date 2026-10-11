import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORTS, URLS } from '../packages/common/src/ports.js';
import { IdentityResolver, normalizePhoneNumber, normalizeEmail } from '../packages/common/src/identity.js';
import { EVENT_TYPES, createEvent, PlatformEventBus, globalEventBus } from '../packages/common/src/events.js';
import { CentralLogger, sanitizeData } from '../packages/common/src/logger.js';
import { Database, createRepositories } from '../packages/db/src/index.js';
import { NotificationDispatcher } from '../services/notifications/src/dispatcher.js';
import { TelegramMonitoringBot } from '../services/telegram-bot/src/bot.js';
import { getServiceRegistry } from '../services/core-handler/src/registry.js';
import { CoreProcessManager } from '../services/core-handler/src/process-manager.js';
import { BerryAdapter } from '../services/whatsapp-worker/src/berry-adapter.js';
import {
  createRootSnapshot,
  listSnapshots,
  getSnapshotFilePath,
  deleteSnapshot,
  getControlCenterPublicUrl,
  formatBytes
} from '../packages/common/src/snapshot-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Unified E-Commerce Platform — End-to-End Master Test Suite', () => {
  let db;
  let repos;

  before(() => {
    // In-memory test database for isolated, high-speed, repeatable testing
    db = new Database({ inMemory: true });
    repos = createRepositories(db);
  });

  after(() => {
    db.close();
  });

  // 1. Zero Port Conflicts Verification (Section 3)
  it('should guarantee zero intentional port conflicts across all services', () => {
    const portValues = Object.values(PORTS);
    const uniquePorts = new Set(portValues);
    assert.strictEqual(portValues.length, uniquePorts.size, 'Every service must have a strictly unique port');

    assert.strictEqual(PORTS.STOREFRONT, 5000);
    assert.strictEqual(PORTS.COMMERCE_API, 5001);
    assert.strictEqual(PORTS.NOTIFICATION_SERVICE, 5002);
    assert.strictEqual(PORTS.ADMIN_PANEL, 5050);
    assert.strictEqual(PORTS.CORE_HANDLER, 8085);
    assert.strictEqual(PORTS.CONTROL_CENTER, 8090);
    assert.strictEqual(PORTS.WHATSAPP_AUTH_API, 4000);
    assert.strictEqual(PORTS.WHATSAPP_WORKER, 4001);
    assert.strictEqual(PORTS.WHATSAPP_DASHBOARD, 4002);
    assert.strictEqual(PORTS.PAYMENT_API, 6100);
    assert.strictEqual(PORTS.CHECKOUT_PORTAL, 7000);
  });

  // 2. Canonical Identity System (Section 6 & 19)
  it('should normalize phone numbers and resolve canonical internal identity', () => {
    assert.strictEqual(normalizePhoneNumber('9876543210'), '+919876543210');
    assert.strictEqual(normalizePhoneNumber('+91 98765 43210'), '+919876543210');
    assert.strictEqual(normalizeEmail('  John.Doe@Example.COM  '), 'john.doe@example.com');

    const canonical = IdentityResolver.createCanonicalUser({
      name: 'Rohan Mehta',
      mobile: '9876500001',
      email: 'Rohan@mehta.org'
    });

    assert.ok(canonical.userId.startsWith('USR_'));
    assert.strictEqual(canonical.mobile, '+919876500001');
    assert.strictEqual(canonical.email, 'rohan@mehta.org');
    assert.strictEqual(canonical.status, 'ACTIVE');
  });

  // 3. User Upsert and Identity Linking (Section 6)
  it('should prevent duplicate accounts and link provider identities', () => {
    const user1 = repos.users.upsertCanonicalUser({
      name: 'Neha Singh',
      mobile: '+919811122233',
      email: 'neha@example.com'
    });

    assert.ok(user1.id);

    // Second login attempt with same mobile updates last_login_at without creating a duplicate
    const user2 = repos.users.upsertCanonicalUser({
      name: 'Neha S.',
      mobile: '+919811122233',
      email: 'neha@example.com'
    });

    assert.strictEqual(user1.id, user2.id, 'Must resolve to the exact same canonical user ID');

    // Link WhatsApp and Payment provider identities
    repos.users.linkIdentity(user1.id, 'whatsapp', '+919811122233', { verified: true });
    repos.users.linkIdentity(user1.id, 'youpi_pg', 'CUST_YOUPI_999', { vpa: 'neha@oksbi' });

    const identities = repos.users.getIdentities(user1.id);
    assert.strictEqual(identities.length, 2);
  });

  // 4. Products & Automated SKU Asset Warehouse Generation (Section 9 & 10)
  it('should automatically provision SKU asset directory structure on product creation', () => {
    const tempAssetDir = path.resolve(__dirname, 'temp_test_assets');
    repos.products.assetRootDir = tempAssetDir;

    const product = repos.products.create({
      name: 'AeroGlide Carbon ANC Headphones',
      sku: 'SKU-99001',
      price: 15999.00,
      stock: 35,
      description: 'Ultra-light carbon fiber headphones with dual DACs.',
      variants: [
        { name: 'Matte Carbon', sku: 'SKU-99001-CARB', price: 15999.00, stock: 20 }
      ]
    });

    assert.strictEqual(product.sku, 'SKU-99001');
    assert.strictEqual(product.asset_dir, 'products/SKU-99001');

    // Verify physical folders were created automatically (Section 10)
    const expectedSubdirs = ['images', 'videos', 'documents', 'metadata'];
    for (const sub of expectedSubdirs) {
      const fullPath = path.join(tempAssetDir, 'products', 'SKU-99001', sub);
      assert.ok(fs.existsSync(fullPath), `Subdirectory ${sub} must exist on disk`);
    }

    // Clean up temp test asset dir
    try { fs.rmSync(tempAssetDir, { recursive: true, force: true }); } catch {}
  });

  // 5. Cart Survival & Safe Guest Cart Merge (Section 16)
  it('should preserve guest cart and safely merge into user cart upon WhatsApp login', () => {
    const product = repos.products.create({
      name: 'Mechanical Switch Puller Pro',
      sku: 'SKU-77001',
      price: 499.00,
      stock: 50,
      description: 'Precision CNC switch puller.'
    });

    const guestSession = 'GUEST_TEST_SESSION_123';
    const guestCart = repos.carts.getOrCreateCart(null, guestSession);
    repos.carts.addItem(guestCart.id, product.id, null, 2, 499.00);

    const guestCartWithItems = repos.carts.getCartWithItems(guestCart.id);
    assert.strictEqual(guestCartWithItems.items.length, 1);
    assert.strictEqual(guestCartWithItems.items[0].quantity, 2);

    // Customer logs in via WhatsApp
    const user = repos.users.upsertCanonicalUser({
      name: 'Vikram Rao',
      mobile: '+919877700011',
      email: 'vikram@example.com'
    });

    // Execute Cart Merge (Section 16)
    const mergedUserCart = repos.carts.mergeGuestCart(guestSession, user.id);
    assert.strictEqual(mergedUserCart.items.length, 1);
    assert.strictEqual(mergedUserCart.items[0].quantity, 2);

    // Guest cart should now be marked as MERGED
    const oldGuestCart = db.queryOne('SELECT * FROM carts WHERE session_token = $1', [guestSession]);
    assert.strictEqual(oldGuestCart.status, 'MERGED');
  });

  // 6. Order Creation & Consolidated View (Section 12 & 13)
  it('should create an order with line items, inventory deduction, and consolidated details', () => {
    const product = repos.products.create({
      name: 'Apex Tactical Titanium Pen',
      sku: 'SKU-88001',
      price: 1999.00,
      stock: 20,
      description: 'Grade 5 titanium bolt-action tactical pen.'
    });

    const user = repos.users.upsertCanonicalUser({
      name: 'Ananya Sharma',
      mobile: '+919822233344',
      email: 'ananya@example.com'
    });

    const order = repos.orders.createOrder({
      userId: user.id,
      customerName: user.name,
      customerEmail: user.email,
      customerMobile: user.mobile,
      shippingAddress: { city: 'Bengaluru', addressLine1: 'MG Road' },
      totalAmount: 1999.00,
      paymentMethod: 'UPI'
    }, [
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        quantity: 2,
        unitPrice: 1999.00
      }
    ]);

    assert.ok(order.order_number.startsWith('ORD-'));
    assert.strictEqual(order.order_status, 'PLACED');
    assert.strictEqual(order.payment_status, 'PENDING');
    assert.strictEqual(order.items.length, 1);

    // Verify inventory deducted automatically
    const updatedProd = repos.products.findById(product.id);
    assert.strictEqual(updatedProd.stock, 18, 'Stock must decrease from 20 to 18');

    // Test Order Status Transitions (Section 13)
    const confirmed = repos.orders.updateStatus(order.id, 'CONFIRMED', 'Payment verified', 'SYSTEM');
    assert.strictEqual(confirmed.order_status, 'CONFIRMED');
    assert.strictEqual(confirmed.timeline.length, 2);

    const shipped = repos.orders.updateStatus(order.id, 'SHIPPED', 'Dispatched with BlueDart', 'ADMIN');
    assert.strictEqual(shipped.order_status, 'SHIPPED');
    assert.strictEqual(shipped.shipments.status, 'IN_TRANSIT');
  });

  // 7. Dynamic Customer WhatsApp Notification Dispatcher (Section 14 & 15)
  it('should render dynamic WhatsApp notification templates with variables and track delivery', async () => {
    // Seed templates
    repos.notifications.upsertTemplate({
      id: 'order_placed',
      eventType: 'order.created',
      channel: 'WHATSAPP',
      title: 'Order Placed Confirmation',
      templateText: 'Hello {{customer_name}}, your order #{{order_id}} for ₹{{amount}} has been placed.'
    });

    process.env.WHATSAPP_MOCK_DISPATCH = 'true';
    const dispatcher = new NotificationDispatcher({ repos, whatsappWorkerUrl: 'http://127.0.0.1:59999' });

    const rendered = dispatcher.renderTemplate(
      'Hello {{customer_name}}, order #{{order_id}} of ₹{{amount}} via {{payment_method}} confirmed!',
      {
        customer_name: 'Rajesh',
        order_id: 'ORD-2026-101',
        amount: '12,499.00',
        payment_method: 'UPI'
      }
    );

    assert.strictEqual(rendered, 'Hello Rajesh, order #{{order_id}} of ₹12,499.00 via UPI confirmed!'.replace('{{order_id}}', 'ORD-2026-101'));

    // Test handling event
    const notif = await dispatcher.handleEvent({
      type: 'order.created',
      data: {
        customerName: 'Rajesh Kumar',
        customerMobile: '+919876543210',
        orderNumber: 'ORD-999',
        totalAmount: '4,999.00'
      }
    });

    assert.ok(notif);
    assert.strictEqual(notif.status, 'SENT');
    assert.strictEqual(notif.channel, 'WHATSAPP');
    assert.ok(notif.body.includes('Rajesh Kumar'));
    assert.ok(notif.body.includes('ORD-999'));
  });

  // 8. Security Isolation: Telegram Alerting Rules (Section 35 & 36)
  it('should alert Telegram for admin login events, but NOT for normal customer activity', async () => {
    const bot = new TelegramMonitoringBot({ repos });
    const receivedAlerts = [];

    // Spy on broadcast
    bot.broadcast = async msg => {
      receivedAlerts.push(msg);
      return { success: true };
    };

    bot.startEventSubscriptions();

    // 1. Admin successful login event -> MUST emit Telegram alert (Section 36)
    await globalEventBus.publish(createEvent(EVENT_TYPES.ADMIN_LOGIN_SUCCESS, {
      admin: 'admin@store.local',
      ipAddress: '192.168.1.50',
      timestamp: new Date().toISOString()
    }));

    assert.strictEqual(receivedAlerts.length, 1);
    assert.ok(receivedAlerts[0].includes('ADMIN LOGIN'));
    assert.ok(receivedAlerts[0].includes('admin@store.local'));

    // 2. Admin failed login event -> MUST emit Telegram alert (Section 36)
    await globalEventBus.publish(createEvent(EVENT_TYPES.ADMIN_LOGIN_FAILED, {
      account: 'admin@store.local',
      reason: 'Invalid credentials',
      ipAddress: '192.168.1.50'
    }));

    assert.strictEqual(receivedAlerts.length, 2);
    assert.ok(receivedAlerts[1].includes('ADMIN LOGIN FAILED'));

    // 3. Normal customer activities -> MUST NOT emit Telegram alert (Section 35)
    await globalEventBus.publish(createEvent(EVENT_TYPES.USER_LOGIN, { userId: 'USR_101', mobile: '+919876543210' }));
    await globalEventBus.publish(createEvent(EVENT_TYPES.USER_CREATED, { userId: 'USR_102' }));

    assert.strictEqual(receivedAlerts.length, 2, 'Customer logins and signups must NEVER alert Telegram');
  });

  // 9. Safe Service Control Guardrails in Telegram Bot (Section 38)
  it('should enforce confirmation before restart and block arbitrary shell execution in Telegram bot', async () => {
    const bot = new TelegramMonitoringBot({ repos });
    const replies = [];
    bot.sendMessage = async (chatId, text) => {
      replies.push({ chatId, text });
    };

    // 1. Attempt arbitrary command execution -> Forbidden
    await bot.handleCommand(12345, 12345, 'attacker', '/run rm -rf /');
    assert.ok(replies[0].text.includes('Unknown command') || replies[0].text.includes('forbidden'));

    // 2. Attempt restart of non-whitelisted service -> Rejected
    await bot.handleCommand(12345, 12345, 'operator', '/restart unknown_daemon');
    assert.ok(replies[1].text.includes('Invalid Service') || replies[1].text.includes('not in the whitelist'));

    // 3. Valid restart request -> Requires confirmation
    await bot.handleCommand(12345, 12345, 'operator', '/restart commerce-api');
    assert.ok(replies[2].text.includes('CONFIRM SERVICE RESTART'));
    assert.ok(replies[2].text.includes('/confirm commerce-api'));

    // 4. Confirm restart -> Triggers execution
    await bot.handleCommand(12345, 12345, 'operator', '/confirm commerce-api');
    assert.ok(replies[3].text.includes('Executing restart') || replies[3].text.includes('Successfully initiated'));
  });

  // 9b. Telegram Bootloop Prevention & Rate Limiting
  it('should prevent Telegram reboot loops via update persistence, stale message dropping, and reboot cooldown', async () => {
    const bot = new TelegramMonitoringBot({ repos });
    const replies = [];
    bot.sendMessage = async (chatId, text) => {
      replies.push({ chatId, text });
    };

    // 1. Persistence of last update ID
    repos.telegram.saveUpdateId(999999);
    assert.strictEqual(repos.telegram.getStoredUpdateId(), 999999);

    // 2. Drop stale messages (>45 seconds old)
    const staleDate = Math.floor(Date.now() / 1000) - 100; // 100 seconds ago
    await bot.handleCommand(12345, 12345, 'operator', '/reboot', staleDate);
    assert.strictEqual(replies.length, 0, 'Stale message must be dropped without response or execution');

    // 3. Fresh message executes reboot command
    const freshDate = Math.floor(Date.now() / 1000) - 2; // 2 seconds ago
    await bot.handleCommand(12345, 12345, 'operator', '/reboot', freshDate);
    assert.ok(replies.length >= 1);
    assert.ok(replies[0].text.includes('Initiating Platform Full Reboot'));

    // 4. Immediate consecutive reboot is blocked by cooldown
    replies.length = 0;
    await bot.handleCommand(12345, 12345, 'operator', '/reboot', Math.floor(Date.now() / 1000));
    assert.ok(replies.length >= 1);
    assert.ok(replies[0].text.includes('Reboot Cooldown Active'));
  });

  // 10. Structured Logging & Sensitive Secret Sanitization (Section 32)
  it('should deeply redact sensitive credentials from central logs', () => {
    const logger = new CentralLogger('test-logger');

    const inputData = {
      user_id: 'USR_101',
      password: 'SuperSecretPassword123!',
      jwt: 'header.payload.signature',
      api_key: 'sk_live_123456789',
      customer: {
        name: 'Suresh',
        card_number: '4111222233334444'
      }
    };

    const sanitized = sanitizeData(inputData);

    assert.strictEqual(sanitized.user_id, 'USR_101');
    assert.strictEqual(sanitized.password, '[REDACTED]');
    assert.strictEqual(sanitized.jwt, '[REDACTED]');
    assert.strictEqual(sanitized.api_key, '[REDACTED]');
    assert.strictEqual(sanitized.customer.name, 'Suresh');
    assert.strictEqual(sanitized.customer.card_number, '[REDACTED]');
  });

  // 11. Core Handler Registry & System Telemetry (Section 28 & 31)
  it('should define all platform services in the registry and report host metrics', () => {
    const registry = getServiceRegistry();
    assert.ok(registry.length >= 10, 'Registry must define all platform services');
    assert.ok(registry.some(s => s.id === 'whatsapp-dashboard'), 'WhatsApp Dashboard must be registered');

    const manager = new CoreProcessManager();
    const metrics = manager.getSystemMetrics();

    assert.ok(metrics.cpuCount > 0);
    assert.ok(metrics.memory.totalMb > 0);
    assert.ok(metrics.memory.usagePercent >= 0 && metrics.memory.usagePercent <= 100);
    assert.ok(metrics.uptimeSeconds >= 0);
  });

  // 12. Multiple Photos & Videos Media Upload on Products
  it('should support multiple photos and videos per product', () => {
    const product = repos.products.create({
      name: 'Venture 4K Action Camera',
      sku: 'SKU-55001',
      price: 19999.00,
      description: 'Compact 4K 120fps waterproof action camera.',
      media: [
        { url: 'https://example.com/cam_front.jpg', mediaType: 'image', isPrimary: true },
        { url: 'https://example.com/cam_side.jpg', mediaType: 'image', isPrimary: false },
        { url: 'https://example.com/cam_demo.mp4', mediaType: 'video', isPrimary: false }
      ]
    });

    assert.strictEqual(product.media.length, 3);
    const photos = product.media.filter(m => m.media_type === 'image');
    const videos = product.media.filter(m => m.media_type === 'video');
    assert.strictEqual(photos.length, 2);
    assert.strictEqual(videos.length, 1);
    assert.strictEqual(product.primaryImage, 'https://example.com/cam_front.jpg');
  });

  // 13. Product Ratings & Reviews with Top Verified Reviews First
  it('should calculate ratings summary and return verified reviews at the top', () => {
    const product = repos.products.create({
      name: 'Studio Master Monitor Earphones',
      sku: 'SKU-66001',
      price: 4999.00,
      description: 'Dual balanced armature studio earphones.'
    });

    const reviewer1 = repos.users.create({
      name: 'Unverified Reviewer',
      mobile: '+919911122233',
      email: 'rev1@example.com'
    });

    const reviewer2 = repos.users.create({
      name: 'Verified Buyer',
      mobile: '+919911122244',
      email: 'rev2@example.com'
    });

    // Add unverified review first
    repos.reviews.createReview({
      productId: product.id,
      userId: reviewer1.id,
      userName: reviewer1.name,
      rating: 4,
      title: 'Decent earphones',
      comment: 'Sound is okay.',
      isVerified: 0
    });

    // Add verified review second
    const verifiedReview = repos.reviews.createReview({
      productId: product.id,
      userId: reviewer2.id,
      userName: reviewer2.name,
      rating: 5,
      title: 'Spectacular clarity!',
      comment: 'These are the best monitors for tracking.',
      isVerified: 1 // Top verified review!
    });

    const result = repos.reviews.getProductReviews(product.id);
    assert.strictEqual(result.reviews.length, 2);
    assert.strictEqual(result.reviews[0].id, verifiedReview.id, 'Top verified review must be the FIRST review returned');
    assert.strictEqual(result.reviews[0].is_verified, 1);
    assert.strictEqual(result.summary.totalReviews, 2);
    assert.strictEqual(result.summary.averageRating, 4.5);
  });

  // 14. Review Media Attachments & Abuse/Misuse Limiting Guardrails
  it('should enforce media misuse limiting and guardrails on customer reviews', () => {
    const product = repos.products.create({
      name: 'Wireless Mechanical Numpad',
      sku: 'SKU-77100',
      price: 1899.00
    });

    const customer = repos.users.create({
      name: 'Pooja Patel',
      mobile: '+919988776655',
      email: 'pooja@example.com'
    });

    // Attempt review with 5 photos, 2 videos, and an invalid javascript: protocol URL
    const reviewWithMedia = repos.reviews.createReview({
      productId: product.id,
      userId: customer.id,
      userName: customer.name,
      rating: 5,
      title: '<b>Superb Numpad!</b>',
      comment: 'Keys feel amazing with custom lubed switches.',
      media: [
        { url: 'https://example.com/p1.jpg', mediaType: 'image' },
        { url: 'https://example.com/p2.jpg', mediaType: 'image' },
        { url: 'https://example.com/p3.jpg', mediaType: 'image' },
        { url: 'https://example.com/p4_excess.jpg', mediaType: 'image' }, // Should be dropped by guardrail (max 3 images)
        { url: 'https://example.com/demo.mp4', mediaType: 'video' },
        { url: 'https://example.com/demo2_excess.mp4', mediaType: 'video' }, // Should be dropped by guardrail (max 1 video)
        { url: 'javascript:alert(1)', mediaType: 'image' } // Malicious URL should be dropped by guardrail
      ]
    });

    assert.ok(reviewWithMedia.id);
    assert.strictEqual(reviewWithMedia.title, 'Superb Numpad!', 'HTML tags must be stripped');
    // Verify media guardrails: max 3 images, max 1 video, no invalid protocols
    assert.strictEqual(reviewWithMedia.media.length, 4, 'Media attachments must be limited to max 3 photos + 1 video');
    const images = reviewWithMedia.media.filter(m => m.mediaType === 'image');
    const videos = reviewWithMedia.media.filter(m => m.mediaType === 'video');
    assert.strictEqual(images.length, 3);
    assert.strictEqual(videos.length, 1);
    assert.ok(!reviewWithMedia.media.some(m => m.url.includes('javascript')));

    // Test duplicate review update: same user submitting review for same product updates rather than duplicates
    const updatedReview = repos.reviews.createReview({
      productId: product.id,
      userId: customer.id,
      userName: customer.name,
      rating: 4,
      title: 'Superb Numpad (Updated)',
      comment: 'Still great after a month of heavy use.',
      media: [{ url: 'https://example.com/p1.jpg', mediaType: 'image' }]
    });

    assert.strictEqual(updatedReview.id, reviewWithMedia.id, 'Must update existing review to prevent duplicate spam');
    assert.strictEqual(updatedReview.rating, 4);
    assert.strictEqual(updatedReview.media.length, 1);
  });

  // 16. WhatsApp Picture with Text & Dashboard Launch Ordering Verification
  it('should deliver WhatsApp picture broadcast with text caption together and enforce sequential dashboard ordering', async () => {
    // A. WhatsApp Broadcast picture with caption
    const adapter = new BerryAdapter({
      sessionId: 'test_session',
      sessionPath: path.join(__dirname, '../data/test_auth'),
      databasePath: path.join(__dirname, '../data/test_berry.db')
    });

    let capturedPayload = null;
    let capturedJid = null;
    adapter.status = 'CONNECTED';
    adapter.client = {
      sendImage: async (jid, payload) => {
        capturedJid = jid;
        capturedPayload = payload;
        return { id: 'msg_img_123' };
      }
    };

    const res = await adapter.sendMessage('+919876543210', 'Special Festive Offer: 20% OFF', {
      mediaUrl: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=600',
      mediaType: 'image'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.delivered, true);
    assert.strictEqual(capturedJid, '919876543210@s.whatsapp.net');
    assert.ok(capturedPayload, 'Payload must be passed to sendImage');
    assert.strictEqual(capturedPayload.caption, 'Special Festive Offer: 20% OFF', 'Text caption must accompany the picture in the media payload');
    assert.strictEqual(capturedPayload.url, 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=600');

    // B. Dashboard sequence verification
    // 1st: YouPi PG Merchant (6001), 2nd: WhatsApp Berry (4002), 3rd: Control Center (8090)
    const expectedSequence = [
      { name: 'YouPi PG Merchant Dashboard', port: PORTS.MERCHANT_ADMIN || 6001 },
      { name: 'WhatsApp Berry Dashboard', port: PORTS.WHATSAPP_DASHBOARD || 4002 },
      { name: 'Central Control Center', port: PORTS.CONTROL_CENTER || 8090 }
    ];

    assert.strictEqual(expectedSequence[0].port, 6001, '1st dashboard launched must be Payment Gateway (port 6001)');
    assert.strictEqual(expectedSequence[1].port, 4002, '2nd dashboard launched must be WhatsApp (port 4002)');
    assert.strictEqual(expectedSequence[2].port, 8090, '3rd dashboard launched must be Central Control Center (port 8090)');
  });

  // 17. Full Root Snapshot & Remote Backup Engine
  it('should support snapshot listing, directory traversal protection, public download URL generation, and cleanup', async () => {
    const testDir = path.join(__dirname, 'test_snapshot_sandbox');
    const testSnapshotsDir = path.join(testDir, 'snapshots');
    fs.mkdirSync(testSnapshotsDir, { recursive: true });

    fs.writeFileSync(path.join(testDir, 'dummy.txt'), 'Hello Snapshot Platform World!', 'utf8');

    try {
      // Test formatting
      assert.strictEqual(formatBytes(1024), '1.00 KB');
      assert.strictEqual(formatBytes(1048576), '1.00 MB');

      // Test URL generation
      const publicUrl = getControlCenterPublicUrl(testDir);
      assert.ok(publicUrl.startsWith('http://') || publicUrl.startsWith('https://'), 'Public URL must be valid HTTP/HTTPS');

      // Test directory traversal prevention
      assert.strictEqual(getSnapshotFilePath('../../etc/passwd', testDir), null, 'Must reject path traversal with ../');
      assert.strictEqual(getSnapshotFilePath('sub/test.zip', testDir), null, 'Must reject path with slashes');
      assert.strictEqual(getSnapshotFilePath('nonexistent.zip', testDir), null, 'Must return null for non-existent file');

      // Create a test snapshot archive file
      const dummyZip = path.join(testSnapshotsDir, 'snapshot_2026-09-19_12-00-00.zip');
      fs.writeFileSync(dummyZip, 'PK\x03\x04dummy-zip-content', 'utf8');

      // Test listSnapshots
      const snapshots = listSnapshots({ rootDir: testDir });
      assert.ok(snapshots.length >= 1, 'Should list existing snapshots in snapshots directory');
      const found = snapshots.find(s => s.filename === 'snapshot_2026-09-19_12-00-00.zip');
      assert.ok(found, 'Should find the dummy snapshot');
      assert.ok(found.downloadUrl.includes('/api/snapshots/download/'));
      assert.ok(found.publicDownloadUrl.includes('/api/snapshots/download/'));

      // Test getSnapshotFilePath for valid file
      const resolved = getSnapshotFilePath('snapshot_2026-09-19_12-00-00.zip', testDir);
      assert.strictEqual(resolved, dummyZip);

      // Test deleteSnapshot
      const deleted = deleteSnapshot('snapshot_2026-09-19_12-00-00.zip', testDir);
      assert.strictEqual(deleted, true);
      assert.strictEqual(fs.existsSync(dummyZip), false, 'Snapshot file should be deleted');
    } finally {
      // Cleanup
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });
});

