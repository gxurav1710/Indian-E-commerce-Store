import crypto from 'node:crypto';
import { AuditActorType } from '@youpi/common';

export class AuditLogRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  log(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const details = typeof data.details === 'object' ? JSON.stringify(data.details) : (data.details || '{}');

    const sql = `
      INSERT INTO audit_logs (id, merchant_id, entity_type, entity_id, action, actor_type, actor_id, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    this.db.execute(sql, [
      id,
      data.merchantId || null,
      data.entityType,
      data.entityId,
      data.action,
      data.actorType || AuditActorType.SYSTEM,
      data.actorId || null,
      details,
      data.ipAddress || null,
      now
    ]);

    return id;
  }

  findByEntity(entityType, entityId) {
    const rows = this.db.query(
      'SELECT * FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC',
      [entityType, entityId]
    );
    return rows.map(r => this.mapRow(r));
  }

  findByMerchant(merchantId, limit = 100) {
    const rows = this.db.query(
      'SELECT * FROM audit_logs WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?',
      [merchantId, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  mapRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      actorType: row.actor_type,
      actorId: row.actor_id,
      details: JSON.parse(row.details || '{}'),
      ipAddress: row.ip_address,
      createdAt: new Date(row.created_at)
    };
  }
}
