// Central Event System Definitions & Schemas
// Complies with Section 33, 35, 36 of Master Build Specification

export const EVENT_TYPES = Object.freeze({
  // User & Identity Events
  USER_CREATED: 'user.created',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',

  // Order Lifecycle Events
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_PROCESSING: 'order.processing',
  ORDER_SHIPPED: 'order.shipped',
  ORDER_DELAYED: 'order.delayed',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_RETURNED: 'order.returned',
  ORDER_REFUNDED: 'order.refunded',

  // Payment Lifecycle Events
  PAYMENT_CREATED: 'payment.created',
  PAYMENT_SUCCESS: 'payment.success',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',

  // Inventory Events
  INVENTORY_UPDATED: 'inventory.updated',
  INVENTORY_LOW: 'inventory.low',

  // Customer Support Events
  SUPPORT_TICKET_CREATED: 'support.ticket_created',
  SUPPORT_MESSAGE_RECEIVED: 'support.message_received',

  // Operator & Admin Security Events (Alerts to Telegram)
  ADMIN_LOGIN_SUCCESS: 'admin.login.success',
  ADMIN_LOGIN_FAILED: 'admin.login.failed',

  // Infrastructure & Service Events (Alerts to Telegram + Control Center)
  SERVICE_STARTED: 'service.started',
  SERVICE_STOPPED: 'service.stopped',
  SERVICE_RESTARTED: 'service.restarted',
  SERVICE_FAILED: 'service.failed',
  SERVICE_RECOVERED: 'service.recovered'
});

/**
 * Creates a structured event payload
 * @param {string} type - from EVENT_TYPES
 * @param {Object} data - event-specific payload
 * @param {Object} [metadata]
 * @returns {Object}
 */
export function createEvent(type, data, metadata = {}) {
  return {
    id: `EVT_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    type,
    data,
    metadata: {
      timestamp: new Date().toISOString(),
      service: metadata.service || 'commerce-core',
      actor: metadata.actor || null,
      requestId: metadata.requestId || null,
      ...metadata
    }
  };
}

/**
 * Simple in-process and cross-service EventEmitter bus
 */
export class PlatformEventBus {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * @param {string} eventType
   * @param {Function} handler
   */
  subscribe(eventType, handler) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(handler);
    return () => this.unsubscribe(eventType, handler);
  }

  /**
   * @param {string} eventType
   * @param {Function} handler
   */
  unsubscribe(eventType, handler) {
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Publishes an event to registered local listeners
   * @param {Object} event
   */
  async publish(event) {
    const handlers = this.listeners.get(event.type) || new Set();
    const wildcards = this.listeners.get('*') || new Set();

    const promises = [];
    for (const handler of [...handlers, ...wildcards]) {
      try {
        promises.push(Promise.resolve(handler(event)));
      } catch (err) {
        console.error(`[EventBus] Handler error for ${event.type}:`, err);
      }
    }
    await Promise.allSettled(promises);
  }
}

export const globalEventBus = new PlatformEventBus();
