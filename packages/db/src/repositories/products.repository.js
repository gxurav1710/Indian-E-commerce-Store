import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ProductsRepository {
  /**
   * @param {import('../database.js').Database} db
   * @param {string} [assetRootDir] - Base directory for SKU asset storage
   */
  constructor(db, assetRootDir = null) {
    this.db = db;
    this.assetRootDir = assetRootDir || (process.env.PRODUCT_ASSETS_DIR ? path.resolve(process.env.PRODUCT_ASSETS_DIR) : path.resolve(__dirname, '../../../../data/product_assets'));
  }

  /**
   * Generates a unique SKU if not provided
   * e.g. SKU-10001
   */
  generateSku() {
    const row = this.db.queryOne('SELECT COUNT(*) as count FROM products');
    const nextNum = 10001 + Number(row?.count || 0);
    return `SKU-${nextNum}`;
  }

  /**
   * Creates SKU asset structure on disk
   * products/SKU-XXXXX/{images, videos, documents, metadata}
   * @param {string} sku
   * @returns {string} relative asset dir
   */
  ensureSkuAssetDirectory(sku) {
    const relativePath = `products/${sku}`;
    const absolutePath = path.resolve(this.assetRootDir, relativePath);

    const subdirs = ['images', 'videos', 'documents', 'metadata'];
    for (const subdir of subdirs) {
      const dirPath = path.join(absolutePath, subdir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }
    return relativePath;
  }

  create(data) {
    const sku = data.sku || this.generateSku();
    const existing = this.findBySku(sku);
    if (existing) {
      this.ensureSkuAssetDirectory(sku);
      return this.update(existing.id, data);
    }
    const id = data.id || `PROD_${sku.replace(/[^A-Z0-9]/gi, '_')}`;
    let slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `prod-${Date.now()}`;
    const existingSlug = this.findBySlug(slug);
    if (existingSlug && existingSlug.id !== id) {
      slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    const assetDir = this.ensureSkuAssetDirectory(sku);

    const sql = `
      INSERT INTO products (
        id, sku, name, slug, description, short_description, price, discount_price,
        category_id, brand, stock, dimensions, weight, materials,
        seo_title, seo_description, status, asset_dir, metadata, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        datetime('now'), datetime('now')
      )
    `;

    this.db.execute(sql, [
      id,
      sku,
      data.name,
      slug,
      data.description || '',
      data.shortDescription || data.short_description || null,
      Number(data.price || 0),
      data.discountPrice !== undefined && data.discountPrice !== null ? Number(data.discountPrice) : null,
      data.categoryId || data.category_id || null,
      data.brand || null,
      Number(data.stock || 0),
      data.dimensions || null,
      data.weight || null,
      data.materials || null,
      data.seoTitle || data.seo_title || data.name,
      data.seoDescription || data.seo_description || data.shortDescription || null,
      data.status || 'PUBLISHED',
      assetDir,
      JSON.stringify(data.metadata || {})
    ]);

    // Save metadata file inside SKU asset directory
    try {
      const metaPath = path.resolve(this.assetRootDir, assetDir, 'metadata', 'product.json');
      fs.writeFileSync(metaPath, JSON.stringify({ id, sku, name: data.name, createdAt: new Date().toISOString() }, null, 2));
    } catch {}

    // Add media if provided (supports multiple images and videos!)
    if (Array.isArray(data.media)) {
      data.media.forEach((item, idx) => {
        const isVideo = item.mediaType === 'video' || (item.url && (item.url.includes('.mp4') || item.url.includes('.webm') || item.url.includes('youtube') || item.url.includes('vimeo')));
        const type = isVideo ? 'video' : 'image';
        const ext = isVideo ? 'mp4' : 'jpg';
        this.addMedia({
          productId: id,
          sku,
          mediaType: type,
          filePath: `${assetDir}/${type}s/media_${idx + 1}.${ext}`,
          url: item.url,
          isPrimary: item.isPrimary !== undefined ? item.isPrimary : (idx === 0 && !isVideo),
          sortOrder: item.sortOrder || idx
        });
      });
    } else {
      if (Array.isArray(data.images)) {
        data.images.forEach((imgUrl, idx) => {
          const url = typeof imgUrl === 'string' ? imgUrl : imgUrl.url;
          this.addMedia({
            productId: id,
            sku,
            mediaType: 'image',
            filePath: `${assetDir}/images/image_${idx + 1}.jpg`,
            url,
            isPrimary: idx === 0,
            sortOrder: idx
          });
        });
      }
      if (Array.isArray(data.videos)) {
        data.videos.forEach((vidUrl, idx) => {
          const url = typeof vidUrl === 'string' ? vidUrl : vidUrl.url;
          this.addMedia({
            productId: id,
            sku,
            mediaType: 'video',
            filePath: `${assetDir}/videos/video_${idx + 1}.mp4`,
            url,
            isPrimary: false,
            sortOrder: 50 + idx
          });
        });
      }
    }

    // Add variants if provided
    if (Array.isArray(data.variants) && data.variants.length > 0) {
      data.variants.forEach((v, idx) => {
        this.createVariant({
          productId: id,
          sku: v.sku || `${sku}-V${idx + 1}`,
          name: v.name,
          price: v.price || data.price,
          stock: v.stock !== undefined ? Number(v.stock) : 10,
          attributes: v.attributes || {}
        });
      });
      this.syncVariantStock(id);
    }

    return this.getProductWithDetails(id);
  }

  findById(id) {
    return this.db.queryOne(`
      SELECT p.*,
        COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id = p.id), p.stock) as stock
      FROM products p WHERE p.id = $1
    `, [id]);
  }

  findBySku(sku) {
    return this.db.queryOne(`
      SELECT p.*,
        COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id = p.id), p.stock) as stock
      FROM products p WHERE p.sku = $1
    `, [sku]);
  }

  findBySlug(slug) {
    return this.db.queryOne(`
      SELECT p.*,
        COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id = p.id), p.stock) as stock
      FROM products p WHERE p.slug = $1
    `, [slug]);
  }

  list({ categoryId, status, brand, search, minPrice, maxPrice, limit = 50, offset = 0, sort = 'newest' } = {}) {
    let sql = `
      SELECT p.*,
        COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id = p.id), p.stock) as stock,
        c.name as category_name, c.slug as category_slug,
        (SELECT url FROM product_media WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image,
        COALESCE((SELECT AVG(rating) FROM product_reviews WHERE product_id = p.id), 5.0) as average_rating,
        COALESCE((SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id), 0) as review_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (categoryId) {
      const idx1 = params.length + 1;
      const idx2 = params.length + 2;
      sql += ` AND (p.category_id = $${idx1} OR c.slug = $${idx2})`;
      params.push(categoryId, categoryId);
    }
    if (status) {
      sql += ' AND p.status = $' + (params.length + 1);
      params.push(status);
    }
    if (brand) {
      sql += ' AND LOWER(p.brand) = LOWER($' + (params.length + 1) + ')';
      params.push(brand);
    }
    if (minPrice !== undefined && minPrice !== null) {
      sql += ' AND p.price >= $' + (params.length + 1);
      params.push(Number(minPrice));
    }
    if (maxPrice !== undefined && maxPrice !== null) {
      sql += ' AND p.price <= $' + (params.length + 1);
      params.push(Number(maxPrice));
    }
    if (search) {
      const q = `%${search.toLowerCase().trim()}%`;
      const idx1 = params.length + 1;
      const idx2 = params.length + 2;
      const idx3 = params.length + 3;
      sql += ` AND (LOWER(p.name) LIKE $${idx1} OR LOWER(p.description) LIKE $${idx2} OR LOWER(p.sku) LIKE $${idx3})`;
      params.push(q, q, q);
    }

    // Sort order
    if (sort === 'price_asc') {
      sql += ' ORDER BY p.price ASC';
    } else if (sort === 'price_desc') {
      sql += ' ORDER BY p.price DESC';
    } else if (sort === 'name_asc') {
      sql += ' ORDER BY p.name ASC';
    } else {
      sql += ' ORDER BY p.created_at DESC';
    }

    sql += ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const products = this.db.query(sql, params);
    return products.map(p => {
      const variants = this.listVariants(p.id).map(v => ({
        ...v,
        attributes: typeof v.attributes === 'string' ? JSON.parse(v.attributes || '{}') : (v.attributes || {})
      }));
      const variantStockSum = variants.length > 0 ? variants.reduce((acc, v) => acc + (Number(v.stock) || 0), 0) : null;
      return {
        ...p,
        stock: variantStockSum !== null ? variantStockSum : Number(p.stock || 0),
        variants
      };
    });
  }

  update(id, data) {
    const fields = [];
    const params = [];

    const allowed = [
      'name', 'slug', 'description', 'short_description', 'price', 'discount_price',
      'category_id', 'brand', 'stock', 'dimensions', 'weight', 'materials',
      'seo_title', 'seo_description', 'status'
    ];

    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
      const val = data[camel] !== undefined ? data[camel] : data[key];
      if (val !== undefined) {
        fields.push(`${key} = $${params.length + 1}`);
        params.push(val);
      }
    }

    if (data.metadata !== undefined) {
      fields.push(`metadata = $${params.length + 1}`);
      params.push(JSON.stringify(data.metadata));
    }

    fields.push("updated_at = datetime('now')");

    if (fields.length > 0) {
      params.push(id);
      this.db.execute(`UPDATE products SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    }

    if (Array.isArray(data.variants)) {
      this.db.execute('DELETE FROM product_variants WHERE product_id = $1', [id]);
      const prod = this.findById(id);
      data.variants.forEach((v, idx) => {
        this.createVariant({
          productId: id,
          sku: v.sku || `${prod?.sku || id}-V${idx + 1}`,
          name: v.name,
          price: v.price !== undefined && v.price !== null ? Number(v.price) : prod?.price,
          stock: v.stock !== undefined && v.stock !== null ? Number(v.stock) : 0,
          attributes: v.attributes || {}
        });
      });
      this.syncVariantStock(id);
    }

    return this.getProductWithDetails(id);
  }

  updateStock(id, newStock) {
    this.db.execute("UPDATE products SET stock = $1, updated_at = datetime('now') WHERE id = $2", [newStock, id]);
    return this.findById(id);
  }

  createVariant(data) {
    const id = data.id || data.sku || `VAR_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const sql = `
      INSERT INTO product_variants (id, product_id, sku, name, price, stock, attributes, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'), datetime('now'))
    `;
    this.db.execute(sql, [
      id,
      data.productId,
      data.sku,
      data.name,
      Number(data.price),
      Number(data.stock || 0),
      JSON.stringify(data.attributes || {})
    ]);
    return this.db.queryOne('SELECT * FROM product_variants WHERE id = $1', [id]);
  }

  listVariants(productId) {
    return this.db.query('SELECT * FROM product_variants WHERE product_id = $1 ORDER BY price ASC', [productId]);
  }

  addMedia(data) {
    const id = data.id || `MED_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const sql = `
      INSERT INTO product_media (id, product_id, sku, media_type, file_path, url, is_primary, sort_order, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, datetime('now'))
    `;
    this.db.execute(sql, [
      id,
      data.productId,
      data.sku,
      data.mediaType || 'image',
      data.filePath || '',
      data.url,
      data.isPrimary ? 1 : 0,
      data.sortOrder || 0
    ]);
    return this.db.queryOne('SELECT * FROM product_media WHERE id = $1', [id]);
  }

  listMedia(productId) {
    return this.db.query('SELECT * FROM product_media WHERE product_id = $1 ORDER BY sort_order ASC', [productId]);
  }

  deleteMedia(mediaId) {
    this.db.execute('DELETE FROM product_media WHERE id = $1', [mediaId]);
  }

  setPrimaryMedia(productId, mediaId) {
    this.db.execute('UPDATE product_media SET is_primary = 0 WHERE product_id = $1', [productId]);
    this.db.execute('UPDATE product_media SET is_primary = 1 WHERE id = $1 AND product_id = $2', [mediaId, productId]);
  }

  syncVariantStock(productId) {
    this.db.execute(
      "UPDATE products SET stock = (SELECT COALESCE(SUM(stock), products.stock) FROM product_variants WHERE product_id = $1), updated_at = datetime('now') WHERE id = $1",
      [productId]
    );
  }

  getProductWithDetails(productIdOrSlug) {
    let product = this.findById(productIdOrSlug);
    if (!product) {
      product = this.findBySlug(productIdOrSlug);
    }
    if (!product) return null;

    const variants = this.listVariants(product.id).map(v => ({
      ...v,
      attributes: typeof v.attributes === 'string' ? JSON.parse(v.attributes || '{}') : v.attributes
    }));

    const variantTotalStock = variants.length > 0
      ? variants.reduce((acc, v) => acc + (Number(v.stock) || 0), 0)
      : null;

    const media = this.listMedia(product.id);
    const category = product.category_id ? this.db.queryOne('SELECT * FROM categories WHERE id = $1', [product.category_id]) : null;

    const reviewStats = this.db.queryOne(
      'SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM product_reviews WHERE product_id = $1',
      [product.id]
    );

    return {
      ...product,
      category_name: category?.name || null,
      category_slug: category?.slug || null,
      stock: variantTotalStock !== null ? variantTotalStock : Number(product.stock || 0),
      metadata: typeof product.metadata === 'string' ? JSON.parse(product.metadata || '{}') : product.metadata,
      category,
      variants,
      media,
      primaryImage: media.find(m => m.is_primary)?.url || media.find(m => m.media_type === 'image')?.url || media[0]?.url || null,
      averageRating: reviewStats?.avg_rating ? Math.round(Number(reviewStats.avg_rating) * 10) / 10 : 5.0,
      reviewCount: Number(reviewStats?.count || 0)
    };
  }

  delete(id) {
    return this.db.transaction(() => {
      // 1. Decouple historical order items referencing this product so order snapshots remain intact
      try {
        this.db.execute('UPDATE order_items SET product_id = NULL WHERE product_id = $1', [id]);
      } catch (e) {}

      // 2. Remove cart items
      try {
        this.db.execute('DELETE FROM cart_items WHERE product_id = $1', [id]);
      } catch (e) {}

      // 3. Remove reviews
      try {
        this.db.execute('DELETE FROM product_reviews WHERE product_id = $1', [id]);
      } catch (e) {}

      // 4. Remove media
      try {
        this.db.execute('DELETE FROM product_media WHERE product_id = $1', [id]);
      } catch (e) {}

      // 5. Remove variants
      try {
        this.db.execute('DELETE FROM product_variants WHERE product_id = $1', [id]);
      } catch (e) {}

      // 6. Delete the product
      const res = this.db.execute('DELETE FROM products WHERE id = $1', [id]);
      return res;
    });
  }
}
