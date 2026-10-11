export class OrdersRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  generateOrderNumber() {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${dateStr}-${rand}`;
  }

  createOrder(data, items = []) {
    const id = data.id || `ORD_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const orderNumber = data.orderNumber || this.generateOrderNumber();

    const existing = this.findById(id) || this.findByOrderNumber(orderNumber);
    if (existing) {
      return this.getOrderFullDetails(existing.id);
    }

    return this.db.transaction(() => {
      const sql = `
        INSERT INTO orders (
          id, order_number, user_id, customer_name, customer_email, customer_mobile,
          shipping_address, billing_address, total_amount, subtotal_amount, discount_amount,
          shipping_fee, tax_amount, payment_method, payment_status, order_status, notes,
          coupon_code, manual_payment_verified, payment_verified_at, payment_window_start, payment_window_end, payment_gateway_id,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
          datetime('now'), datetime('now')
        )
      `;

      this.db.execute(sql, [
        id,
        orderNumber,
        data.userId,
        data.customerName,
        data.customerEmail,
        data.customerMobile,
        JSON.stringify(data.shippingAddress || {}),
        JSON.stringify(data.billingAddress || data.shippingAddress || {}),
        Number(data.totalAmount),
        Number(data.subtotalAmount || data.totalAmount),
        Number(data.discountAmount || 0),
        Number(data.shippingFee || 0),
        Number(data.taxAmount || 0),
        data.paymentMethod || 'UPI',
        data.paymentStatus || 'PENDING',
        data.orderStatus || 'PLACED',
        data.notes || null,
        data.couponCode || data.coupon_code || null,
        data.manualPaymentVerified ? 1 : 0,
        data.paymentVerifiedAt || null,
        data.paymentWindowStart || new Date().toISOString(),
        data.paymentWindowEnd || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        data.paymentGatewayId || null
      ]);

      // Insert line items
      for (const item of items) {
        const itemId = `OI_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        this.db.execute(
          `INSERT INTO order_items (
            id, order_id, product_id, variant_id, sku, product_name, variant_name,
            quantity, unit_price, total_price, image_url, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, datetime('now'))`,
          [
            itemId,
            id,
            (item.productId && this.db.queryOne('SELECT id FROM products WHERE id = $1', [item.productId])) ? item.productId : null,
            item.variantId || null,
            item.sku || 'SKU-UNKNOWN',
            item.name || item.productName || 'Product',
            item.variantName || null,
            Number(item.quantity || 1),
            Number(item.unitPrice || 0),
            Number(item.unitPrice || 0) * Number(item.quantity || 1),
            item.imageUrl || null
          ]
        );

        // Deduct inventory
        if (item.variantId) {
          this.db.execute(
            "UPDATE product_variants SET stock = MAX(0, stock - $1), updated_at = datetime('now') WHERE id = $2",
            [item.quantity || 1, item.variantId]
          );
          this.db.execute(
            "UPDATE products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = $1), updated_at = datetime('now') WHERE id = $1",
            [item.productId]
          );
        } else {
          this.db.execute(
            "UPDATE products SET stock = MAX(0, stock - $1), updated_at = datetime('now') WHERE id = $2",
            [item.quantity || 1, item.productId]
          );
        }
      }

      // Initial status history entry
      this.db.execute(
        `INSERT INTO order_status_history (
          id, order_id, previous_status, new_status, comment, actor_type, actor_id, created_at
        ) VALUES ($1, $2, NULL, $3, $4, $5, $6, datetime('now'))`,
        [
          `OSH_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          id,
          data.orderStatus || 'PLACED',
          'Order placed by customer',
          'CUSTOMER',
          data.userId
        ]
      );

      // Create initial shipment record
      this.db.execute(
        `INSERT INTO shipments (
          id, order_id, tracking_number, carrier, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'PENDING', datetime('now'), datetime('now'))`,
        [
          `SHIP_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          id,
          `TRK-${orderNumber.replace('ORD-', '')}`,
          'BlueDart Express'
        ]
      );

      return this.getOrderFullDetails(id);
    });
  }

  findById(id) {
    return this.db.queryOne('SELECT * FROM orders WHERE id = $1', [id]);
  }

  findByOrderNumber(orderNumber) {
    return this.db.queryOne('SELECT * FROM orders WHERE order_number = $1', [orderNumber]);
  }

  list({ userId, orderStatus, paymentStatus, search, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (userId) {
      sql += ' AND user_id = $' + (params.length + 1);
      params.push(userId);
    }
    if (orderStatus) {
      sql += ' AND order_status = $' + (params.length + 1);
      params.push(orderStatus);
    }
    if (paymentStatus) {
      sql += ' AND payment_status = $' + (params.length + 1);
      params.push(paymentStatus);
    }
    if (search) {
      const q = `%${search.toLowerCase().trim()}%`;
      const i1 = params.length + 1;
      const i2 = params.length + 2;
      const i3 = params.length + 3;
      const i4 = params.length + 4;
      sql += ` AND (LOWER(order_number) LIKE $${i1} OR LOWER(customer_name) LIKE $${i2} OR LOWER(customer_email) LIKE $${i3} OR customer_mobile LIKE $${i4})`;
      params.push(q, q, q, q);
    }

    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const orders = this.db.query(sql, params);
    return orders.map(o => ({
      ...o,
      shipping_address: typeof o.shipping_address === 'string' ? JSON.parse(o.shipping_address || '{}') : o.shipping_address,
      billing_address: typeof o.billing_address === 'string' ? JSON.parse(o.billing_address || '{}') : o.billing_address
    }));
  }

  updateStatus(orderId, newStatus, comment = '', actorType = 'SYSTEM', actorId = null) {
    const current = this.findById(orderId) || this.findByOrderNumber(orderId);
    if (!current) throw new Error(`Order not found: ${orderId}`);

    const resolvedId = current.id;
    const prevStatus = current.order_status;
    this.db.transaction(() => {
      this.db.execute(
        "UPDATE orders SET order_status = $1, updated_at = datetime('now') WHERE id = $2",
        [newStatus, resolvedId]
      );

      this.db.execute(
        `INSERT INTO order_status_history (
          id, order_id, previous_status, new_status, comment, actor_type, actor_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))`,
        [
          `OSH_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          resolvedId,
          prevStatus,
          newStatus,
          comment || `Status updated from ${prevStatus} to ${newStatus}`,
          actorType,
          actorId
        ]
      );

      // Update shipment if relevant
      if (newStatus === 'SHIPPED') {
        this.db.execute(
          "UPDATE shipments SET status = 'IN_TRANSIT', shipped_at = datetime('now'), updated_at = datetime('now') WHERE order_id = $1",
          [resolvedId]
        );
      } else if (newStatus === 'DELIVERED') {
        this.db.execute(
          "UPDATE shipments SET status = 'DELIVERED', delivered_at = datetime('now'), updated_at = datetime('now') WHERE order_id = $1",
          [resolvedId]
        );
      }
    });

    return this.getOrderFullDetails(resolvedId);
  }

  updatePaymentStatus(orderId, paymentStatus) {
    this.db.execute(
      "UPDATE orders SET payment_status = $1, updated_at = datetime('now') WHERE id = $2",
      [paymentStatus, orderId]
    );
    return this.findById(orderId);
  }

  /**
   * Approves payment manually in Admin Panel and unlocks all order lifecycle actions.
   * @param {string} orderIdOrNumber
   */
  approvePayment(orderIdOrNumber) {
    this.db.execute(
      `UPDATE orders
       SET manual_payment_verified = 1,
           payment_status = 'PAID',
           payment_verified_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = $1 OR order_number = $1`,
      [orderIdOrNumber]
    );
    return this.getOrderFullDetails(orderIdOrNumber);
  }

  /**
   * Revokes manual payment approval, locking lifecycle actions back down.
   * @param {string} orderIdOrNumber
   */
  revokePayment(orderIdOrNumber) {
    this.db.execute(
      `UPDATE orders
       SET manual_payment_verified = 0,
           payment_verified_at = NULL,
           updated_at = datetime('now')
       WHERE id = $1 OR order_number = $1`,
      [orderIdOrNumber]
    );
    return this.getOrderFullDetails(orderIdOrNumber);
  }

  /**
   * Updates payment window timestamps and gateway session ID.
   * @param {string} orderIdOrNumber
   * @param {{ windowStart?: string, windowEnd?: string, gatewayId?: string }} details
   */
  setPaymentDetails(orderIdOrNumber, { windowStart, windowEnd, gatewayId } = {}) {
    this.db.execute(
      `UPDATE orders
       SET payment_window_start = COALESCE($1, payment_window_start),
           payment_window_end = COALESCE($2, payment_window_end),
           payment_gateway_id = COALESCE($3, payment_gateway_id),
           updated_at = datetime('now')
       WHERE id = $4 OR order_number = $4`,
      [windowStart || null, windowEnd || null, gatewayId || null, orderIdOrNumber]
    );
  }

  /**
   * Consolidated full view for Admin & Customer Order Details (Section 12)
   */
  getOrderFullDetails(orderIdOrNumber) {
    let order = this.findById(orderIdOrNumber);
    if (!order) {
      order = this.findByOrderNumber(orderIdOrNumber);
    }
    if (!order) return null;

    const items = this.db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC', [order.id]);
    const timeline = this.db.query('SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC', [order.id]);
    const shipments = this.db.query('SELECT * FROM shipments WHERE order_id = $1', [order.id]);
    const payments = this.db.query('SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC', [order.id]);
    const customer = this.db.queryOne('SELECT id, name, email, mobile, status FROM users WHERE id = $1', [order.user_id]);
    const cleanPhone = (order.customer_mobile || '').replace(/[^0-9]/g, '');
    const phoneTail = cleanPhone.slice(-10);
    const notifications = this.db.query(
      `SELECT id, channel, event_type, recipient, subject, body, status, sent_at, created_at
       FROM notifications
       WHERE body LIKE $1 OR (user_id IS NOT NULL AND user_id = $2) OR recipient LIKE $3
       ORDER BY created_at DESC`,
      [`%${order.order_number}%`, order.user_id, `%${phoneTail}%`]
    );

    return {
      ...order,
      shipping_address: typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address || '{}') : order.shipping_address,
      billing_address: typeof order.billing_address === 'string' ? JSON.parse(order.billing_address || '{}') : order.billing_address,
      customer,
      items,
      timeline,
      shipments: shipments[0] || null,
      payment: payments[0] || null,
      notifications
    };
  }
}
