// Canonical Internal Customer Identity Model & Identity Mapper
// Complies with Section 6 & 19 of the Master Build Specification

/**
 * @typedef {Object} CanonicalUser
 * @property {string} userId - Unique canonical internal user ID (e.g. USR_xxxxxxxx)
 * @property {string} name - Customer display/full name
 * @property {string} mobile - Customer mobile phone number (E.164 formatted, e.g. +919876543210)
 * @property {string} email - Customer email address (normalized lowercase)
 * @property {string} [role] - 'CUSTOMER' | 'ADMIN' | 'SUPPORT'
 * @property {string} [status] - 'ACTIVE' | 'SUSPENDED'
 * @property {string} [createdAt] - ISO timestamp
 */

/**
 * Normalizes phone numbers to standard E.164-like format (e.g. +91XXXXXXXXXX)
 * @param {string} phone
 * @returns {string}
 */
export function normalizePhoneNumber(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  // Default to +91 if 10-digit Indian number without country code
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  return `+${cleaned}`;
}

/**
 * Normalizes email address
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

/**
 * Maps provider identities to the canonical user
 * Global User
 *  ├── Store identity (session, cart, profile)
 *  ├── WhatsApp identity (phone number anchor, attempt id)
 *  └── Payment identity (YouPi customer_id)
 */
export class IdentityResolver {
  /**
   * Generates a new canonical user ID
   * @returns {string}
   */
  static generateCanonicalUserId() {
    const randomHex = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `USR_${randomHex}`;
  }

  /**
   * Creates a standardized CanonicalUser object
   * @param {Object} params
   * @param {string} [params.userId]
   * @param {string} params.name
   * @param {string} params.mobile
   * @param {string} params.email
   * @param {string} [params.role]
   * @param {string} [params.status]
   * @returns {CanonicalUser}
   */
  static createCanonicalUser({ userId, name, mobile, email, role = 'CUSTOMER', status = 'ACTIVE' }) {
    return {
      userId: userId || this.generateCanonicalUserId(),
      name: (name || '').trim(),
      mobile: normalizePhoneNumber(mobile),
      email: normalizeEmail(email),
      role,
      status,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Maps a YouPi Payment Gateway customer record to the Canonical User
   * @param {Object} paymentCustomer
   * @param {string} canonicalUserId
   * @returns {Object}
   */
  static mapPaymentIdentity(paymentCustomer, canonicalUserId) {
    return {
      canonicalUserId,
      paymentCustomerId: paymentCustomer.id,
      name: paymentCustomer.name,
      mobile: normalizePhoneNumber(paymentCustomer.mobile_number || paymentCustomer.mobile),
      email: normalizeEmail(paymentCustomer.email)
    };
  }

  /**
   * Maps a WhatsApp Auth verification to the Canonical User
   * @param {Object} whatsappAuth
   * @param {string} [existingUserId]
   * @returns {CanonicalUser}
   */
  static mapWhatsAppIdentity(whatsappAuth, existingUserId) {
    return {
      userId: existingUserId || this.generateCanonicalUserId(),
      name: whatsappAuth.fullName || whatsappAuth.name || 'WhatsApp User',
      mobile: normalizePhoneNumber(whatsappAuth.phoneNumber || whatsappAuth.mobile),
      email: normalizeEmail(whatsappAuth.email || `${normalizePhoneNumber(whatsappAuth.phoneNumber || whatsappAuth.mobile).replace('+', '')}@whatsapp.user`),
      role: 'CUSTOMER',
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    };
  }
}
