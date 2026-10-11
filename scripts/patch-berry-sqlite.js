import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const patchedContent = `/**
 * @module modulo
 * @description Enhanced message sending capabilities including albums, cards,
 * interactive buttons, and rich media support beyond standard WhatsApp messages.
 * @license Apache-2.0
 * @author Lipe Devv and Berry Protocol
 */
import { DatabaseSync as Database } from "node:sqlite";
export class SQLiteStore {
    db;
    constructor(path = process.env.BERRY_SQLITE_PATH ?? "berrysdk.db") {
        this.db = new Database(path);
        this.migrate();
    }
    migrate() {
        this.db.exec(\`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        session_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chats (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (id, session_id)
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (id, session_id)
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (id, session_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        remote_jid TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (id, session_id)
      );

      CREATE TABLE IF NOT EXISTS message_acks (
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (message_id, session_id)
      );
    \`);
    }
    saveSession(sessionId, snapshot) {
        this.db
            .prepare(\`
          INSERT INTO auth_sessions(session_id, payload, updated_at)
          VALUES (@session_id, @payload, @updated_at)
          ON CONFLICT(session_id) DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at
        \`)
            .run({
            session_id: sessionId,
            payload: JSON.stringify(snapshot),
            updated_at: new Date().toISOString(),
        });
    }
    getSession(sessionId) {
        const row = this.db
            .prepare(\`SELECT payload FROM auth_sessions WHERE session_id = ?\`)
            .get(sessionId);
        return row ? JSON.parse(row.payload) : null;
    }
    deleteSession(sessionId) {
        this.db.prepare(\`DELETE FROM auth_sessions WHERE session_id = ?\`).run(sessionId);
    }
    upsertChats(sessionId, chats) {
        const statement = this.db.prepare(\`
      INSERT INTO chats(id, session_id, payload)
      VALUES (@id, @session_id, @payload)
      ON CONFLICT(id, session_id) DO UPDATE SET payload = excluded.payload
    \`);
        for (const chat of chats) {
            statement.run({
                id: chat.id,
                session_id: sessionId,
                payload: JSON.stringify(chat),
            });
        }
    }
    upsertContacts(sessionId, contacts) {
        const statement = this.db.prepare(\`
      INSERT INTO contacts(id, session_id, payload)
      VALUES (@id, @session_id, @payload)
      ON CONFLICT(id, session_id) DO UPDATE SET payload = excluded.payload
    \`);
        for (const contact of contacts) {
            statement.run({
                id: contact.id,
                session_id: sessionId,
                payload: JSON.stringify(contact),
            });
        }
    }
    upsertGroups(sessionId, groups) {
        const statement = this.db.prepare(\`
      INSERT INTO groups(id, session_id, payload)
      VALUES (@id, @session_id, @payload)
      ON CONFLICT(id, session_id) DO UPDATE SET payload = excluded.payload
    \`);
        for (const group of groups) {
            statement.run({
                id: group.id,
                session_id: sessionId,
                payload: JSON.stringify(group),
            });
        }
    }
    upsertMessages(sessionId, messages) {
        const statement = this.db.prepare(\`
      INSERT INTO messages(id, session_id, remote_jid, payload)
      VALUES (@id, @session_id, @remote_jid, @payload)
      ON CONFLICT(id, session_id) DO UPDATE SET payload = excluded.payload
    \`);
        for (const message of messages) {
            statement.run({
                id: message.id,
                session_id: sessionId,
                remote_jid: message.chatId ?? message.remoteJid ?? message.to ?? message.from ?? "",
                payload: JSON.stringify(message),
            });
        }
    }
    upsertAck(sessionId, ack) {
        this.db
            .prepare(\`
        INSERT INTO message_acks(message_id, session_id, payload)
        VALUES (@message_id, @session_id, @payload)
        ON CONFLICT(message_id, session_id) DO UPDATE SET payload = excluded.payload
      \`)
            .run({
            message_id: ack.messageId,
            session_id: sessionId,
            payload: JSON.stringify(ack),
        });
    }
}
`;

function findAndPatch(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue;
      findAndPatch(fullPath);
    } else if (entry.isFile() && entry.name === 'index.js') {
      if (fullPath.includes('@berrysdk') && fullPath.includes('store') && fullPath.includes('dist')) {
        try {
          fs.writeFileSync(fullPath, patchedContent, 'utf8');
          console.log(`[Patch] Successfully updated: ${fullPath}`);
        } catch (e) {
          console.error(`Error patching ${fullPath}:`, e.message);
        }
      }
    }
  }
}

console.log('[Patch] Scanning workspace for @berrysdk/store/dist/index.js instances...');
findAndPatch(path.join(rootDir, 'services/whatsapp-worker/node_modules'));
findAndPatch(path.join(rootDir, 'scratch/test_berry/node_modules'));
findAndPatch(path.join(rootDir, 'services/whatsapp-auth/node_modules'));
if (fs.existsSync(path.join(rootDir, 'node_modules'))) {
  findAndPatch(path.join(rootDir, 'node_modules'));
}
console.log('[Patch] Scan and patch complete!');
