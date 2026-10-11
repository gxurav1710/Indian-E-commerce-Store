import crypto from 'node:crypto';
import { TicketStatus, SenderType } from '@youpi/common';

export class SupportTicketRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  createTicket(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO support_tickets (id, merchant_id, customer_id, payment_id, subject, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    this.db.execute(sql, [
      id,
      data.merchantId,
      data.customerId,
      data.paymentId || null,
      data.subject.trim(),
      data.status || TicketStatus.OPEN,
      now,
      now
    ]);

    if (data.initialMessage) {
      this.addMessage({
        ticketId: id,
        senderType: data.initialMessage.senderType || SenderType.CUSTOMER,
        senderId: data.initialMessage.senderId || data.customerId,
        message: data.initialMessage.message
      });
    }

    return this.findTicketById(id);
  }

  findTicketById(id) {
    const row = this.db.queryOne('SELECT * FROM support_tickets WHERE id = ?', [id]);
    if (!row) return null;
    return this.mapTicketRow(row);
  }

  findTicketsByCustomer(customerId) {
    const rows = this.db.query(
      'SELECT * FROM support_tickets WHERE customer_id = ? ORDER BY updated_at DESC',
      [customerId]
    );
    return rows.map(r => this.mapTicketRow(r));
  }

  findTicketsByMerchant(merchantId) {
    const rows = this.db.query(
      'SELECT * FROM support_tickets WHERE merchant_id = ? ORDER BY updated_at DESC',
      [merchantId]
    );
    return rows.map(r => this.mapTicketRow(r));
  }

  updateTicketStatus(ticketId, status) {
    const now = new Date().toISOString();
    this.db.execute(
      'UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?',
      [status, now, ticketId]
    );
    return this.findTicketById(ticketId);
  }

  addMessage(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const attachments = typeof data.attachments === 'object' ? JSON.stringify(data.attachments) : (data.attachments || '[]');

    this.db.execute(`
      INSERT INTO ticket_messages (id, ticket_id, sender_type, sender_id, message, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      data.ticketId,
      data.senderType,
      data.senderId,
      data.message.trim(),
      attachments,
      now
    ]);

    // Update ticket updated_at
    this.db.execute(
      'UPDATE support_tickets SET updated_at = ? WHERE id = ?',
      [now, data.ticketId]
    );

    return this.findMessageById(id);
  }

  findMessageById(id) {
    const row = this.db.queryOne('SELECT * FROM ticket_messages WHERE id = ?', [id]);
    if (!row) return null;
    return this.mapMessageRow(row);
  }

  findMessagesByTicket(ticketId) {
    const rows = this.db.query(
      'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC',
      [ticketId]
    );
    return rows.map(r => this.mapMessageRow(r));
  }

  mapTicketRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      customerId: row.customer_id,
      paymentId: row.payment_id,
      subject: row.subject,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  mapMessageRow(row) {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      senderType: row.sender_type,
      senderId: row.sender_id,
      message: row.message,
      attachments: JSON.parse(row.attachments || '[]'),
      createdAt: new Date(row.created_at)
    };
  }
}
