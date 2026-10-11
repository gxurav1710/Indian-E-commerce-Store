import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS } from '../../../packages/common/src/ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

/**
 * Service Registry Configuration
 * Complies with Section 28 of Master Build Specification
 */
export function getServiceRegistry() {
  return [
    {
      id: 'commerce-api',
      displayName: 'Unified Commerce REST API',
      description: 'Central catalogue, SKU asset manager, cart, order, and checkout engine',
      command: 'node',
      script: path.join(rootDir, 'services/commerce-api/src/index.js'),
      workingDirectory: path.join(rootDir, 'services/commerce-api'),
      port: PORTS.COMMERCE_API, // 5001
      healthEndpoint: `http://localhost:${PORTS.COMMERCE_API}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.COMMERCE_API}/health/deep`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'CRITICAL'
    },
    {
      id: 'storefront',
      displayName: 'Commercial Storefront Web App',
      description: 'Customer facing demo e-commerce store with WhatsApp auth & checkout',
      command: 'node',
      script: path.join(rootDir, 'apps/storefront/src/index.js'),
      workingDirectory: path.join(rootDir, 'apps/storefront'),
      port: PORTS.STOREFRONT, // 5000
      healthEndpoint: `http://localhost:${PORTS.STOREFRONT}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.STOREFRONT}/health/deep`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'CRITICAL'
    },
    {
      id: 'admin-panel',
      displayName: 'Business Admin Panel',
      description: 'Operations console: orders, inventory, products, customers, and support',
      command: 'node',
      script: path.join(rootDir, 'apps/admin/src/index.js'),
      workingDirectory: path.join(rootDir, 'apps/admin'),
      port: PORTS.ADMIN_PANEL, // 5050
      healthEndpoint: `http://localhost:${PORTS.ADMIN_PANEL}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.ADMIN_PANEL}/health/deep`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'CRITICAL'
    },
    {
      id: 'shipping-service',
      displayName: 'Shiprocket Surface Shipping Engine',
      description: 'Background shipping rate calculator with dynamic pickup/drop pincode & weight aggregation',
      command: 'node',
      script: path.join(rootDir, 'services/shipping-service/src/index.js'),
      workingDirectory: path.join(rootDir, 'services/shipping-service'),
      port: PORTS.SHIPPING_SERVICE || 5003,
      healthEndpoint: `http://localhost:${PORTS.SHIPPING_SERVICE || 5003}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.SHIPPING_SERVICE || 5003}/health`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'CRITICAL'
    },
    {
      id: 'control-center',
      displayName: 'Central Control Center Console',
      description: 'Unified operator console: full system supervisor, live terminal logs, observer engines & service controls',
      command: 'node',
      script: path.join(rootDir, 'apps/control-center/src/index.js'),
      workingDirectory: path.join(rootDir, 'apps/control-center'),
      port: PORTS.CONTROL_CENTER, // 8090
      healthEndpoint: `http://localhost:${PORTS.CONTROL_CENTER}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.CONTROL_CENTER}/health/deep`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'CRITICAL'
    },
    {
      id: 'merchant-admin',
      displayName: 'Payment Gateway Merchant Portal & Live Ops',
      description: 'Authentic YOUPI PG Merchant Admin Panel for transactions, live operations, support tickets, and rules',
      command: 'node',
      script: path.join(rootDir, 'YOUPI PG V2/apps/merchant-admin/src/index.js'),
      workingDirectory: path.join(rootDir, 'YOUPI PG V2/apps/merchant-admin'),
      port: PORTS.MERCHANT_ADMIN, // 6001
      healthEndpoint: `http://localhost:${PORTS.MERCHANT_ADMIN}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.MERCHANT_ADMIN}/health`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'CRITICAL'
    },
    {
      id: 'notifications',
      displayName: 'Dynamic Notification Service',
      description: 'Event-driven customer WhatsApp notification dispatcher',
      command: 'node',
      script: path.join(rootDir, 'services/notifications/src/index.js'),
      workingDirectory: path.join(rootDir, 'services/notifications'),
      port: PORTS.NOTIFICATION_SERVICE, // 5002
      healthEndpoint: `http://localhost:${PORTS.NOTIFICATION_SERVICE}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.NOTIFICATION_SERVICE}/health/deep`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'STANDARD'
    },
    {
      id: 'telegram-bot',
      displayName: 'Telegram Monitoring Bot',
      description: 'Operator security alerting channel and /health /restart responder',
      command: 'node',
      script: path.join(rootDir, 'services/telegram-bot/src/index.js'),
      workingDirectory: path.join(rootDir, 'services/telegram-bot'),
      port: null, // Daemon worker
      healthEndpoint: null,
      deepHealthEndpoint: null,
      startupTimeoutMs: 10000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 15000 },
      enabled: true,
      criticality: 'STANDARD'
    },
    {
      id: 'payment-api',
      displayName: 'Payment Core Gateway API',
      description: 'YouPi Payment Gateway session manager and transaction engine',
      command: 'node',
      script: path.join(rootDir, 'YOUPI PG V2/apps/payment-api/src/index.js'),
      workingDirectory: path.join(rootDir, 'YOUPI PG V2/apps/payment-api'),
      port: PORTS.PAYMENT_API, // 6100
      healthEndpoint: `http://localhost:${PORTS.PAYMENT_API}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.PAYMENT_API}/health`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'CRITICAL'
    },
    {
      id: 'checkout-portal',
      displayName: 'Payment Checkout Portal UI',
      description: 'Preserved YouPi PG responsive UPI and Cash payment UI',
      command: 'node',
      script: path.join(rootDir, 'YOUPI PG V2/apps/checkout-portal/src/index.js'),
      workingDirectory: path.join(rootDir, 'YOUPI PG V2/apps/checkout-portal'),
      port: PORTS.CHECKOUT_PORTAL, // 7000
      healthEndpoint: `http://localhost:${PORTS.CHECKOUT_PORTAL}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.CHECKOUT_PORTAL}/health`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'CRITICAL'
    },
    {
      id: 'whatsapp-auth',
      displayName: 'WhatsApp Auth Core API',
      description: 'Non-Docker Fastify passwordless authentication and challenge engine',
      command: 'node',
      script: path.join(rootDir, 'services/whatsapp-auth/src/index.js'),
      workingDirectory: path.join(rootDir, 'services/whatsapp-auth'),
      port: PORTS.WHATSAPP_AUTH_API, // 4000
      healthEndpoint: `http://localhost:${PORTS.WHATSAPP_AUTH_API}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.WHATSAPP_AUTH_API}/health/deep`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'STANDARD'
    },
    {
      id: 'whatsapp-worker',
      displayName: 'BerryProtocol WhatsApp Daemon',
      description: 'BerryProtocol WebSocket daemon with multi-device session, media & button dispatch',
      command: 'node',
      script: path.join(rootDir, 'services/whatsapp-worker/src/index.js'),
      workingDirectory: path.join(rootDir, 'services/whatsapp-worker'),
      port: PORTS.WHATSAPP_WORKER, // 4001
      healthEndpoint: `http://localhost:${PORTS.WHATSAPP_WORKER}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.WHATSAPP_WORKER}/health/deep`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'STANDARD'
    },
    {
      id: 'whatsapp-dashboard',
      displayName: 'BerryProtocol Studio Dashboard',
      description: 'Official BerryProtocol Studio pairing console, live QR scanner & connection tester',
      command: 'node',
      script: path.join(rootDir, 'services/whatsapp-dashboard/src/index.js'),
      workingDirectory: path.join(rootDir, 'services/whatsapp-dashboard'),
      port: PORTS.WHATSAPP_DASHBOARD, // 4002
      healthEndpoint: `http://localhost:${PORTS.WHATSAPP_DASHBOARD}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.WHATSAPP_DASHBOARD}/health`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: true,
      criticality: 'STANDARD'
    },
    {
      id: 'sms-observer',
      displayName: 'SMS Banking Ingestion Observer',
      description: 'YouPi PG cellular banking SMS ingestion via Google Messages or Webhook',
      command: 'node',
      script: path.join(rootDir, 'YOUPI PG V2/apps/sms-observer/src/index.js'),
      workingDirectory: path.join(rootDir, 'YOUPI PG V2/apps/sms-observer'),
      port: PORTS.SMS_OBSERVER, // 6002
      healthEndpoint: `http://localhost:${PORTS.SMS_OBSERVER}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.SMS_OBSERVER}/health`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: false,
      criticality: 'STANDARD'
    },
    {
      id: 'gmail-observer',
      displayName: 'Gmail Banking Ingestion Observer',
      description: 'YouPi PG automated bank email credit alert ingester via OAuth2 & CDP',
      command: 'node',
      script: path.join(rootDir, 'YOUPI PG V2/apps/gmail-observer/src/index.js'),
      workingDirectory: path.join(rootDir, 'YOUPI PG V2/apps/gmail-observer'),
      port: PORTS.GMAIL_OBSERVER, // 6003
      healthEndpoint: `http://localhost:${PORTS.GMAIL_OBSERVER}/health`,
      deepHealthEndpoint: `http://localhost:${PORTS.GMAIL_OBSERVER}/health`,
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 5000,
      restartPolicy: { maxRetries: 3, cooldownMs: 10000 },
      enabled: false,
      criticality: 'STANDARD'
    }
  ];
}
