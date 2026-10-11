export class TelegramRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  upsertSubscriber({ telegramUserId, chatId, username = null, firstName = null, lastName = null, isAdmin = false }) {
    const existing = this.db.queryOne('SELECT * FROM telegram_subscribers WHERE telegram_user_id = $1', [String(telegramUserId)]);
    if (existing) {
      this.db.execute(
        `UPDATE telegram_subscribers SET
          chat_id = $1,
          username = $2,
          first_name = $3,
          last_name = $4,
          is_admin = $5,
          is_active = 1,
          last_seen_at = datetime('now')
         WHERE telegram_user_id = $6`,
        [String(chatId), username, firstName, lastName, isAdmin ? 1 : existing.is_admin, String(telegramUserId)]
      );
      return this.getSubscriber(telegramUserId);
    } else {
      const id = `TG_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      this.db.execute(
        `INSERT INTO telegram_subscribers (
          id, telegram_user_id, chat_id, username, first_name, last_name, is_admin, is_active, first_seen_at, last_seen_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, datetime('now'), datetime('now'))`,
        [id, String(telegramUserId), String(chatId), username, firstName, lastName, isAdmin ? 1 : 0]
      );
      return this.getSubscriber(telegramUserId);
    }
  }

  getSubscriber(telegramUserId) {
    return this.db.queryOne('SELECT * FROM telegram_subscribers WHERE telegram_user_id = $1', [String(telegramUserId)]);
  }

  listActiveSubscribers(onlyAdmins = false) {
    let sql = 'SELECT * FROM telegram_subscribers WHERE is_active = 1';
    if (onlyAdmins) {
      sql += ' AND is_admin = 1';
    }
    return this.db.query(sql);
  }

  deactivateSubscriber(telegramUserId) {
    this.db.execute('UPDATE telegram_subscribers SET is_active = 0 WHERE telegram_user_id = $1', [String(telegramUserId)]);
  }

  getStoredUpdateId() {
    try {
      const row = this.db.queryOne("SELECT value FROM store_settings WHERE key = 'TELEGRAM_LAST_UPDATE_ID'");
      return row && row.value ? parseInt(row.value, 10) || 0 : 0;
    } catch {
      return 0;
    }
  }

  saveUpdateId(updateId) {
    try {
      const num = parseInt(updateId, 10);
      if (isNaN(num) || num <= 0) return;
      const existing = this.db.queryOne("SELECT value FROM store_settings WHERE key = 'TELEGRAM_LAST_UPDATE_ID'");
      if (existing) {
        this.db.execute("UPDATE store_settings SET value = $1, updated_at = datetime('now') WHERE key = 'TELEGRAM_LAST_UPDATE_ID'", [String(num)]);
      } else {
        this.db.execute("INSERT INTO store_settings (key, value, updated_at) VALUES ('TELEGRAM_LAST_UPDATE_ID', $1, datetime('now'))", [String(num)]);
      }
    } catch (err) {
      // Graceful error logging
    }
  }
}
