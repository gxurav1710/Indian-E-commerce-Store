// Centralized Service Port Topology & URL Resolver
// Guarantees zero port conflicts across all services in the Unified Platform

export const PORTS = Object.freeze({
  STOREFRONT: Number(process.env.STOREFRONT_PORT || 5000),
  COMMERCE_API: Number(process.env.COMMERCE_API_PORT || 5001),
  // Centralized Shipping Engine Service
  SHIPPING_SERVICE: Number(process.env.SHIPPING_SERVICE_PORT || 5003),
  NOTIFICATION_SERVICE: Number(process.env.NOTIFICATION_SERVICE_PORT || 5002),
  ADMIN_PANEL: Number(process.env.ADMIN_PANEL_PORT || 5050),
  CORE_HANDLER: Number(process.env.CORE_HANDLER_PORT || 8085),
  CONTROL_CENTER: Number(process.env.CONTROL_CENTER_PORT || 8090),

  // WhatsApp Authentication Services
  WHATSAPP_AUTH_API: Number(process.env.WHATSAPP_AUTH_API_PORT || 4000),
  WHATSAPP_WORKER: Number(process.env.WHATSAPP_WORKER_PORT || 4001),
  WHATSAPP_DASHBOARD: Number(process.env.WHATSAPP_DASHBOARD_PORT || 4002),

  // Payment Gateway (YouPi PG) Services
  PAYMENT_API: Number(process.env.PAYMENT_API_PORT || 6100),
  CHECKOUT_PORTAL: Number(process.env.CHECKOUT_PORTAL_PORT || 7000),
  MERCHANT_ADMIN: Number(process.env.MERCHANT_ADMIN_PORT || 6001),
  SMS_OBSERVER: Number(process.env.SMS_OBSERVER_PORT || 6002),
  GMAIL_OBSERVER: Number(process.env.GMAIL_OBSERVER_PORT || 6003),
  PAYMENT_HELP: Number(process.env.PAYMENT_HELP_PORT || 3005)
});

export const URLS = {
  get STOREFRONT() { return (process.env.STOREFRONT_URL || `http://localhost:${PORTS.STOREFRONT}`).replace(/\/+$/, ''); },
  get COMMERCE_API() { return (process.env.COMMERCE_API_URL || `http://localhost:${PORTS.COMMERCE_API}`).replace(/\/+$/, ''); },
  get SHIPPING_SERVICE() { return (process.env.SHIPPING_SERVICE_URL || `http://localhost:${PORTS.SHIPPING_SERVICE || 5003}`).replace(/\/+$/, ''); },
  get NOTIFICATION_SERVICE() { return (process.env.NOTIFICATION_SERVICE_URL || `http://localhost:${PORTS.NOTIFICATION_SERVICE}`).replace(/\/+$/, ''); },
  get ADMIN_PANEL() { return (process.env.ADMIN_PANEL_URL || `http://localhost:${PORTS.ADMIN_PANEL}`).replace(/\/+$/, ''); },
  get CORE_HANDLER() { return (process.env.CORE_HANDLER_URL || `http://localhost:${PORTS.CORE_HANDLER}`).replace(/\/+$/, ''); },
  get CONTROL_CENTER() { return (process.env.CONTROL_CENTER_URL || `http://localhost:${PORTS.CONTROL_CENTER}`).replace(/\/+$/, ''); },

  get WHATSAPP_AUTH_API() { return (process.env.WHATSAPP_AUTH_API_URL || `http://localhost:${PORTS.WHATSAPP_AUTH_API}`).replace(/\/+$/, ''); },
  get WHATSAPP_WORKER() { return (process.env.WHATSAPP_WORKER_URL || `http://localhost:${PORTS.WHATSAPP_WORKER}`).replace(/\/+$/, ''); },
  get WHATSAPP_DASHBOARD() { return (process.env.WHATSAPP_DASHBOARD_URL || `http://localhost:${PORTS.WHATSAPP_DASHBOARD}`).replace(/\/+$/, ''); },

  get PAYMENT_API() { return (process.env.BASE_PAYMENT_API_URL || `http://localhost:${PORTS.PAYMENT_API}`).replace(/\/+$/, ''); },
  get CHECKOUT_PORTAL() { return (process.env.BASE_CHECKOUT_URL || `http://localhost:${PORTS.CHECKOUT_PORTAL}`).replace(/\/+$/, ''); },
  get MERCHANT_ADMIN() { return (process.env.BASE_ADMIN_URL || `http://localhost:${PORTS.MERCHANT_ADMIN}`).replace(/\/+$/, ''); }
};

export const INTERNAL_URLS = {
  get STOREFRONT() { return `http://127.0.0.1:${PORTS.STOREFRONT}`; },
  get COMMERCE_API() { return `http://127.0.0.1:${PORTS.COMMERCE_API}`; },
  get SHIPPING_SERVICE() { return `http://127.0.0.1:${PORTS.SHIPPING_SERVICE || 5003}`; },
  get NOTIFICATION_SERVICE() { return `http://127.0.0.1:${PORTS.NOTIFICATION_SERVICE}`; },
  get ADMIN_PANEL() { return `http://127.0.0.1:${PORTS.ADMIN_PANEL}`; },
  get CORE_HANDLER() { return `http://127.0.0.1:${PORTS.CORE_HANDLER}`; },
  get CONTROL_CENTER() { return `http://127.0.0.1:${PORTS.CONTROL_CENTER}`; },
  get WHATSAPP_AUTH_API() { return `http://127.0.0.1:${PORTS.WHATSAPP_AUTH_API}`; },
  get WHATSAPP_WORKER() { return `http://127.0.0.1:${PORTS.WHATSAPP_WORKER}`; },
  get WHATSAPP_DASHBOARD() { return `http://127.0.0.1:${PORTS.WHATSAPP_DASHBOARD}`; },
  get PAYMENT_API() { return `http://127.0.0.1:${PORTS.PAYMENT_API}`; },
  get CHECKOUT_PORTAL() { return `http://127.0.0.1:${PORTS.CHECKOUT_PORTAL}`; },
  get MERCHANT_ADMIN() { return `http://127.0.0.1:${PORTS.MERCHANT_ADMIN}`; }
};

