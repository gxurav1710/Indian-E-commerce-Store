export class CategoriesRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  create(category) {
    const slug = (category.slug || category.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `cat-${Date.now()}`;
    const existing = this.findBySlug(slug);
    if (existing) {
      return this.update(existing.id, category);
    }
    const id = category.id || `CAT_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const sql = `
      INSERT INTO categories (id, name, slug, description, image_url, parent_id, sort_order, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'), datetime('now'))
    `;
    this.db.execute(sql, [
      id,
      category.name || 'Unnamed Category',
      slug,
      category.description || null,
      category.imageUrl || null,
      category.parentId || null,
      category.sortOrder || 0
    ]);
    return this.findById(id);
  }

  findById(id) {
    return this.db.queryOne('SELECT * FROM categories WHERE id = $1', [id]);
  }

  findBySlug(slug) {
    return this.db.queryOne('SELECT * FROM categories WHERE slug = $1', [slug]);
  }

  list() {
    return this.db.query('SELECT * FROM categories ORDER BY sort_order ASC, name ASC');
  }

  update(id, data) {
    const fields = [];
    const params = [];
    if (data.name !== undefined) {
      fields.push(`name = $${params.length + 1}`);
      params.push(data.name);
    }
    if (data.slug !== undefined) {
      fields.push(`slug = $${params.length + 1}`);
      params.push(data.slug);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${params.length + 1}`);
      params.push(data.description);
    }
    if (data.imageUrl !== undefined) {
      fields.push(`image_url = $${params.length + 1}`);
      params.push(data.imageUrl);
    }
    if (data.parentId !== undefined) {
      fields.push(`parent_id = $${params.length + 1}`);
      params.push(data.parentId);
    }
    if (data.sortOrder !== undefined) {
      fields.push(`sort_order = $${params.length + 1}`);
      params.push(data.sortOrder);
    }
    fields.push("updated_at = datetime('now')");

    if (fields.length > 0) {
      params.push(id);
      this.db.execute(`UPDATE categories SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    }
    return this.findById(id);
  }

  delete(id) {
    return this.db.transaction(() => {
      try {
        this.db.execute('UPDATE products SET category_id = NULL WHERE category_id = $1', [id]);
      } catch (e) {}
      try {
        this.db.execute('UPDATE categories SET parent_id = NULL WHERE parent_id = $1', [id]);
      } catch (e) {}
      return this.db.execute('DELETE FROM categories WHERE id = $1', [id]);
    });
  }
}
