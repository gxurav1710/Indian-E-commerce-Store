export class PaymentsRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  createPayment(data) {
    const id = data.id || `PAY_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const sql = `
      INSERT INTO payments (
        id, order_id, user_id, gateway, gateway_payment_id, amount, currency,
        method, status, upi_id, verification_tag, idempotency_key, metadata,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        datetime('now'), datetime('now')
      )
    `;

    this.db.execute(sql, [
      id,
      data.orderId,
      data.userId,
      data.gateway || 'YOUPI_PG',
      data.gatewayPaymentId || null,
      Number(data.amount),
      data.currency || 'INR',
      data.method || 'UPI',
      data.status || 'INITIATED',
      data.upiId || null,
      data.verificationTag || 'UNVERIFIED',
      data.idempotencyKey || null,
      JSON.stringify(data.metadata || {})
    ]);

    return this.findById(id);
  }

  findById(id) {
    const payment = this.db.queryOne('SELECT * FROM payments WHERE id = $1', [id]);
    if (!payment) return null;
    return {
      ...payment,
      metadata: typeof payment.metadata === 'string' ? JSON.parse(payment.metadata || '{}') : payment.metadata
    };
  }

  findByOrderId(orderId) {
    const payment = this.db.queryOne('SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [orderId]);
    if (!payment) return null;
    return {
      ...payment,
      metadata: typeof payment.metadata === 'string' ? JSON.parse(payment.metadata || '{}') : payment.metadata
    };
  }

  updateStatus(id, status, verificationTag = null, gatewayResponse = null) {
    const fields = ['status = $1', "updated_at = datetime('now')"];
    const params = [status];

    if (verificationTag) {
      fields.push(`verification_tag = $${params.length + 1}`);
      params.push(verificationTag);
    }

    params.push(id);
    this.db.execute(`UPDATE payments SET ${fields.join(', ')} WHERE id = $${params.length}`, params);

    // Record transaction event
    if (gatewayResponse) {
      this.recordTransaction({
        paymentId: id,
        transactionType: status === 'SUCCESS' ? 'PAYMENT_CAPTURE' : 'PAYMENT_UPDATE',
        amount: this.findById(id)?.amount || 0,
        status,
        gatewayResponse
      });
    }

    return this.findById(id);
  }

  recordTransaction(data) {
    const id = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const sql = `
      INSERT INTO payment_transactions (id, payment_id, transaction_type, amount, status, gateway_response, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, datetime('now'))
    `;
    this.db.execute(sql, [
      id,
      data.paymentId,
      data.transactionType || 'PAYMENT',
      Number(data.amount),
      data.status,
      JSON.stringify(data.gatewayResponse || {})
    ]);
    return this.db.queryOne('SELECT * FROM payment_transactions WHERE id = $1', [id]);
  }

  list({ limit = 50, offset = 0, status = null } = {}) {
    let sql = 'SELECT * FROM payments WHERE 1=1';
    const params = [];
    if (status) {
      sql += ' AND status = $' + (params.length + 1);
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const payments = this.db.query(sql, params);
    return payments.map(p => ({
      ...p,
      metadata: typeof p.metadata === 'string' ? JSON.parse(p.metadata || '{}') : p.metadata
    }));
  }
}
