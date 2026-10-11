import { toPaise } from '@youpi/common';

/**
 * Intelligent Monetary Amount Extractor for Indian UPI & Bank SMS.
 * Extracts amounts with prefix (Rs. 200, INR 500, ₹50), suffix (20.00 Rs),
 * proximity words ("20.00 received", "credited with 20.00"),
 * or standalone decimal amounts ("20.00").
 * @param {string} text
 * @returns {{ amountStr: string, amountPaise: bigint } | null}
 */
export function extractIntelligentAmount(text) {
  if (!text || typeof text !== 'string') return null;

  // Pattern 1: Standard currency prefix (e.g. Rs 499, Rs. 499, ₹499, INR 499, Rs. 20.00, ₹1,200.50)
  const prefixMatch = text.match(/(?:(?:rs\.?|inr)\b|₹)[\s:=-]*([\d,]+(?:\.\d{1,2})?)/i);
  if (prefixMatch && prefixMatch[1]) {
    const clean = prefixMatch[1].replace(/,/g, '');
    try {
      return { amountStr: clean, amountPaise: toPaise(clean) };
    } catch {}
  }

  // Pattern 2: Standard currency suffix (e.g. 499 Rs, 499.00 INR, 20.00 Rs, 20rs, 500 inr)
  const suffixMatch = text.match(/(?:^|[^\w.])([\d,]+(?:\.\d{1,2})?)[\s:=-]*(?:(?:rs\.?|inr)\b|₹)/i);
  if (suffixMatch && suffixMatch[1]) {
    const clean = suffixMatch[1].replace(/,/g, '');
    try {
      return { amountStr: clean, amountPaise: toPaise(clean) };
    } catch {}
  }

  // Pattern 3: Number adjacent to credit keywords (e.g. "20.00 received", "received 20.00", "credited 20", "20.00 credited")
  const creditProximityMatch = text.match(/(?:credited|received|deposit|payment|paid|transferred|upi|cr)[\s\w:]*?([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)[\s\w:]*?(?:credited|received|deposit|payment|paid|transferred|upi|cr)/i);
  if (creditProximityMatch) {
    const rawVal = creditProximityMatch[1] || creditProximityMatch[2];
    if (rawVal) {
      const clean = rawVal.replace(/,/g, '');
      if (/^\d+(\.\d{1,2})?$/.test(clean) && Number(clean) < 10000000 && Number(clean) > 0) {
        try {
          return { amountStr: clean, amountPaise: toPaise(clean) };
        } catch {}
      }
    }
  }

  // Pattern 4: Standalone decimal currency number (e.g. 20.00, 150.50, 449.00)
  const standaloneDecimal = text.match(/\b(\d{1,6}\.\d{2})\b/);
  if (standaloneDecimal && standaloneDecimal[1]) {
    const clean = standaloneDecimal[1];
    try {
      return { amountStr: clean, amountPaise: toPaise(clean) };
    } catch {}
  }

  return null;
}

/**
 * Bank and UPI SMS parser for Indian financial institutions:
 * SBI, HDFC, ICICI, Axis, Kotak, PNB, Bank of Baroda, Paytm Payments Bank, PhonePe, GPay, etc.
 */
export class BankSmsParser {
  /**
   * Parses incoming SMS message text.
   * @param {{
   *   text: string,
   *   sender?: string,
   *   timestamp?: Date | number | string
   * }} sms
   * @returns {{
   *   amountPaise: bigint,
   *   amount: string,
   *   bankReferenceNumber?: string,
   *   senderVpa?: string,
   *   observedAt: Date,
   *   rawText: string
   * } | null}
   */
  static parse(sms) {
    const text = (sms.text || '').trim();
    if (!text) return null;

    // Check if SMS represents an incoming credit
    const creditKeywords = /(credited|received|deposit|payment received|payment|upi\/cr|transferred)/i;
    if (!creditKeywords.test(text)) {
      return null;
    }

    // Ignore pure debits
    if (/(debited|withdrawn|sent rs|paid rs)/i.test(text) && !/(credited|received|deposit)/i.test(text)) {
      return null;
    }

    // 1. Extract Amount using Intelligent Multi-Pattern Extractor
    const extractedAmount = extractIntelligentAmount(text);
    if (!extractedAmount) {
      return null;
    }

    // 2. Extract Bank Reference / UTR / RRN
    let bankRef;
    const utrPatterns = [
      /(?:upi\s*ref(?:erence)?\s*(?:no\.?|num)?|utr(?:\s*no\.?)?|rrn(?:\s*no\.?)?|txn\s*(?:id|ref)?|ref\s*no\.?)[\s:=-]+([a-zA-Z0-9]{6,25})/i,
      /(?:ref(?:\s*no)?\s*[:#\s]?\s*)([a-zA-Z0-9]{8,22})/i,
      /\b([0-9]{12})\b/
    ];

    for (const pat of utrPatterns) {
      const match = text.match(pat);
      if (match && match[1]) {
        bankRef = match[1].trim();
        break;
      }
    }

    // 3. Extract Sender VPA
    let senderVpa;
    const vpaMatch = text.match(/(?:from|by|vpa)\s+([a-zA-Z0-9.\-_]{2,64}@[a-zA-Z0-9.\-_]{2,32})/i);
    if (vpaMatch && vpaMatch[1]) {
      senderVpa = vpaMatch[1].trim().replace(/[.,;]+$/, '');
    }

    // 4. Resolve Observation Timestamp
    let observedAt = new Date();
    if (sms.timestamp) {
      const parsed = new Date(sms.timestamp);
      if (!isNaN(parsed.getTime())) {
        observedAt = parsed;
      }
    }

    return {
      amountPaise: extractedAmount.amountPaise,
      amount: extractedAmount.amountStr,
      bankReferenceNumber: bankRef,
      senderVpa,
      observedAt,
      rawText: text
    };
  }
}
