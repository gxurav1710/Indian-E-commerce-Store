import { ObserverSource, ObservationAttributionStatus, toPaise, calculateObservationFingerprint } from '@youpi/common';

/**
 * Intelligent Monetary Amount Extractor.
 * Extracts amounts with prefix (Rs. 20.00, INR 500), suffix (20.00 Rs),
 * proximity words ("20.00 received", "received 20.00", "credited 20"),
 * or clean standalone decimal amounts ("20.00").
 * @param {string} text
 * @returns {bigint | null}
 */
export function extractIntelligentPaise(text) {
  if (!text || typeof text !== 'string') return null;

  // Pattern 1: Standard currency prefix (e.g. Rs. 20.00, Rs 200, INR 500.00, ₹1,200.50, ₹20)
  const prefixMatch = text.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (prefixMatch && prefixMatch[1]) {
    const clean = prefixMatch[1].replace(/,/g, '');
    try { return toPaise(clean); } catch {}
  }

  // Pattern 2: Standard currency suffix (e.g. 20.00 Rs, 20.00 INR, 20rs, 500 inr)
  const suffixMatch = text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)/i);
  if (suffixMatch && suffixMatch[1]) {
    const clean = suffixMatch[1].replace(/,/g, '');
    try { return toPaise(clean); } catch {}
  }

  // Pattern 3: Number in proximity to credit keywords (e.g. "20.00 received", "received 20.00", "credited 20", "20.00 credited")
  const creditProximityMatch = text.match(/(?:credited|received|deposit|payment|paid|transferred|upi|cr)[\s\w:]*?([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)[\s\w:]*?(?:credited|received|deposit|payment|paid|transferred|upi|cr)/i);
  if (creditProximityMatch) {
    const rawVal = creditProximityMatch[1] || creditProximityMatch[2];
    if (rawVal) {
      const clean = rawVal.replace(/,/g, '');
      if (/^\d+(\.\d{1,2})?$/.test(clean) && Number(clean) < 10000000 && Number(clean) > 0) {
        try { return toPaise(clean); } catch {}
      }
    }
  }

  // Pattern 4: Standalone decimal currency number (e.g. 20.00, 150.50, 449.00)
  const standaloneDecimal = text.match(/\b(\d{1,6}\.\d{2})\b/);
  if (standaloneDecimal && standaloneDecimal[1]) {
    try { return toPaise(standaloneDecimal[1]); } catch {}
  }

  return null;
}

/**
 * Regex for extracting bank UTR / Reference numbers.
 * Matches: UTR: 123456789012, Ref 123456789012, Txn: ABC123XYZ, RRN: 987654
 */
const REFERENCE_REGEX = /(?:utr|ref|txn|rrn|reference)[:\s#]+([a-zA-Z0-9\-_]{6,35})/i;

/**
 * Regex for extracting sender VPA if present in notification text.
 * Matches: from user@upi, from 9876543210@paytm, etc.
 */
const SENDER_VPA_REGEX = /(?:from|by)\s+([a-zA-Z0-9.\-_]{2,100}@[a-zA-Z0-9.\-_]{2,64})/i;

export class ObservationNormalizer {
  /**
   * Normalizes raw incoming data from any observation source into a canonical observation record.
   * @param {{
   *   source: string,
   *   receivingAccountId: string,
   *   rawPayload: Record<string, any>,
   *   amountPaise?: bigint | number | string,
   *   amount?: string | number,
   *   observedAt?: Date | string,
   *   senderVpa?: string,
   *   bankReferenceNumber?: string
   * }} input
   * @returns {{
   *   receivingAccountId: string,
   *   source: string,
   *   amountPaise: bigint,
   *   observedAt: Date,
   *   senderVpa?: string,
   *   bankReferenceNumber?: string,
   *   fingerprintHash: string,
   *   attributionStatus: string,
   *   rawPayload: Record<string, any>
   * }}
   */
  static normalize(input) {
    if (!input.receivingAccountId) {
      throw new Error('Observation normalization failed: receivingAccountId is required.');
    }
    if (!input.source || !Object.values(ObserverSource).includes(input.source)) {
      throw new Error(`Observation normalization failed: invalid or unknown source '${input.source}'.`);
    }

    const payload = input.rawPayload || {};
    const textContent = (payload.text || payload.body || payload.notificationText || payload.snippet || '').toString();

    // 1. Resolve Amount using priority resolution: explicit paise -> explicit amount -> intelligent multi-pattern extraction
    let finalAmountPaise;
    if (input.amountPaise !== undefined && input.amountPaise !== null && input.amountPaise !== '') {
      finalAmountPaise = BigInt(input.amountPaise);
    } else if (input.amount !== undefined && input.amount !== null && input.amount !== '') {
      finalAmountPaise = toPaise(input.amount);
    } else {
      const extracted = extractIntelligentPaise(textContent);
      if (!extracted) {
        throw new Error(`Observation normalization failed: could not extract valid monetary amount from payload text: "${textContent}"`);
      }
      finalAmountPaise = extracted;
    }

    // 2. Resolve Observed Timestamp
    let observedAtDate;
    if (input.observedAt) {
      observedAtDate = input.observedAt instanceof Date ? input.observedAt : new Date(input.observedAt);
    } else if (payload.timestamp || payload.postTime || payload.date) {
      const rawTs = payload.timestamp || payload.postTime || payload.date;
      observedAtDate = new Date(typeof rawTs === 'number' ? rawTs : rawTs.toString());
    } else {
      observedAtDate = new Date();
    }

    if (isNaN(observedAtDate.getTime())) {
      observedAtDate = new Date();
    }

    // 3. Resolve Reference Number / UTR
    let bankRef = input.bankReferenceNumber;
    if (!bankRef && textContent) {
      const refMatch = textContent.match(REFERENCE_REGEX);
      if (refMatch && refMatch[1]) {
        bankRef = refMatch[1].trim();
      }
    }

    // 4. Resolve Sender VPA
    let senderVpa = input.senderVpa;
    if (!senderVpa && textContent) {
      const vpaMatch = textContent.match(SENDER_VPA_REGEX);
      if (vpaMatch && vpaMatch[1]) {
        senderVpa = vpaMatch[1].trim().replace(/[.,;]+$/, '');
      }
    }

    // 5. Compute Deterministic Fingerprint
    const fingerprintHash = calculateObservationFingerprint({
      receivingAccountId: input.receivingAccountId,
      amountPaise: finalAmountPaise,
      source: input.source,
      bankReferenceNumber: bankRef,
      observedAt: observedAtDate
    });

    return {
      receivingAccountId: input.receivingAccountId,
      source: input.source,
      amountPaise: finalAmountPaise,
      observedAt: observedAtDate,
      senderVpa: senderVpa || undefined,
      bankReferenceNumber: bankRef || undefined,
      fingerprintHash,
      attributionStatus: ObservationAttributionStatus.UNATTRIBUTED,
      rawPayload: payload
    };
  }
}
