export class AuditRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  logAction({ actor, action, resource, resourceId = null, beforeData = null, afterData = null, ipAddress = null }) {
    const id = `AUDIT_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const sql = `
      INSERT INTO audit_logs (id, actor, action, resource, resource_id, before_data, after_data, ip_address, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, datetime('now'))
    `;

    this.db.execute(sql, [
      id,
      actor,
      action,
      resource,
      resourceId,
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null,
      ipAddress
    ]);

    return this.db.queryOne('SELECT * FROM audit_logs WHERE id = $1', [id]);
  }

  listLogs({ actor, action, resource, limit = 100, offset = 0 } = {}) {
    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    if (actor) {
      sql += ' AND actor = $' + (params.length + 1);
      params.push(actor);
    }
    if (action) {
      sql += ' AND action = $' + (params.length + 1);
      params.push(action);
    }
    if (resource) {
      sql += ' AND resource = $' + (params.length + 1);
      params.push(resource);
    }

    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const logs = this.db.query(sql, params);
    return logs.map(l => ({
      ...l,
      before_data: l.before_data ? JSON.parse(l.before_data) : null,
      after_data: l.after_data ? JSON.parse(l.after_data) : null
    }));
  }
}
