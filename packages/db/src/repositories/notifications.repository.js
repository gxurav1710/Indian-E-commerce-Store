export class NotificationsRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  getTemplate(id) {
    return this.db.queryOne('SELECT * FROM notification_templates WHERE id = $1', [id]);
  }

  listTemplates() {
    return this.db.query('SELECT * FROM notification_templates ORDER BY id ASC');
  }

  upsertTemplate({ id, eventType, channel = 'WHATSAPP', title, templateText, isActive = 1 }) {
    const existing = this.getTemplate(id);
    if (existing) {
      this.db.execute(
        "UPDATE notification_templates SET title = $1, template_text = $2, is_active = $3, updated_at = datetime('now') WHERE id = $4",
        [title, templateText, isActive ? 1 : 0, id]
      );
    } else {
      this.db.execute(
        "INSERT INTO notification_templates (id, event_type, channel, title, template_text, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, datetime('now'), datetime('now'))",
        [id, eventType, channel, title, templateText, isActive ? 1 : 0]
      );
    }
    return this.getTemplate(id);
  }

  createNotification(data) {
    const id = data.id || `NOTIF_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const sql = `
      INSERT INTO notifications (
        id, user_id, channel, event_type, recipient, template_id, subject, body, status, error_message, sent_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, datetime('now')
      )
    `;

    // Ensure foreign keys exist in parent tables or pass null to prevent foreign key errors
    let validUserId = null;
    if (data.userId) {
      try {
        const u = this.db.queryOne('SELECT id FROM users WHERE id = $1', [data.userId]);
        if (u) validUserId = data.userId;
      } catch {}
    }

    let validTemplateId = null;
    const reqTemplate = data.templateId || data.template;
    if (reqTemplate) {
      try {
        const t = this.getTemplate(reqTemplate);
        if (t) validTemplateId = reqTemplate;
      } catch {}
    }

    this.db.execute(sql, [
      id,
      validUserId,
      data.channel || 'WHATSAPP',
      data.eventType || data.template || 'NOTIFICATION',
      data.recipient || data.destination || '',
      validTemplateId,
      data.subject || null,
      data.body || data.content || '',
      data.status || 'PENDING',
      data.errorMessage || null,
      data.sentAt || null
    ]);

    return this.db.queryOne('SELECT * FROM notifications WHERE id = $1', [id]);
  }

  updateStatus(id, status, errorMessage = null, sentAt = null) {
    const sentTime = sentAt || (status === 'SENT' ? new Date().toISOString() : null);
    this.db.execute(
      "UPDATE notifications SET status = $1, error_message = $2, sent_at = $3 WHERE id = $4",
      [status, errorMessage, sentTime, id]
    );
    return this.db.queryOne('SELECT * FROM notifications WHERE id = $1', [id]);
  }

  listNotifications({ userId, channel, status, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM notifications WHERE 1=1';
    const params = [];
    if (userId) {
      sql += ' AND user_id = $' + (params.length + 1);
      params.push(userId);
    }
    if (channel) {
      sql += ' AND channel = $' + (params.length + 1);
      params.push(channel);
    }
    if (status) {
      sql += ' AND status = $' + (params.length + 1);
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    return this.db.query(sql, params);
  }

  markAllRead() {
    return this.db.execute("UPDATE notifications SET status = 'READ' WHERE status != 'READ'");
  }

  clearAll() {
    return this.db.execute("DELETE FROM notifications");
  }

  countUnread() {
    const row = this.db.queryOne("SELECT COUNT(*) as cnt FROM notifications WHERE status != 'READ'");
    return row ? Number(row.cnt) : 0;
  }
}

