import { IdentityResolver } from '../../../common/src/index.js';

export class UsersRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  create(user) {
    const canonical = IdentityResolver.createCanonicalUser(user);
    const sql = `
      INSERT INTO users (id, name, email, mobile, password_hash, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'), datetime('now'))
    `;
    this.db.execute(sql, [
      canonical.userId,
      canonical.name,
      canonical.email,
      canonical.mobile,
      user.passwordHash || null,
      canonical.role,
      canonical.status
    ]);
    return this.findById(canonical.userId);
  }

  findById(id) {
    return this.db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
  }

  findByEmail(email) {
    if (!email) return null;
    return this.db.queryOne('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
  }

  findByMobile(mobile) {
    if (!mobile) return null;
    const digits = mobile.replace(/[^0-9]/g, '');
    const variants = new Set([
      mobile,
      mobile.trim(),
      digits,
      '+' + digits,
      digits.startsWith('91') ? digits.slice(2) : digits,
      digits.startsWith('91') ? '+' + digits : '+91' + digits,
      digits.length >= 10 ? digits.slice(-10) : digits,
      digits.length >= 10 ? '+91' + digits.slice(-10) : digits
    ]);
    const list = Array.from(variants).filter(Boolean);
    const placeholders = list.map((_, i) => `$${i + 1}`).join(' OR mobile = ');
    return this.db.queryOne(`SELECT * FROM users WHERE mobile = ${placeholders}`, list);
  }

  list({ role, status, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM users WHERE 1=1';
    const params = [];
    if (role) {
      sql += ' AND role = $' + (params.length + 1);
      params.push(role);
    }
    if (status) {
      sql += ' AND status = $' + (params.length + 1);
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    return this.db.query(sql, params);
  }

  update(id, data) {
    const fields = [];
    const params = [];
    if (data.name !== undefined) {
      fields.push(`name = $${params.length + 1}`);
      params.push(data.name);
    }
    if (data.email !== undefined) {
      fields.push(`email = $${params.length + 1}`);
      params.push(data.email.toLowerCase().trim());
    }
    if (data.mobile !== undefined) {
      fields.push(`mobile = $${params.length + 1}`);
      params.push(data.mobile);
    }
    if (data.status !== undefined) {
      fields.push(`status = $${params.length + 1}`);
      params.push(data.status);
    }
    if (data.lastLoginAt !== undefined) {
      fields.push(`last_login_at = $${params.length + 1}`);
      params.push(data.lastLoginAt);
    }
    fields.push("updated_at = datetime('now')");

    if (fields.length > 0) {
      params.push(id);
      this.db.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    }
    return this.findById(id);
  }

  /**
   * Upsert Canonical User from WhatsApp or Store signup/login
   * Ensures no duplicate users created for the same phone or email
   */
  upsertCanonicalUser({ name, mobile, email, passwordHash, role = 'CUSTOMER' }) {
    let existing = this.findByMobile(mobile);
    if (!existing && email) {
      existing = this.findByEmail(email);
    }

    const isDummyName = (n) => !n || ['WhatsApp User', 'Valued Customer', 'Customer', 'User'].includes(n.trim());
    const isDummyEmail = (e) => !e || e.endsWith('@store.local');

    if (existing) {
      const updates = { lastLoginAt: new Date().toISOString() };
      // Update name only if incoming is a real name, or if existing has dummy name
      if (name && !isDummyName(name)) {
        updates.name = name.trim();
      } else if (!existing.name && name) {
        updates.name = name.trim();
      }

      // Update email only if incoming is a real email, or if existing has dummy email
      if (email && !isDummyEmail(email)) {
        updates.email = email.trim().toLowerCase();
      } else if (!existing.email && email) {
        updates.email = email.trim().toLowerCase();
      }

      return this.update(existing.id, updates);
    }

    try {
      const cleanMobile = String(mobile || '').replace(/[^0-9]/g, '');
      return this.create({
        name: (name && !isDummyName(name)) ? name.trim() : (name || 'Customer'),
        mobile,
        email: (email && !isDummyEmail(email)) ? email.trim().toLowerCase() : `${cleanMobile}@store.local`,
        passwordHash,
        role
      });
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        const fallback = this.findByMobile(mobile) || (email ? this.findByEmail(email) : null);
        if (fallback) {
          return this.update(fallback.id, { lastLoginAt: new Date().toISOString() });
        }
      }
      throw err;
    }
  }

  linkIdentity(userId, provider, providerUserId, metadata = {}) {
    const sql = `
      INSERT INTO auth_identities (id, user_id, provider, provider_user_id, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, datetime('now'))
      ON CONFLICT(provider, provider_user_id) DO UPDATE SET
        user_id = excluded.user_id,
        metadata = excluded.metadata
    `;
    const id = `AUTH_ID_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.db.execute(sql, [id, userId, provider, providerUserId, JSON.stringify(metadata)]);
  }

  getIdentities(userId) {
    return this.db.query('SELECT * FROM auth_identities WHERE user_id = $1', [userId]);
  }
}
