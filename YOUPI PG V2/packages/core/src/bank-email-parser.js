import { toPaise } from '@youpi/common';
import { extractIntelligentAmount } from './bank-sms-parser.js';

export { extractIntelligentAmount };

/**
 * Bank email parser for extracting UPI credit alerts across Indian banks:
 * HDFC, ICICI, SBI, Axis, Kotak, Paytm Payments Bank, custom alt-account transfers, etc.
 */
export class BankEmailParser {
  /**
   * Parses raw email subject and body text into a canonical observation payload.
   * @param {{
   *   subject: string,
   *   body: string,
   *   from?: string,
   *   date?: Date | string
   * }} email
   * @returns {{
   *   amountPaise: bigint,
   *   amount: string,
   *   bankReferenceNumber?: string,
   *   senderVpa?: string,
   *   observedAt: Date,
   *   rawSnippet: string
   * } | null}
   */
  static parse(email) {
    if (!email) return null;
    const combinedText = `${email.subject || ''} ${email.body || ''}`.trim();
    if (!combinedText) return null;

    // Check if email represents an incoming credit/payment
    const creditKeywords = /(credited|credit|received|deposit|payment received|payment|upi\/cr|transferred)/i;
    if (!creditKeywords.test(combinedText)) {
      return null; // Ignore non-credit alerts
    }

    // Ignore pure debit notifications if no credit indicator exists
    if (/(debited|withdrawn|sent rs|paid rs)/i.test(combinedText) && !/(credited|credit|received|deposit)/i.test(combinedText)) {
      return null;
    }

    // 1. Extract Monetary Amount using Intelligent Multi-Pattern Extractor
    const extractedAmount = extractIntelligentAmount(combinedText);
    if (!extractedAmount) {
      return null;
    }

    // 2. Extract Bank Reference / UTR Number
    // Matches: UTR: 123456789012, Ref no: UTR-HDFC-9911, Ref: UTR-GMAIL-777, UPI/CR/123456789/, 12-digit UTR
    let bankRef;
    const refMatch = combinedText.match(/(?:utr|ref(?:\s*no)?|txn(?:\s*id)?|rrn)[:\s#]+([a-zA-Z0-9\-_]{6,35})/i);
    if (refMatch && refMatch[1]) {
      bankRef = refMatch[1].trim();
    } else {
      const upiCrMatch = combinedText.match(/UPI\/CR\/([a-zA-Z0-9\-_]+)/i);
      if (upiCrMatch && upiCrMatch[1]) {
        bankRef = upiCrMatch[1].trim();
      } else {
        const d12Match = combinedText.match(/\b([0-9]{12})\b/);
        if (d12Match && d12Match[1]) {
          bankRef = d12Match[1].trim();
        }
      }
    }

    // 3. Extract Sender VPA
    let senderVpa;
    const vpaMatch = combinedText.match(/(?:from|by|vpa)\s+([a-zA-Z0-9.\-_]{2,100}@[a-zA-Z0-9.\-_]{2,64})/i);
    if (vpaMatch && vpaMatch[1]) {
      senderVpa = vpaMatch[1].trim().replace(/[.,;]+$/, '');
    }

    // 4. Timestamp
    let observedAt = new Date();
    if (email.date) {
      const parsedDate = new Date(email.date);
      if (!isNaN(parsedDate.getTime())) {
        observedAt = parsedDate;
      }
    }

    return {
      amountPaise: extractedAmount.amountPaise,
      amount: extractedAmount.amountStr,
      bankReferenceNumber: bankRef,
      senderVpa,
      observedAt,
      rawSnippet: combinedText.substring(0, 300)
    };
  }
}
