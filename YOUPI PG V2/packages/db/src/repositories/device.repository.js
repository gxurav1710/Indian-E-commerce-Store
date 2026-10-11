import crypto from 'node:crypto';

export class DeviceRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Creates or registers a new device record.
   * @param {{
   *   id?: string,
   *   customerId?: string|null,
   *   publicKey: string,
   *   fingerprintHash: string,
   *   userAgent?: string,
   *   platform?: string,
   *   browser?: string,
   *   timezone?: string,
   *   language?: string,
   *   screenSignature?: string,
   *   deviceToken?: string,
   *   status?: string
   * }} data
   */
  create(data) {
    const id = data.id || `dev_${crypto.randomUUID()}`;
    const deviceToken = data.deviceToken || `devtok_${crypto.randomBytes(32).toString('hex')}`;
    const now = new Date().toISOString();
    const status = data.status || 'ACTIVE';

    const sql = `
      INSERT INTO devices (
        id, customer_id, public_key, fingerprint_hash, user_agent,
        platform, browser, timezone, language, screen_signature,
        device_token, status, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    this.db.execute(sql, [
      id,
      data.customerId || null,
      data.publicKey,
      data.fingerprintHash,
      data.userAgent || null,
      data.platform || null,
      data.browser || null,
      data.timezone || null,
      data.language || null,
      data.screenSignature || null,
      deviceToken,
      status,
      now,
      now
    ]);

    return this.findById(id);
  }

  /**
   * Finds a device by its unique ID.
   * @param {string} id
   */
  findById(id) {
    if (!id) return null;
    const row = this.db.queryOne('SELECT * FROM devices WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  /**
   * Finds a device by its active device token.
   * @param {string} token
   */
  findByToken(token) {
    if (!token) return null;
    const row = this.db.queryOne('SELECT * FROM devices WHERE device_token = ? AND status = "ACTIVE"', [token]);
    return row ? this.mapRow(row) : null;
  }

  /**
   * Finds existing device by matching public key.
   * @param {string} publicKey
   */
  findByPublicKey(publicKey) {
    if (!publicKey) return null;
    const row = this.db.queryOne('SELECT * FROM devices WHERE public_key = ? LIMIT 1', [publicKey]);
    return row ? this.mapRow(row) : null;
  }

  /**
   * Finds existing device by customerId and fingerprint.
   * @param {string} customerId
   * @param {string} fingerprintHash
   */
  findByCustomerAndFingerprint(customerId, fingerprintHash) {
    if (!customerId || !fingerprintHash) return null;
    const row = this.db.queryOne(
      'SELECT * FROM devices WHERE customer_id = ? AND fingerprint_hash = ? AND status = "ACTIVE" LIMIT 1',
      [customerId, fingerprintHash]
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * Finds all devices registered for a customer.
   * @param {string} customerId
   */
  findByCustomerId(customerId) {
    if (!customerId) return [];
    const rows = this.db.query(
      'SELECT * FROM devices WHERE customer_id = ? ORDER BY last_seen_at DESC',
      [customerId]
    );
    return rows.map(r => this.mapRow(r));
  }

  /**
   * Associates an existing device with a customer.
   * @param {string} deviceId
   * @param {string} customerId
   */
  associateCustomer(deviceId, customerId) {
    const now = new Date().toISOString();
    this.db.execute(
      'UPDATE devices SET customer_id = ?, last_seen_at = ? WHERE id = ?',
      [customerId, now, deviceId]
    );
    return this.findById(deviceId);
  }

  /**
   * Updates last seen timestamp for a device.
   * @param {string} deviceId
   */
  touch(deviceId) {
    if (!deviceId) return;
    try {
      this.db.execute(
        'UPDATE devices SET last_seen_at = ? WHERE id = ?',
        [new Date().toISOString(), deviceId]
      );
    } catch {}
  }

  /**
   * Updates device record.
   * @param {string} id
   * @param {Partial<any>} data
   */
  update(id, data) {
    const fields = [];
    const values = [];

    if (data.customerId !== undefined) {
      fields.push('customer_id = ?');
      values.push(data.customerId);
    }
    if (data.fingerprintHash !== undefined) {
      fields.push('fingerprint_hash = ?');
      values.push(data.fingerprintHash);
    }
    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status);
    }
    if (data.deviceToken !== undefined) {
      fields.push('device_token = ?');
      values.push(data.deviceToken);
    }

    fields.push('last_seen_at = ?');
    values.push(new Date().toISOString());

    values.push(id);
    this.db.execute(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  /**
   * Maps a database row to a clean camelCase object.
   * @param {any} row
   */
  mapRow(row) {
    return {
      id: row.id,
      customerId: row.customer_id,
      publicKey: row.public_key,
      fingerprintHash: row.fingerprint_hash,
      userAgent: row.user_agent,
      platform: row.platform,
      browser: row.browser,
      timezone: row.timezone,
      language: row.language,
      screenSignature: row.screen_signature,
      deviceToken: row.device_token,
      status: row.status,
      createdAt: new Date(row.created_at),
      lastSeenAt: new Date(row.last_seen_at)
    };
  }
}
