/**
 * Financial utilities enforcing integer minor units (paise).
 * Floating-point representation is strictly forbidden in financial calculations.
 * 1 INR = 100 paise.
 */

/**
 * Converts a rupee amount (string or number) into integer paise (bigint).
 * Throws an error if invalid, negative, zero, or exceeds 2 decimal places.
 * @param {string | number} rupees
 * @returns {bigint}
 */
export function toPaise(rupees) {
  if (typeof rupees === 'number') {
    if (!Number.isFinite(rupees) || Number.isNaN(rupees)) {
      throw new Error(`Invalid monetary amount: ${rupees}`);
    }
    rupees = rupees.toString();
  }

  const clean = String(rupees).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) {
    throw new Error(`Invalid INR rupee format: "${rupees}". Must be non-negative with max 2 decimals.`);
  }

  const parts = clean.split('.');
  const whole = BigInt(parts[0] || '0');
  const fractionStr = parts[1] || '';
  const fraction = BigInt(fractionStr.padEnd(2, '0'));

  const totalPaise = whole * 100n + fraction;
  if (totalPaise <= 0n) {
    throw new Error(`Monetary amount must be strictly greater than 0: ${rupees}`);
  }

  return totalPaise;
}

/**
 * Formats integer paise into a standard decimal string ("200.00").
 * @param {bigint | number} paise
 * @returns {string}
 */
export function toRupeesString(paise) {
  const p = typeof paise === 'number' ? BigInt(Math.floor(paise)) : BigInt(paise);
  if (p < 0n) {
    throw new Error(`Negative paise value not permitted: ${p}`);
  }

  const whole = p / 100n;
  const fraction = p % 100n;
  return `${whole}.${fraction.toString().padStart(2, '0')}`;
}

/**
 * Formats integer paise into a localized INR display string ("₹200.00").
 * @param {bigint | number} paise
 * @returns {string}
 */
export function formatINR(paise) {
  return `₹${toRupeesString(paise)}`;
}
