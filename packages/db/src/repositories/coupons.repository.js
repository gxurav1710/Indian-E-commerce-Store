export class CouponsRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `CPN_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const code = String(data.code || '').trim().toUpperCase();
    if (!code) throw new Error('Coupon code is required');

    const existing = this.findByCode(code);
    if (existing) throw new Error(`Coupon with code '${code}' already exists`);

    const sql = `
      INSERT INTO coupons (
        id, code, name, type, validity_type, valid_from, valid_until,
        user_eligibility, item_eligibility, eligible_items,
        cart_min_value, max_discount, percentage_off, flat_off,
        status, usage_count, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0,
        datetime('now'), datetime('now')
      )
    `;

    this.db.execute(sql, [
      id,
      code,
      data.name || code,
      data.type || 'PERCENTAGE', // 'FREE_DELIVERY' | 'PERCENTAGE' | 'FIXED_AMOUNT'
      data.validityType || data.validity_type || 'UNLIMITED', // 'UNLIMITED' | 'DATE_RANGE'
      data.validFrom || data.valid_from || null,
      data.validUntil || data.valid_until || null,
      data.userEligibility || data.user_eligibility || 'ALL_USERS', // 'ALL_USERS' | 'NEW_USERS_ONLY'
      data.itemEligibility || data.item_eligibility || 'ALL_ITEMS', // 'ALL_ITEMS' | 'SPECIFIC_ITEMS'
      JSON.stringify(data.eligibleItems || data.eligible_items || { productIds: [], variantIds: [] }),
      Number(data.cartMinValue || data.cart_min_value || 0),
      data.maxDiscount !== undefined && data.maxDiscount !== null ? Number(data.maxDiscount) : null,
      Number(data.percentageOff || data.percentage_off || 0),
      Number(data.flatOff || data.flat_off || 0),
      data.status || 'ACTIVE'
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM coupons WHERE id = $1', [id]);
    return this._formatCoupon(row);
  }

  findByCode(code) {
    if (!code) return null;
    const clean = String(code).trim().toUpperCase();
    const row = this.db.queryOne('SELECT * FROM coupons WHERE UPPER(code) = $1', [clean]);
    return this._formatCoupon(row);
  }

  list({ status, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM coupons WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = $' + (params.length + 1);
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const rows = this.db.query(sql, params);
    return rows.map(r => this._formatCoupon(r));
  }

  update(id, data) {
    const fields = [];
    const params = [];

    const allowed = [
      'name', 'type', 'validity_type', 'valid_from', 'valid_until',
      'user_eligibility', 'item_eligibility', 'cart_min_value',
      'max_discount', 'percentage_off', 'flat_off', 'status'
    ];

    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
      const val = data[camel] !== undefined ? data[camel] : data[key];
      if (val !== undefined) {
        fields.push(`${key} = $${params.length + 1}`);
        params.push(val);
      }
    }

    if (data.code) {
      fields.push(`code = $${params.length + 1}`);
      params.push(String(data.code).trim().toUpperCase());
    }

    if (data.eligibleItems !== undefined || data.eligible_items !== undefined) {
      fields.push(`eligible_items = $${params.length + 1}`);
      params.push(JSON.stringify(data.eligibleItems || data.eligible_items || {}));
    }

    fields.push("updated_at = datetime('now')");

    if (fields.length > 1) {
      params.push(id);
      this.db.execute(`UPDATE coupons SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    }

    return this.findById(id);
  }

  delete(id) {
    this.db.execute('DELETE FROM coupons WHERE id = $1', [id]);
  }

  incrementUsage(codeOrId) {
    this.db.execute(
      "UPDATE coupons SET usage_count = usage_count + 1, updated_at = datetime('now') WHERE id = $1 OR UPPER(code) = UPPER($1)",
      [codeOrId]
    );
  }

  /**
   * Comprehensive Coupon Validation & Discount Computation
   * Evaluates all eligibility rules (Dates, Users, Cart Min, Item Whitelists, Caps)
   *
   * @param {Object} params
   * @param {string} params.code - Coupon code
   * @param {string} [params.userId] - Current customer ID
   * @param {Array} [params.items=[]] - Cart items [{ productId, variantId, quantity, unitPrice }]
   * @param {number} params.subtotal - Cart subtotal (items only)
   * @param {number} [params.shippingFee=0] - Active calculated shipping fee
   */
  validateCoupon({ code, userId = null, items = [], subtotal = 0, shippingFee = 0 }) {
    const coupon = this.findByCode(code);
    if (!coupon) {
      return { valid: false, error: `Coupon code '${code}' not found.` };
    }

    if (coupon.status !== 'ACTIVE') {
      return { valid: false, error: `Coupon '${coupon.code}' is no longer active.` };
    }

    // 1. Check Date Range Validity
    const now = new Date();
    if (coupon.validity_type === 'DATE_RANGE') {
      if (coupon.valid_from && new Date(coupon.valid_from) > now) {
        return { valid: false, error: `Coupon '${coupon.code}' is not yet valid.` };
      }
      if (coupon.valid_until && new Date(coupon.valid_until) < now) {
        return { valid: false, error: `Coupon '${coupon.code}' has expired.` };
      }
    }

    // 2. Check User Eligibility (New Users Only vs All Users)
    if (coupon.user_eligibility === 'NEW_USERS_ONLY') {
      if (userId) {
        const orderCount = this.db.queryOne(
          "SELECT COUNT(*) as count FROM orders WHERE user_id = $1 AND order_status != 'CANCELLED'",
          [userId]
        )?.count || 0;

        if (Number(orderCount) > 0) {
          return { valid: false, error: `Coupon '${coupon.code}' is exclusively available for new customers on their first order.` };
        }
      }
    }

    // 3. Check Cart Minimum Value
    const minVal = Number(coupon.cart_min_value || 0);
    if (minVal > 0 && Number(subtotal) < minVal) {
      return {
        valid: false,
        error: `Minimum items subtotal of ₹${minVal.toLocaleString('en-IN')} required for coupon '${coupon.code}'. Add ₹${(minVal - subtotal).toLocaleString('en-IN')} more to qualify.`
      };
    }

    // 4. Check Item / Variant Matrix Eligibility
    let eligibleSubtotal = Number(subtotal || 0);
    if (coupon.item_eligibility === 'SPECIFIC_ITEMS') {
      const eligible = coupon.eligible_items || {};
      const eligibleProdIds = new Set(eligible.productIds || []);
      const eligibleVarIds = new Set(eligible.variantIds || []);

      eligibleSubtotal = 0;
      let matchingItemFound = false;

      for (const it of items) {
        const pId = it.productId || it.product_id;
        const vId = it.variantId || it.variant_id;
        const matchesProd = eligibleProdIds.has(pId);
        const matchesVar = vId && eligibleVarIds.has(vId);

        if (matchesProd || matchesVar) {
          matchingItemFound = true;
          const price = Number(it.unitPrice || it.unit_price || 0);
          const qty = Number(it.quantity || 1);
          eligibleSubtotal += (price * qty);
        }
      }

      if (!matchingItemFound || eligibleSubtotal <= 0) {
        return {
          valid: false,
          error: `Coupon '${coupon.code}' is only applicable to selected products and matrix variants.`
        };
      }
    }

    // 5. Compute Exact Discount According to Coupon Type
    let discountAmount = 0;
    let message = '';

    if (coupon.type === 'FREE_DELIVERY') {
      // Free Delivery: Exempts ONLY shipping fee, NOT item values!
      const ship = Number(shippingFee || 0);
      discountAmount = Math.max(0, ship);
      message = discountAmount > 0
        ? `Free Delivery applied! Shipping fee of ₹${discountAmount.toLocaleString('en-IN')} waived.`
        : 'Free Delivery applied!';
    } else if (coupon.type === 'PERCENTAGE') {
      // Percentage Off: Discounts ONLY items subtotal (or eligible items subtotal)
      const pct = Number(coupon.percentage_off || 0);
      let rawDiscount = (eligibleSubtotal * pct) / 100;

      // Check max discount cap
      const maxCap = Number(coupon.max_discount);
      if (!isNaN(maxCap) && maxCap > 0 && rawDiscount > maxCap) {
        discountAmount = maxCap;
        message = `${pct}% OFF applied (Capped at maximum ₹${maxCap.toLocaleString('en-IN')})!`;
      } else {
        discountAmount = Math.round(rawDiscount * 100) / 100;
        message = `${pct}% OFF applied! You saved ₹${discountAmount.toLocaleString('en-IN')}.`;
      }
      discountAmount = Math.min(discountAmount, eligibleSubtotal);
    } else if (coupon.type === 'FIXED_AMOUNT') {
      // Fixed Flat Amount: Discounts ONLY items subtotal
      const flat = Number(coupon.flat_off || 0);
      discountAmount = Math.min(flat, eligibleSubtotal);

      const maxCap = Number(coupon.max_discount);
      if (!isNaN(maxCap) && maxCap > 0 && discountAmount > maxCap) {
        discountAmount = maxCap;
      }
      discountAmount = Math.round(discountAmount * 100) / 100;
      message = `Flat ₹${discountAmount.toLocaleString('en-IN')} OFF applied!`;
    }

    return {
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        type: coupon.type,
        cartMinValue: coupon.cart_min_value,
        maxDiscount: coupon.max_discount,
        percentageOff: coupon.percentage_off,
        flatOff: coupon.flat_off
      },
      discountAmount: Math.round(discountAmount * 100) / 100,
      message
    };
  }

  _formatCoupon(row) {
    if (!row) return null;
    return {
      ...row,
      eligible_items: typeof row.eligible_items === 'string' ? JSON.parse(row.eligible_items || '{}') : row.eligible_items,
      cart_min_value: Number(row.cart_min_value || 0),
      max_discount: row.max_discount !== null ? Number(row.max_discount) : null,
      percentage_off: Number(row.percentage_off || 0),
      flat_off: Number(row.flat_off || 0),
      usage_count: Number(row.usage_count || 0)
    };
  }
}
