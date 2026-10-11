// Centralized Structured Logging Utility with Secret Redaction & Category Filtering
// Complies with Section 32 of the Master Build Specification

const SENSITIVE_KEYS = [
  'password', 'password_hash', 'secret', 'token', 'access_token', 'jwt',
  'api_key', 'otp', 'code_challenge', 'webhook_secret', 'encryption_master_key',
  'private_key', 'card_number', 'cvv'
];

/**
 * Deeply sanitizes an object to redact sensitive credentials
 * @param {any} data
 * @returns {any}
 */
export function sanitizeData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some(s => lowerKey.includes(s))) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizeData(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Structured Log Entry
 * @typedef {Object} LogEntry
 * @property {string} timestamp - ISO timestamp
 * @property {string} service - Service identifier (e.g. 'commerce-api', 'payment-api')
 * @property {'INFO'|'WARN'|'ERROR'|'DEBUG'} level - Log severity level
 * @property {'all'|'auth'|'payments'|'orders'|'whatsapp'|'system'} category - Filter category
 * @property {string} [event] - Associated event name
 * @property {string} message - Human-readable description
 * @property {string} [userId] - Associated canonical user ID
 * @property {string} [orderId] - Associated order ID
 * @property {string} [transactionId] - Associated transaction ID
 * @property {string} [requestId] - Associated request ID
 * @property {Object} [details] - Sanitized contextual payload
 */

export class CentralLogger {
  /**
   * @param {string} service - Service name
   * @param {Object} [options]
   * @param {number} [options.maxMemoryLogs=1000]
   */
  constructor(service = 'core', options = {}) {
    this.service = service;
    this.maxMemoryLogs = options.maxMemoryLogs || 1000;
    this.memoryLogs = [];
    this.subscribers = new Set();
  }

  /**
   * @param {LogEntry} entry
   */
  log(entry) {
    const fullEntry = {
      timestamp: new Date().toISOString(),
      service: this.service,
      level: entry.level || 'INFO',
      category: entry.category || 'system',
      event: entry.event || null,
      message: entry.message || '',
      userId: entry.userId || null,
      orderId: entry.orderId || null,
      transactionId: entry.transactionId || null,
      requestId: entry.requestId || null,
      details: sanitizeData(entry.details || null)
    };

    // Store in circular buffer
    this.memoryLogs.push(fullEntry);
    if (this.memoryLogs.length > this.maxMemoryLogs) {
      this.memoryLogs.shift();
    }

    // Format console output
    const consolePrefix = `[${fullEntry.timestamp}] [${fullEntry.service}] [${fullEntry.level}] [${fullEntry.category.toUpperCase()}]`;
    if (fullEntry.level === 'ERROR') {
      console.error(consolePrefix, fullEntry.message, fullEntry.details ? fullEntry.details : '');
    } else if (fullEntry.level === 'WARN') {
      console.warn(consolePrefix, fullEntry.message, fullEntry.details ? fullEntry.details : '');
    } else {
      console.log(consolePrefix, fullEntry.message, fullEntry.details ? fullEntry.details : '');
    }

    // Notify live subscribers (e.g. SSE stream for Control Center)
    for (const sub of this.subscribers) {
      try {
        sub(fullEntry);
      } catch {}
    }

    return fullEntry;
  }

  info(message, meta = {}) {
    return this.log({ level: 'INFO', message, ...meta });
  }

  warn(message, meta = {}) {
    return this.log({ level: 'WARN', message, ...meta });
  }

  error(message, meta = {}) {
    return this.log({ level: 'ERROR', message, ...meta });
  }

  debug(message, meta = {}) {
    return this.log({ level: 'DEBUG', message, ...meta });
  }

  /**
   * Filter in-memory logs
   * @param {Object} filter
   * @param {string} [filter.category] - 'all'|'auth'|'payments'|'orders'|'whatsapp'|'system'
   * @param {string} [filter.level] - 'ERROR'|'WARN'|'INFO'
   * @param {string} [filter.search]
   * @param {number} [filter.limit=100]
   * @returns {LogEntry[]}
   */
  getLogs({ category, level, search, limit = 100 } = {}) {
    let results = [...this.memoryLogs];

    if (category && category !== 'all') {
      results = results.filter(l => l.category.toLowerCase() === category.toLowerCase());
    }

    if (level && level !== 'all') {
      results = results.filter(l => l.level.toUpperCase() === level.toUpperCase());
    }

    if (search) {
      const q = search.toLowerCase();
      results = results.filter(l =>
        l.message.toLowerCase().includes(q) ||
        (l.userId && l.userId.toLowerCase().includes(q)) ||
        (l.orderId && l.orderId.toLowerCase().includes(q)) ||
        (l.transactionId && l.transactionId.toLowerCase().includes(q))
      );
    }

    return results.slice(-limit);
  }

  /**
   * Subscribe to new log lines
   * @param {Function} callback
   * @returns {Function} unsubscribe
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

export const defaultLogger = new CentralLogger('unified-ecommerce');
