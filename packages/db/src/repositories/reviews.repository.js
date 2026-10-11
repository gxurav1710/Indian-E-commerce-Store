export class ReviewsRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Sanitize text strings to prevent XSS / script injections
   */
  sanitizeText(str = '') {
    return String(str || '')
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  /**
   * Misuse Limiting & Media Sanitization:
   * Max 3 images and 1 video per review.
   * Validates URLs and drops malformed/malicious entries.
   */
  sanitizeReviewMedia(mediaInput = []) {
    if (!Array.isArray(mediaInput)) return [];

    let imageCount = 0;
    let videoCount = 0;
    const sanitized = [];

    for (const item of mediaInput) {
      if (!item) continue;
      const url = typeof item === 'string' ? item.trim() : (item.url || '').trim();
      if (!url) continue;

      // Strict URL protocol validation (HTTP/HTTPS only)
      if (!/^https?:\/\//i.test(url)) continue;

      const isVideo = item.mediaType === 'video' ||
        /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url) ||
        url.includes('youtube.com') ||
        url.includes('youtu.be') ||
        url.includes('vimeo.com');

      if (isVideo) {
        if (videoCount < 1) { // Guardrail: Max 1 video per review
          sanitized.push({
            url,
            mediaType: 'video'
          });
          videoCount++;
        }
      } else {
        if (imageCount < 3) { // Guardrail: Max 3 images per review
          sanitized.push({
            url,
            mediaType: 'image'
          });
          imageCount++;
        }
      }
    }

    return sanitized;
  }

  createReview(data) {
    if (!data.productId) throw new Error('Product ID is required');
    if (!data.userId) throw new Error('User must be logged in to submit a review');

    // 1. Misuse Limiting: Rate limit checking (Max 5 reviews per hour per user)
    const recentReviews = this.db.queryOne(
      "SELECT COUNT(*) as count FROM product_reviews WHERE user_id = $1 AND created_at > datetime('now', '-1 hour')",
      [data.userId]
    );
    if (Number(recentReviews?.count || 0) >= 5) {
      throw new Error('Rate limit exceeded: You can submit up to 5 reviews per hour.');
    }

    // 2. Content Guardrails
    const rating = Math.min(5, Math.max(1, Math.round(Number(data.rating || 5))));
    const title = this.sanitizeText(data.title || 'Product Review');
    const comment = this.sanitizeText(data.comment || '');

    if (title.length < 3) throw new Error('Review title must be at least 3 characters');
    if (title.length > 100) throw new Error('Review title cannot exceed 100 characters');
    if (comment.length < 5) throw new Error('Review comment must be at least 5 characters');
    if (comment.length > 1000) throw new Error('Review comment cannot exceed 1000 characters');

    // 3. Media Misuse Limiting (Max 3 photos, max 1 video)
    const media = this.sanitizeReviewMedia(data.media || []);

    // 4. Check if user is a verified purchaser of this product
    let isVerified = data.isVerified ? 1 : 0;
    if (!isVerified) {
      const purchased = this.db.queryOne(
        `SELECT oi.id FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE o.user_id = $1 AND oi.product_id = $2 AND o.payment_status = 'SUCCESS'
         LIMIT 1`,
        [data.userId, data.productId]
      );
      if (purchased) {
        isVerified = 1;
      }
    }

    // 5. Misuse Limiting: Prevent duplicate reviews for same product (Update existing if already submitted)
    const existing = this.db.queryOne(
      'SELECT id FROM product_reviews WHERE product_id = $1 AND user_id = $2',
      [data.productId, data.userId]
    );

    if (existing) {
      const updateSql = `
        UPDATE product_reviews SET
          rating = $1, title = $2, comment = $3, media = $4, is_verified = $5, updated_at = datetime('now')
        WHERE id = $6
      `;
      this.db.execute(updateSql, [
        rating,
        title,
        comment,
        JSON.stringify(media),
        isVerified,
        existing.id
      ]);
      return this.findById(existing.id);
    }

    const id = data.id || `REV_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const sql = `
      INSERT INTO product_reviews (
        id, product_id, user_id, user_name, rating, title, comment, media, is_verified, is_featured, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, datetime('now'), datetime('now')
      )
    `;

    this.db.execute(sql, [
      id,
      data.productId,
      data.userId,
      this.sanitizeText(data.userName || 'Verified Buyer'),
      rating,
      title,
      comment,
      JSON.stringify(media),
      isVerified,
      data.isFeatured ? 1 : 0
    ]);

    return this.findById(id);
  }

  findById(id) {
    const r = this.db.queryOne('SELECT * FROM product_reviews WHERE id = $1', [id]);
    if (!r) return null;
    return {
      ...r,
      media: typeof r.media === 'string' ? JSON.parse(r.media || '[]') : (r.media || [])
    };
  }

  /**
   * Retrieves reviews for a product with Top Verified Reviews first!
   */
  getProductReviews(productId) {
    const rawReviews = this.db.query(
      `SELECT * FROM product_reviews
       WHERE product_id = $1
       ORDER BY is_verified DESC, is_featured DESC, created_at DESC`,
      [productId]
    );

    const reviews = rawReviews.map(r => ({
      ...r,
      media: typeof r.media === 'string' ? JSON.parse(r.media || '[]') : (r.media || [])
    }));

    const summary = this.getProductRatingSummary(productId);

    return {
      reviews,
      summary
    };
  }

  getProductRatingSummary(productId) {
    const stats = this.db.queryOne(
      `SELECT
        COUNT(*) as total_reviews,
        AVG(rating) as average_rating,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as stars_5,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as stars_4,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as stars_3,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as stars_2,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as stars_1,
        SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_count
       FROM product_reviews
       WHERE product_id = $1`,
      [productId]
    );

    return {
      totalReviews: Number(stats?.total_reviews || 0),
      averageRating: stats?.average_rating ? Math.round(Number(stats.average_rating) * 10) / 10 : 0,
      verifiedCount: Number(stats?.verified_count || 0),
      breakdown: {
        5: Number(stats?.stars_5 || 0),
        4: Number(stats?.stars_4 || 0),
        3: Number(stats?.stars_3 || 0),
        2: Number(stats?.stars_2 || 0),
        1: Number(stats?.stars_1 || 0)
      }
    };
  }

  listAllReviews({ isVerified = null, limit = 100, offset = 0 } = {}) {
    let sql = `
      SELECT r.*, p.name as product_name, p.sku as product_sku
      FROM product_reviews r
      JOIN products p ON r.product_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (isVerified !== null && isVerified !== undefined) {
      sql += ' AND r.is_verified = $' + (params.length + 1);
      params.push(isVerified ? 1 : 0);
    }

    sql += ' ORDER BY r.created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const rows = this.db.query(sql, params);
    return rows.map(r => ({
      ...r,
      media: typeof r.media === 'string' ? JSON.parse(r.media || '[]') : (r.media || [])
    }));
  }

  verifyReview(id, isVerified = 1) {
    this.db.execute(
      "UPDATE product_reviews SET is_verified = $1, updated_at = datetime('now') WHERE id = $2",
      [isVerified ? 1 : 0, id]
    );
    return this.findById(id);
  }

  deleteReview(id) {
    this.db.execute('DELETE FROM product_reviews WHERE id = $1', [id]);
  }
}
