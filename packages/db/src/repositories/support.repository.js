export class SupportRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  createTicket(data) {
    const id = data.id || `TKT_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const existing = this.findTicketById(id);
    if (existing) {
      return this.getTicketWithMessages(id);
    }
    const sql = `
      INSERT INTO support_tickets (id, user_id, order_id, subject, category, priority, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'), datetime('now'))
    `;

    this.db.execute(sql, [
      id,
      data.userId,
      data.orderId || null,
      data.subject,
      data.category || 'ORDER_INQUIRY',
      data.priority || 'MEDIUM',
      data.status || 'OPEN'
    ]);

    // Insert first message if provided
    if (data.initialMessage) {
      this.addMessage({
        ticketId: id,
        senderType: data.senderType || 'customer',
        senderId: data.userId,
        messageType: 'text',
        content: data.initialMessage
      });
    }

    return this.getTicketWithMessages(id);
  }

  findTicketById(id) {
    return this.db.queryOne('SELECT * FROM support_tickets WHERE id = $1', [id]);
  }

  listTickets({ status, userId, orderId, limit = 50, offset = 0 } = {}) {
    let sql = `
      SELECT t.*, u.name as customer_name, u.email as customer_email, u.mobile as customer_mobile,
        o.order_number
      FROM support_tickets t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN orders o ON t.order_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND t.status = $' + (params.length + 1);
      params.push(status);
    }
    if (userId) {
      sql += ' AND t.user_id = $' + (params.length + 1);
      params.push(userId);
    }
    if (orderId) {
      sql += ' AND t.order_id = $' + (params.length + 1);
      params.push(orderId);
    }

    sql += ' ORDER BY t.updated_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    return this.db.query(sql, params);
  }

  addMessage(data) {
    const id = data.id || `MSG_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const sql = `
      INSERT INTO support_messages (id, ticket_id, sender_type, sender_id, message_type, content, attachments, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))
    `;

    this.db.execute(sql, [
      id,
      data.ticketId,
      data.senderType || 'customer',
      data.senderId,
      data.messageType || 'text',
      data.content,
      JSON.stringify(data.attachments || [])
    ]);

    // Update ticket timestamp
    this.db.execute("UPDATE support_tickets SET updated_at = datetime('now') WHERE id = $1", [data.ticketId]);

    return this.db.queryOne('SELECT * FROM support_messages WHERE id = $1', [id]);
  }

  getMessages(ticketId) {
    const messages = this.db.query('SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC', [ticketId]);
    return messages.map(m => ({
      ...m,
      attachments: typeof m.attachments === 'string' ? JSON.parse(m.attachments || '[]') : m.attachments
    }));
  }

  updateTicketStatus(ticketId, status) {
    this.db.execute("UPDATE support_tickets SET status = $1, updated_at = datetime('now') WHERE id = $2", [status, ticketId]);
    return this.findTicketById(ticketId);
  }

  getTicketWithMessages(ticketId) {
    const ticket = this.findTicketById(ticketId);
    if (!ticket) return null;

    const messages = this.getMessages(ticketId);
    const customer = this.db.queryOne('SELECT id, name, email, mobile FROM users WHERE id = $1', [ticket.user_id]);
    const order = ticket.order_id ? this.db.queryOne('SELECT id, order_number, total_amount, order_status FROM orders WHERE id = $1', [ticket.order_id]) : null;

    return {
      ...ticket,
      customer,
      order,
      messages
    };
  }
}
