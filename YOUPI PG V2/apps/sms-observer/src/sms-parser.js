import { toPaise } from '@youpi/common';

/**
 * Intelligent Monetary Amount Extractor for Indian UPI & Bank SMS.
 * Extracts amounts with prefix (Rs. 200, INR 500), suffix (20.00 Rs),
 * proximity words ("20.00 received", "credited with 20.00"),
 * or standalone decimal amounts ("20.00").
 * @param {string} text
 * @returns {{ amountStr: string, amountPaise: bigint } | null}
 */
export function extractIntelligentAmount(text) {
  if (!text || typeof text !== 'string') return null;

  // Pattern 1: Standard currency prefix (e.g. Rs. 20.00, Rs 200, INR 500.00, ₹1,200.50, ₹20)
  const prefixMatch = text.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (prefixMatch && prefixMatch[1]) {
    const clean = prefixMatch[1].replace(/,/g, '');
    try {
      return { amountStr: clean, amountPaise: toPaise(clean) };
    } catch {}
  }

  // Pattern 2: Standard currency suffix (e.g. 20.00 Rs, 20.00 INR, 20rs, 500 inr)
  const suffixMatch = text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)/i);
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
 * SBI, HDFC, ICICI, Axis, Kotak, PNB, Bank of Baroda, Paytm Payments Bank, etc.
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
    const refMatch = text.match(/(?:utr|ref(?:\s*no)?|txn(?:\s*id)?|rrn)[:\s#]+([a-zA-Z0-9\-_]{6,35})/i);
    if (refMatch && refMatch[1]) {
      bankRef = refMatch[1].trim();
    } else {
      const upiCrMatch = text.match(/UPI\/CR\/([a-zA-Z0-9\-_]+)/i);
      if (upiCrMatch && upiCrMatch[1]) {
        bankRef = upiCrMatch[1].trim();
      }
    }

    // 3. Extract Sender VPA
    let senderVpa;
    let vpaMatch = text.match(/(?:from|by)\s+([a-zA-Z0-9.\-_]{2,100}@[a-zA-Z0-9.\-_]{2,64})/i);
    if (!vpaMatch) {
      vpaMatch = text.match(/([a-zA-Z0-9.\-_]{2,100}@[a-zA-Z0-9.\-_]{2,64})/i);
    }
    if (vpaMatch && vpaMatch[1]) {
      senderVpa = vpaMatch[1].trim().replace(/[.,;]+$/, '');
    }

    // 4. Timestamp
    let observedAt = new Date();
    if (sms.timestamp) {
      const parsedTs = new Date(sms.timestamp);
      if (!isNaN(parsedTs.getTime())) {
        observedAt = parsedTs;
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
