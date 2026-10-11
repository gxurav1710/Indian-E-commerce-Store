import crypto from 'node:crypto';

export class ReceivingAccountRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Creates a new receiving UPI account.
   * If isActive is true, atomically deactivates any other active accounts for this merchant.
   * Enforces that maximum ONE VPA may be active per merchant.
   */
  create(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const isActive = data.isActive !== undefined ? Boolean(data.isActive) : true;
    const isMerchantEnabled = data.isMerchantEnabled !== undefined ? Boolean(data.isMerchantEnabled) : true;

    return this.db.transaction(() => {
      // If this new account is marked active, atomically deactivate all existing active accounts for this merchant
      if (isActive) {
        this.db.execute(`
          UPDATE payment_receiving_accounts
          SET is_active = 0, updated_at = ?
          WHERE merchant_id = ?
        `, [now, data.merchantId]);
      }

      const sql = `
        INSERT INTO payment_receiving_accounts (
          id, merchant_id, upi_id, payee_name, is_merchant_enabled,
          is_active, is_slot_busy, current_active_session_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.execute(sql, [
        id,
        data.merchantId,
        data.upiId.trim(),
        data.payeeName.trim(),
        isMerchantEnabled ? 1 : 0,
        isActive ? 1 : 0,
        0,
        null,
        now,
        now
      ]);

      return this.findById(id);
    });
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM payment_receiving_accounts WHERE id = ?', [id]);
    if (!row) return null;
    return this.mapRow(row);
  }

  findByMerchantId(merchantId) {
    const rows = this.db.query(
      'SELECT * FROM payment_receiving_accounts WHERE merchant_id = ? ORDER BY is_active DESC, created_at ASC',
      [merchantId]
    );
    return rows.map(r => this.mapRow(r));
  }

  findActiveForMerchant(merchantId) {
    const row = this.db.queryOne(
      'SELECT * FROM payment_receiving_accounts WHERE merchant_id = ? AND is_active = 1 LIMIT 1',
      [merchantId]
    );
    if (!row) return null;
    return this.mapRow(row);
  }

  /**
   * Atomically activates an account and deactivates all other accounts for this merchant.
   * Backend invariant: At most ONE VPA active per merchant.
   */
  activateAccount(merchantId, accountId) {
    return this.db.transaction(() => {
      const now = new Date().toISOString();

      // Deactivate all existing accounts for this merchant
      this.db.execute(`
        UPDATE payment_receiving_accounts
        SET is_active = 0, updated_at = ?
        WHERE merchant_id = ?
      `, [now, merchantId]);

      // Activate the targeted account
      this.db.execute(`
        UPDATE payment_receiving_accounts
        SET is_active = 1, updated_at = ?
        WHERE id = ? AND merchant_id = ?
      `, [now, accountId, merchantId]);

      return this.findById(accountId);
    });
  }

  /**
   * Deactivates a specific account.
   */
  deactivateAccount(merchantId, accountId) {
    const now = new Date().toISOString();
    this.db.execute(`
      UPDATE payment_receiving_accounts
      SET is_active = 0, updated_at = ?
      WHERE id = ? AND merchant_id = ?
    `, [now, accountId, merchantId]);

    return this.findById(accountId);
  }

  /**
   * Updates an existing account's details.
   */
  updateAccount(id, data) {
    return this.db.transaction(() => {
      const existing = this.findById(id);
      if (!existing) return null;

      const now = new Date().toISOString();
      const upiId = data.upiId !== undefined ? data.upiId.trim() : existing.upiId;
      const payeeName = data.payeeName !== undefined ? data.payeeName.trim() : existing.payeeName;
      const isMerchantEnabled = data.isMerchantEnabled !== undefined ? Boolean(data.isMerchantEnabled) : existing.isMerchantEnabled;

      if (data.isActive === true) {
        this.db.execute(`
          UPDATE payment_receiving_accounts
          SET is_active = 0, updated_at = ?
          WHERE merchant_id = ?
        `, [now, existing.merchantId]);

        this.db.execute(`
          UPDATE payment_receiving_accounts
          SET upi_id = ?, payee_name = ?, is_merchant_enabled = ?, is_active = 1, updated_at = ?
          WHERE id = ?
        `, [upiId, payeeName, isMerchantEnabled ? 1 : 0, now, id]);
      } else if (data.isActive === false) {
        this.db.execute(`
          UPDATE payment_receiving_accounts
          SET upi_id = ?, payee_name = ?, is_merchant_enabled = ?, is_active = 0, updated_at = ?
          WHERE id = ?
        `, [upiId, payeeName, isMerchantEnabled ? 1 : 0, now, id]);
      } else {
        this.db.execute(`
          UPDATE payment_receiving_accounts
          SET upi_id = ?, payee_name = ?, is_merchant_enabled = ?, updated_at = ?
          WHERE id = ?
        `, [upiId, payeeName, isMerchantEnabled ? 1 : 0, now, id]);
      }

      return this.findById(id);
    });
  }

  /**
   * Deletes a receiving account.
   * Throws if the slot is currently busy.
   */
  deleteAccount(merchantId, accountId) {
    const account = this.findById(accountId);
    if (!account || account.merchantId !== merchantId) {
      throw new Error(`Account not found or does not belong to merchant: ${accountId}`);
    }

    if (account.isSlotBusy || account.currentActiveSessionId) {
      throw new Error(`Cannot delete account ${account.upiId} because it has an active checkout session.`);
    }

    this.db.execute('DELETE FROM payment_receiving_accounts WHERE id = ? AND merchant_id = ?', [accountId, merchantId]);
    return true;
  }

  /**
   * Sets slot busy status and currently active session ID.
   */
  setSlotStatus(id, isBusy, activeSessionId = null) {
    const now = new Date().toISOString();
    this.db.execute(`
      UPDATE payment_receiving_accounts
      SET is_slot_busy = ?, current_active_session_id = ?, updated_at = ?
      WHERE id = ?
    `, [isBusy ? 1 : 0, activeSessionId, now, id]);

    return this.findById(id);
  }

  /**
   * Updates or creates the active receiving UPI account for a merchant.
   * @param {string} merchantId
   * @param {string} upiId
   * @param {string} [payeeName]
   * @param {boolean} [isMerchantEnabled=true]
   */
  upsertActiveForMerchant(merchantId, upiId, payeeName = null, isMerchantEnabled = true) {
    const cleanUpi = upiId.trim();
    const existing = this.findActiveForMerchant(merchantId);
    const now = new Date().toISOString();

    if (existing) {
      this.db.execute(`
        UPDATE payment_receiving_accounts
        SET upi_id = ?, payee_name = COALESCE(?, payee_name), is_merchant_enabled = ?, updated_at = ?
        WHERE id = ?
      `, [cleanUpi, payeeName?.trim() || null, isMerchantEnabled ? 1 : 0, now, existing.id]);
      return this.findById(existing.id);
    } else {
      return this.create({
        merchantId,
        upiId: cleanUpi,
        payeeName: payeeName?.trim() || 'Merchant Store',
        isMerchantEnabled,
        isActive: true
      });
    }
  }

  mapRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      upiId: row.upi_id,
      payeeName: row.payee_name,
      isMerchantEnabled: Boolean(row.is_merchant_enabled !== undefined ? row.is_merchant_enabled : 1),
      isActive: Boolean(row.is_active),
      isSlotBusy: Boolean(row.is_slot_busy),
      currentActiveSessionId: row.current_active_session_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
