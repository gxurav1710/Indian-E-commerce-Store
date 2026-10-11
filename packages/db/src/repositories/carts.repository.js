export class CartsRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  getOrCreateCart(userId = null, sessionToken = null) {
    let cart = null;
    if (userId) {
      cart = this.db.queryOne("SELECT * FROM carts WHERE user_id = $1 AND status = 'ACTIVE'", [userId]);
    } else if (sessionToken) {
      cart = this.db.queryOne("SELECT * FROM carts WHERE session_token = $1 AND status = 'ACTIVE'", [sessionToken]);
    }

    if (!cart) {
      const id = `CART_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      this.db.execute(
        "INSERT INTO carts (id, user_id, session_token, status, created_at, updated_at) VALUES ($1, $2, $3, 'ACTIVE', datetime('now'), datetime('now'))",
        [id, userId, sessionToken]
      );
      cart = this.db.queryOne('SELECT * FROM carts WHERE id = $1', [id]);
    }

    return this.getCartWithItems(cart.id);
  }

  getCartWithItems(cartId) {
    const cart = this.db.queryOne('SELECT * FROM carts WHERE id = $1', [cartId]);
    if (!cart) return null;

    const items = this.db.query(
      `SELECT ci.*, p.name as product_name, p.slug as product_slug, p.sku as product_sku, p.stock as current_stock,
              (SELECT url FROM product_media WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as image_url,
              pv.name as variant_name, pv.sku as variant_sku, pv.stock as variant_stock
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       LEFT JOIN product_variants pv ON ci.variant_id = pv.id
       WHERE ci.cart_id = $1
       ORDER BY ci.created_at ASC`,
      [cartId]
    );

    let subtotal = 0;
    let itemCount = 0;

    const formattedItems = items.map(item => {
      const lineTotal = Number(item.unit_price) * item.quantity;
      subtotal += lineTotal;
      itemCount += item.quantity;
      return {
        id: item.id,
        productId: item.product_id,
        variantId: item.variant_id,
        name: item.variant_name ? `${item.product_name} - ${item.variant_name}` : item.product_name,
        slug: item.product_slug,
        sku: item.variant_sku || item.product_sku,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        lineTotal,
        imageUrl: item.image_url,
        stockAvailable: item.variant_stock !== null && item.variant_stock !== undefined ? item.variant_stock : item.current_stock
      };
    });

    return {
      id: cart.id,
      userId: cart.user_id,
      sessionToken: cart.session_token,
      status: cart.status,
      items: formattedItems,
      itemCount,
      subtotal: Math.round(subtotal * 100) / 100,
      createdAt: cart.created_at,
      updatedAt: cart.updated_at
    };
  }

  addItem(cartId, productId, variantId, quantity = 1, unitPrice = null) {
    let availableStock = 0;
    if (variantId) {
      const v = this.db.queryOne('SELECT stock, price FROM product_variants WHERE id = $1', [variantId]);
      availableStock = Number(v?.stock || 0);
      if (unitPrice === null) unitPrice = v ? v.price : 0;
    } else {
      const p = this.db.queryOne(`
        SELECT price, discount_price,
          COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id = products.id), stock) as stock
        FROM products WHERE id = $1
      `, [productId]);
      availableStock = Number(p?.stock || 0);
      if (unitPrice === null) unitPrice = p ? (p.discount_price || p.price) : 0;
    }

    if (availableStock <= 0) {
      throw new Error('This product option is sold out and cannot be added to cart.');
    }

    const existing = this.db.queryOne(
      'SELECT * FROM cart_items WHERE cart_id = $1 AND product_id = $2 AND (variant_id = $3 OR (variant_id IS NULL AND $3 IS NULL))',
      [cartId, productId, variantId || null]
    );

    if (existing) {
      const newQty = existing.quantity + quantity;
      this.db.execute(
        "UPDATE cart_items SET quantity = $1, updated_at = datetime('now') WHERE id = $2",
        [newQty, existing.id]
      );
    } else {
      const id = `CI_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      this.db.execute(
        "INSERT INTO cart_items (id, cart_id, product_id, variant_id, quantity, unit_price, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, datetime('now'), datetime('now'))",
        [id, cartId, productId, variantId || null, quantity, Number(unitPrice)]
      );
    }

    this.db.execute("UPDATE carts SET updated_at = datetime('now') WHERE id = $1", [cartId]);
    return this.getCartWithItems(cartId);
  }

  updateItemQuantity(cartId, cartItemId, quantity) {
    if (quantity <= 0) {
      this.db.execute('DELETE FROM cart_items WHERE cart_id = $1 AND id = $2', [cartId, cartItemId]);
    } else {
      this.db.execute(
        "UPDATE cart_items SET quantity = $1, updated_at = datetime('now') WHERE cart_id = $2 AND id = $3",
        [quantity, cartId, cartItemId]
      );
    }
    this.db.execute("UPDATE carts SET updated_at = datetime('now') WHERE id = $1", [cartId]);
    return this.getCartWithItems(cartId);
  }

  removeItem(cartId, cartItemId) {
    this.db.execute('DELETE FROM cart_items WHERE cart_id = $1 AND id = $2', [cartId, cartItemId]);
    this.db.execute("UPDATE carts SET updated_at = datetime('now') WHERE id = $1", [cartId]);
    return this.getCartWithItems(cartId);
  }

  clearCart(cartId) {
    this.db.execute('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
    this.db.execute("UPDATE carts SET updated_at = datetime('now') WHERE id = $1", [cartId]);
    return this.getCartWithItems(cartId);
  }

  /**
   * Safe Guest Cart Merge upon Authentication (Section 16)
   * Merges items from guest session cart into user's authenticated cart:
   * - Combines quantities for identical products/variants
   * - Checks stock limits
   * - Marks guest cart as MERGED
   */
  mergeGuestCart(guestSessionToken, userId) {
    if (!guestSessionToken || !userId) return null;

    const guestCart = this.db.queryOne(
      "SELECT * FROM carts WHERE session_token = $1 AND status = 'ACTIVE'",
      [guestSessionToken]
    );
    if (!guestCart) {
      return this.getOrCreateCart(userId, null);
    }

    const userCart = this.getOrCreateCart(userId, null);
    const guestItems = this.db.query('SELECT * FROM cart_items WHERE cart_id = $1', [guestCart.id]);

    this.db.transaction(() => {
      for (const item of guestItems) {
        // Check product stock
        let availableStock = 999;
        if (item.variant_id) {
          const v = this.db.queryOne('SELECT stock FROM product_variants WHERE id = $1', [item.variant_id]);
          if (v) availableStock = v.stock;
        } else {
          const p = this.db.queryOne('SELECT stock FROM products WHERE id = $1', [item.product_id]);
          if (p) availableStock = p.stock;
        }

        const existingUserItem = this.db.queryOne(
          'SELECT * FROM cart_items WHERE cart_id = $1 AND product_id = $2 AND (variant_id = $3 OR (variant_id IS NULL AND $3 IS NULL))',
          [userCart.id, item.product_id, item.variant_id]
        );

        if (existingUserItem) {
          const desiredQty = existingUserItem.quantity + item.quantity;
          const finalQty = Math.min(desiredQty, availableStock);
          this.db.execute(
            "UPDATE cart_items SET quantity = $1, updated_at = datetime('now') WHERE id = $2",
            [finalQty, existingUserItem.id]
          );
        } else {
          const finalQty = Math.min(item.quantity, availableStock);
          if (finalQty > 0) {
            const newId = `CI_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            this.db.execute(
              "INSERT INTO cart_items (id, cart_id, product_id, variant_id, quantity, unit_price, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, datetime('now'), datetime('now'))",
              [newId, userCart.id, item.product_id, item.variant_id, finalQty, item.unit_price]
            );
          }
        }
      }

      // Mark guest cart as MERGED
      this.db.execute("UPDATE carts SET status = 'MERGED', updated_at = datetime('now') WHERE id = $1", [guestCart.id]);
    });

    return this.getCartWithItems(userCart.id);
  }
}
