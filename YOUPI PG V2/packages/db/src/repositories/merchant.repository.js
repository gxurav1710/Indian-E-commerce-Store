import crypto from 'node:crypto';

export class MerchantRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Creates a new merchant record.
   */
  create(data) {
    const id = data.id || crypto.randomUUID();
    const branding = typeof data.branding === 'object' ? JSON.stringify(data.branding) : (data.branding || '{"primaryColor":"#2563eb","appName":"YOUPI PG","logoUrl":null}');
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO merchants (id, business_name, slug, contact_email, contact_phone, webhook_url, webhook_secret, branding, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    this.db.execute(sql, [
      id,
      data.businessName,
      data.slug,
      data.contactEmail,
      data.contactPhone,
      data.webhookUrl || null,
      data.webhookSecret || crypto.randomBytes(32).toString('hex'),
      branding,
      now,
      now
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM merchants WHERE id = ?', [id]);
    if (!row) return null;
    return this.mapRow(row);
  }

  findBySlug(slug) {
    const row = this.db.queryOne('SELECT * FROM merchants WHERE slug = ?', [slug]);
    if (!row) return null;
    return this.mapRow(row);
  }

  getDefault() {
    const canonical = this.findById('00000000-0000-0000-0000-000000000001');
    if (canonical) return canonical;
    const all = this.findAll();
    return all[0] || null;
  }

  findAll() {
    const rows = this.db.query(`
      SELECT * FROM merchants 
      ORDER BY CASE WHEN id = '00000000-0000-0000-0000-000000000001' THEN 0 ELSE 1 END, created_at ASC
    `);
    return rows.map(r => this.mapRow(r));
  }

  update(id, updates) {
    const fields = [];
    const params = [];

    if (updates.businessName !== undefined) {
      fields.push('business_name = ?');
      params.push(updates.businessName);
    }
    if (updates.contactEmail !== undefined) {
      fields.push('contact_email = ?');
      params.push(updates.contactEmail);
    }
    if (updates.contactPhone !== undefined) {
      fields.push('contact_phone = ?');
      params.push(updates.contactPhone);
    }
    if (updates.webhookUrl !== undefined) {
      fields.push('webhook_url = ?');
      params.push(updates.webhookUrl);
    }
    if (updates.webhookSecret !== undefined) {
      fields.push('webhook_secret = ?');
      params.push(updates.webhookSecret);
    }
    if (updates.branding !== undefined) {
      fields.push('branding = ?');
      params.push(typeof updates.branding === 'object' ? JSON.stringify(updates.branding) : updates.branding);
    }

    if (fields.length === 0) return this.findById(id);

    fields.push('updated_at = ?');
    params.push(new Date().toISOString());

    params.push(id);
    this.db.execute(`UPDATE merchants SET ${fields.join(', ')} WHERE id = ?`, params);

    return this.findById(id);
  }

  mapRow(row) {
    return {
      id: row.id,
      businessName: row.business_name,
      slug: row.slug,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      webhookUrl: row.webhook_url,
      webhookSecret: row.webhook_secret,
      branding: JSON.parse(row.branding || '{}'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
