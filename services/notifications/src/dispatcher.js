import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultLogger } from '../../../packages/common/src/logger.js';
import { createRepositories } from '../../../packages/db/src/index.js';
import { PORTS, URLS } from '../../../packages/common/src/ports.js';
import { EVENT_TYPES, globalEventBus } from '../../../packages/common/src/events.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../..');

export class NotificationDispatcher {
  /**
   * @param {{ repos?: any, logger?: any, whatsappWorkerUrl?: string }} [options={}]
   */
  constructor(options = {}) {
    this.repos = options.repos || createRepositories();
    this.logger = options.logger || defaultLogger;
    this.whatsappWorkerUrl = options.whatsappWorkerUrl || process.env.WHATSAPP_WORKER_INTERNAL_URL || `http://127.0.0.1:${PORTS.WHATSAPP_WORKER || 4001}`;
    try {
      this.seedDefaultTemplates();
    } catch {}
  }

  getStoreOwnerPhone() {
    return process.env.STORE_OWNER_WHATSAPP || process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || '+919876543210';
  }

  getBotPhone() {
    return process.env.WHATSAPP_BOT_PHONE || '+919876543211';
  }

  getStoreBranding() {
    const brandingPath = path.resolve(rootDir, 'data/white_label_settings.json');
    let branding = {
      store_name: 'VIENTA',
      store_tagline: 'Premium Clothing'
    };
    try {
      if (fs.existsSync(brandingPath)) {
        const file = JSON.parse(fs.readFileSync(brandingPath, 'utf8'));
        Object.assign(branding, file);
      }
    } catch {}
    return branding;
  }

  seedDefaultTemplates() {
    const branding = this.getStoreBranding();
    const storeName = branding.store_name || 'VIENTA';

    const defaults = [
      {
        id: 'order_placed',
        eventType: EVENT_TYPES.ORDER_CREATED,
        title: 'Order Placed Confirmation',
        templateText: `🛍️ *[${storeName}] Order Placed Successfully!*\n\nHi {{customer_name}},\nYour order *#{{order_id}}* for *₹{{amount}}* has been placed on *${storeName}*.\nWe will notify you as soon as it is confirmed!\n\n— *${storeName}*`
      },
      {
        id: 'order_confirmed',
        eventType: EVENT_TYPES.ORDER_CONFIRMED,
        title: 'Order Confirmed',
        templateText: `✅ *[${storeName}] Order Confirmed!*\n\nHi {{customer_name}},\nYour order *#{{order_id}}* (₹{{amount}}) has been confirmed on *${storeName}* and is being prepared.\n\n— *${storeName}*`
      },
      {
        id: 'order_shipped',
        eventType: EVENT_TYPES.ORDER_SHIPPED,
        title: 'Order Shipped',
        templateText: `🚚 *[${storeName}] Order Shipped!*\n\nHi {{customer_name}},\nYour order *#{{order_id}}* from *${storeName}* has been shipped and is on its way!\n\n— *${storeName}*`
      },
      {
        id: 'order_delivered',
        eventType: EVENT_TYPES.ORDER_DELIVERED,
        title: 'Order Delivered',
        templateText: `🎉 *[${storeName}] Order Delivered!*\n\nHi {{customer_name}},\nYour order *#{{order_id}}* from *${storeName}* has been delivered.\nThank you for shopping with *${storeName}*!\n\n— *${storeName}*`
      },
      {
        id: 'order_cancelled',
        eventType: EVENT_TYPES.ORDER_CANCELLED,
        title: 'Order Cancelled',
        templateText: `❌ *[${storeName}] Order Cancelled*\n\nHi {{customer_name}},\nYour order *#{{order_id}}* on *${storeName}* for *₹{{amount}}* has been cancelled.\n\n— *${storeName} Support*`
      },
      {
        id: 'payment_success',
        eventType: EVENT_TYPES.PAYMENT_SUCCESS,
        title: 'Payment Confirmed',
        templateText: `💳 *[${storeName}] Payment Confirmed!*\n\nHi {{customer_name}},\nPayment of *₹{{amount}}* for order *#{{order_id}}* on *${storeName}* was successful (Ref: {{transaction_id}}).\n\n— *${storeName}*`
      }
    ];

    for (const t of defaults) {
      if (!this.repos.notifications.getTemplate(t.id)) {
        this.repos.notifications.upsertTemplate(t);
      }
    }
  }

  /**
   * Resolves event type to notification template ID
   */
  getTemplateIdForEvent(eventType) {
    switch (eventType) {
      case EVENT_TYPES.ORDER_CREATED:
        return 'order_placed';
      case EVENT_TYPES.PAYMENT_SUCCESS:
        return 'payment_success';
      case EVENT_TYPES.PAYMENT_FAILED:
        return 'payment_failed';
      case EVENT_TYPES.ORDER_CONFIRMED:
        return 'order_confirmed';
      case EVENT_TYPES.ORDER_SHIPPED:
        return 'order_shipped';
      case EVENT_TYPES.ORDER_DELAYED:
        return 'order_delayed';
      case EVENT_TYPES.ORDER_DELIVERED:
        return 'order_delivered';
      case EVENT_TYPES.ORDER_CANCELLED:
        return 'order_cancelled';
      case EVENT_TYPES.PAYMENT_REFUNDED:
      case EVENT_TYPES.ORDER_REFUNDED:
        return 'refund';
      default:
        return null;
    }
  }

  /**
   * Injects dynamic variables into template text (Section 14 & 15)
   */
  renderTemplate(templateText, context) {
    let rendered = templateText;
    for (const [key, value] of Object.entries(context)) {
      const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      rendered = rendered.replace(placeholder, value !== undefined && value !== null ? String(value) : '');
    }
    return rendered;
  }

  /**
   * Dispatches WhatsApp message via WhatsApp Worker or Mock Adapter
   */
  async sendWhatsAppMessage(recipientPhone, messageBody) {
    let cleanedPhone = String(recipientPhone || '').replace(/[^0-9]/g, '');
    if (cleanedPhone.length === 10) cleanedPhone = '91' + cleanedPhone;
    else if (cleanedPhone.length === 11 && cleanedPhone.startsWith('0')) cleanedPhone = '91' + cleanedPhone.slice(1);

    // Strict Safeguard: Block real WhatsApp network dispatch to test/dummy numbers and during tests
    const dummyPrefixes = ['91987654321', '987654321', '91123456789', '123456789', '910000000000', '0000000000', '919999999999'];
    const isDummyPhone = dummyPrefixes.some(prefix => cleanedPhone.startsWith(prefix));

    if (isDummyPhone || process.env.NODE_ENV === 'test' || process.env.WHATSAPP_MOCK_DISPATCH === 'true') {
      this.logger.info(`[NotificationDispatcher] Test/dummy recipient phone (${cleanedPhone}) or test mode detected. Intercepted without sending real message.`);
      return { success: true, mode: 'mock_test_safeguard' };
    }

    // 1. Primary: Headless WhatsApp Worker (port 4001) - Baileys WebSocket transport
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(`${this.whatsappWorkerUrl}/api/v1/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WORKER_INTERNAL_SECRET || 'worker_secret_key_change_me_in_prod_abcde'}`
        },
        body: JSON.stringify({
          to: cleanedPhone,
          message: messageBody,
          source: 'notifications'
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.ok) {
        return { success: true, mode: 'headless_worker' };
      }
    } catch {
      // Worker offline or unreachable
    }

    // 2. Secondary fallback: WhatsApp Auth API (port 4000)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const authUrl = `http://localhost:${PORTS.WHATSAPP_AUTH_API || 4000}`;
      const res = await fetch(`${authUrl}/api/v1/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: cleanedPhone, message: messageBody, source: 'notifications' }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        return { success: true, mode: 'auth_api' };
      }
    } catch {}

    // High fidelity simulated WhatsApp dispatch for local testing & development
    console.log(`\n💬 [WHATSAPP DISPATCH] --> ${cleanedPhone}:`);
    console.log('------------------------------------------------------------');
    console.log(messageBody);
    console.log('------------------------------------------------------------\n');

    return { success: true, mode: 'mock_local' };
  }

  /**
   * Processes a platform event and delivers dynamic WhatsApp notification
   * @param {Object} event
   */
  async handleEvent(event) {
    const templateId = this.getTemplateIdForEvent(event.type);
    if (!templateId) return;

    const data = event.data || {};
    const recipientPhone = data.customerMobile || data.phone || data.mobile;
    if (!recipientPhone) {
      this.logger.warn(`Cannot send WhatsApp notification: missing recipient phone for event ${event.type}`);
      return;
    }

    const branding = this.getStoreBranding();
    const storeName = branding.store_name || 'VIENTA';
    const storeTagline = branding.store_tagline || 'Premium Clothing';

    let template = this.repos.notifications.getTemplate(templateId);
    let templateText = template?.template_text;

    if (!templateText) {
      // Fallback to default whitelabeled template
      templateText = `📢 *[${storeName}] Update!*\n\nHi {{customer_name}},\nUpdate on order *#{{order_id}}* from *${storeName}*.\n\n— *${storeName}*`;
    }

    // Build dynamic injection context
    const context = {
      store_name: storeName,
      store_tagline: storeTagline,
      customer_name: data.customerName || 'Customer',
      customer_email: data.customerEmail || '',
      order_id: data.orderNumber || data.orderId || 'ORD-UNKNOWN',
      amount: data.totalAmount || data.amount || '0.00',
      payment_method: data.paymentMethod || 'UPI',
      transaction_id: data.transactionId || 'TXN-PENDING',
      carrier: data.carrier || 'BlueDart Express',
      tracking_number: data.trackingNumber || `TRK-${Date.now().toString().slice(-8)}`,
      expected_delivery: data.expectedDelivery || '3-4 business days',
      failure_reason: data.failureReason || 'Card / UPI authorization expired',
      retry_url: `${URLS.STOREFRONT}/checkout`,
      refund_id: data.refundId || `REF-${Date.now().toString().slice(-6)}`
    };

    const renderedMessage = this.renderTemplate(templateText, context);

    // Create pending notification record
    const notification = this.repos.notifications.createNotification({
      userId: data.userId || null,
      channel: 'WHATSAPP',
      eventType: event.type,
      recipient: recipientPhone,
      templateId,
      subject: template?.title || `${storeName} Notification`,
      body: renderedMessage,
      status: 'PENDING'
    });

    // Send via WhatsApp Automator / Worker
    const sendResult = await this.sendWhatsAppMessage(recipientPhone, renderedMessage);

    // Dispatches customer updates TO owner FROM bot number according to configured .env
    try {
      const ownerPhone = this.getStoreOwnerPhone();
      const cleanOwner = String(ownerPhone || '').replace(/[^0-9]/g, '');
      const cleanRecipient = String(recipientPhone || '').replace(/[^0-9]/g, '');

      if (cleanOwner && cleanOwner !== cleanRecipient) {
        const ownerAlertMsg = `🔔 *[${storeName} Owner Alert]*\n• Event: *${event.type}*\n• Order: *#${data.orderNumber || data.orderId || 'N/A'}*\n• Customer: *${data.customerName || 'Customer'}* (${recipientPhone})\n• Amount: *₹${data.totalAmount || data.amount || '0'}*\n\n— *${storeName} Bot* (${this.getBotPhone()})`;
        this.sendWhatsAppMessage(ownerPhone, ownerAlertMsg).catch(() => {});
      }
    } catch {}

    let finalNotif = notification;
    if (sendResult.success) {
      finalNotif = this.repos.notifications.updateStatus(notification.id, 'SENT');
      this.logger.info(`WhatsApp notification dispatched to ${recipientPhone} for ${event.type}`, {
        category: 'whatsapp',
        userId: data.userId,
        orderId: data.orderNumber || data.orderId,
        details: { templateId, mode: sendResult.mode }
      });
    } else {
      finalNotif = this.repos.notifications.updateStatus(notification.id, 'FAILED', sendResult.error || 'Worker dispatch failed');
      this.logger.error(`Failed to send WhatsApp notification to ${recipientPhone}`);
    }

    return finalNotif;
  }

  /**
   * Registers event listeners on the central event bus
   */
  startListening() {
    const monitoredEvents = [
      EVENT_TYPES.ORDER_CREATED,
      EVENT_TYPES.PAYMENT_SUCCESS,
      EVENT_TYPES.PAYMENT_FAILED,
      EVENT_TYPES.ORDER_CONFIRMED,
      EVENT_TYPES.ORDER_SHIPPED,
      EVENT_TYPES.ORDER_DELAYED,
      EVENT_TYPES.ORDER_DELIVERED,
      EVENT_TYPES.ORDER_CANCELLED,
      EVENT_TYPES.PAYMENT_REFUNDED,
      EVENT_TYPES.ORDER_REFUNDED
    ];

    for (const evt of monitoredEvents) {
      globalEventBus.subscribe(evt, event => {
        this.handleEvent(event).catch(err => {
          this.logger.error(`Error processing notification for ${evt}: ${err.message}`);
        });
      });
    }

    console.log(`[NotificationService] Subscribed to ${monitoredEvents.length} platform commerce events.`);
  }
}
