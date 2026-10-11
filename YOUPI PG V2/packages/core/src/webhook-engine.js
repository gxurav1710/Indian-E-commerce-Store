import crypto from 'node:crypto';
import { generateHmac, toRupeesString } from '@youpi/common';
import { isTerminalStatus, toPublicOutcome } from './state-machine.js';

export class WebhookEngine {
  /**
   * @param {{
   *   db: import('@youpi/db').Database,
   *   merchantRepo: import('@youpi/db').MerchantRepository,
   *   maxRetries?: number
   * }} options
   */
  constructor(options) {
    this.db = options.db;
    this.merchantRepo = options.merchantRepo;
    this.maxRetries = options.maxRetries || 5;
  }

  /**
   * Formats and dispatches a signed webhook for a payment event.
   * @param {string} event E.g. 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED'
   * @param {any} session The payment session entity
   * @returns {Promise<{ delivered: boolean, deliveryId: string, status?: number, error?: string }>}
   */
  async dispatch(event, session) {
    const merchant = this.merchantRepo.findById(session.merchantId);
    if (!merchant || !merchant.webhookUrl) {
      return { delivered: false, deliveryId: '', error: 'No webhook URL configured for merchant.' };
    }

    const publicOutcome = isTerminalStatus(event) ? toPublicOutcome(event) : event;

    const payloadObj = {
      event: publicOutcome,
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(session.amountPaise),
      amountPaise: Number(session.amountPaise),
      currency: session.currency || 'INR',
      method: session.method || 'UPI',
      completedAt: session.completedAt ? session.completedAt.toISOString() : new Date().toISOString(),
      metadata: session.metadata || {}
    };

    const payloadString = JSON.stringify(payloadObj);
    const signature = generateHmac(payloadString, merchant.webhookSecret);
    const deliveryId = crypto.randomUUID();
    const timestamp = Date.now().toString();

    const headers = {
      'Content-Type': 'application/json',
      'X-Gateway-Event': publicOutcome,
      'X-Gateway-Signature': `sha256=${signature}`,
      'X-Gateway-Delivery-Id': deliveryId,
      'X-Gateway-Timestamp': timestamp
    };

    let responseStatus = null;
    let responseBody = null;
    let isSuccessful = false;

    try {
      const res = await fetch(merchant.webhookUrl, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: AbortSignal.timeout(10000) // 10s timeout
      });

      responseStatus = res.status;
      responseBody = (await res.text()).substring(0, 1000);
      isSuccessful = res.ok;
    } catch (err) {
      responseBody = err.message || 'Network timeout';
    }

    // Persist delivery record in webhook_deliveries
    const nowIso = new Date().toISOString();
    const nextRetryAt = isSuccessful
      ? null
      : new Date(Date.now() + 5000).toISOString(); // initial 5s backoff

    this.db.execute(`
      INSERT INTO webhook_deliveries (
        id, merchant_id, payment_id, event_type, payload, endpoint_url,
        response_status, response_body, attempt_count, is_successful, next_retry_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `, [
      deliveryId,
      merchant.id,
      session.id,
      publicOutcome,
      payloadString,
      merchant.webhookUrl,
      responseStatus,
      responseBody,
      isSuccessful ? 1 : 0,
      nextRetryAt,
      nowIso
    ]);

    return {
      delivered: isSuccessful,
      deliveryId,
      status: responseStatus,
      error: isSuccessful ? undefined : responseBody
    };
  }

  /**
   * Retries overdue pending webhook deliveries with exponential backoff.
   * Backoff strategy: 5s, 30s, 2m, 10m, 1h
   */
  async retryPending() {
    const nowIso = new Date().toISOString();
    const pending = this.db.query(`
      SELECT * FROM webhook_deliveries
      WHERE is_successful = 0 AND attempt_count < ? AND next_retry_at <= ?
      LIMIT 20
    `, [this.maxRetries, nowIso]);

    const results = [];
    const backoffs = [5000, 30000, 120000, 600000, 3600000];

    for (const item of pending) {
      const merchant = this.merchantRepo.findById(item.merchant_id);
      if (!merchant || !item.endpoint_url) continue;

      const signature = generateHmac(item.payload, merchant.webhookSecret);
      const timestamp = Date.now().toString();

      let isSuccess = false;
      let respStatus = null;
      let respBody = null;

      try {
        const res = await fetch(item.endpoint_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Event': item.event_type,
            'X-Gateway-Signature': `sha256=${signature}`,
            'X-Gateway-Delivery-Id': item.id,
            'X-Gateway-Timestamp': timestamp
          },
          body: item.payload,
          signal: AbortSignal.timeout(10000)
        });
        respStatus = res.status;
        respBody = (await res.text()).substring(0, 1000);
        isSuccess = res.ok;
      } catch (err) {
        respBody = err.message;
      }

      const nextAttempt = item.attempt_count + 1;
      const nextRetryDelay = backoffs[Math.min(nextAttempt - 1, backoffs.length - 1)];
      const nextRetryAt = isSuccess || nextAttempt >= this.maxRetries
        ? null
        : new Date(Date.now() + nextRetryDelay).toISOString();

      this.db.execute(`
        UPDATE webhook_deliveries
        SET attempt_count = ?, is_successful = ?, response_status = ?,
            response_body = ?, next_retry_at = ?
        WHERE id = ?
      `, [nextAttempt, isSuccess ? 1 : 0, respStatus, respBody, nextRetryAt, item.id]);

      results.push({ id: item.id, success: isSuccess, attempt: nextAttempt });
    }

    return results;
  }
}
