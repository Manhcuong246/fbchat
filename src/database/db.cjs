'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'messenger.db'));

// Performance settings
db.pragma('journal_mode = WAL');  // Write-Ahead Logging — nhanh hơn
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = 10000');
db.pragma('foreign_keys = ON');

// ── SCHEMA ──
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    page_id     TEXT NOT NULL,
    participant_id   TEXT NOT NULL,
    participant_name TEXT NOT NULL,
    last_message     TEXT,
    last_message_time INTEGER DEFAULT 0,
    unread_count     INTEGER DEFAULT 0,
    updated_at       INTEGER DEFAULT 0,
    raw_data         TEXT  -- JSON snapshot từ Facebook
  );

  CREATE INDEX IF NOT EXISTS idx_conv_page 
    ON conversations(page_id, last_message_time DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    page_id         TEXT NOT NULL,
    text            TEXT,
    timestamp       INTEGER NOT NULL,
    is_from_page    INTEGER DEFAULT 0,
    sender_name     TEXT,
    sender_id       TEXT,
    has_attachment  INTEGER DEFAULT 0,
    attachments     TEXT,  -- JSON array
    status          TEXT DEFAULT 'received',
    created_at      INTEGER DEFAULT (unixepoch() * 1000),

    FOREIGN KEY (conversation_id) 
      REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_msg_conv 
    ON messages(conversation_id, timestamp DESC);

  CREATE INDEX IF NOT EXISTS idx_msg_page 
    ON messages(page_id, timestamp DESC);

  CREATE TABLE IF NOT EXISTS page_tokens (
    page_id      TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    page_name    TEXT,
    updated_at   INTEGER DEFAULT (unixepoch() * 1000)
  );
`);
try {
  db.prepare('ALTER TABLE conversations ADD COLUMN participant_picture_url TEXT').run();
} catch (_) { /* column may already exist */ }
try {
  db.prepare('ALTER TABLE messages ADD COLUMN reply_to_id TEXT').run();
} catch (_) { /* column may already exist */ }
try {
  db.prepare('ALTER TABLE messages ADD COLUMN reply_to_text TEXT').run();
} catch (_) { /* column may already exist */ }
try {
  db.prepare('ALTER TABLE messages ADD COLUMN reply_to_is_from_page INTEGER').run();
} catch (_) { /* column may already exist */ }

// ── PREPARED STATEMENTS (nhanh hơn dynamic query) ──

const stmts = {
  // Conversations
  upsertConversation: db.prepare(`
    INSERT INTO conversations 
      (id, page_id, participant_id, participant_name, participant_picture_url,
       last_message, last_message_time, unread_count, updated_at, raw_data)
    VALUES 
      (@id, @page_id, @participant_id, @participant_name, @participant_picture_url,
       @last_message, @last_message_time, @unread_count, @updated_at, @raw_data)
    ON CONFLICT(id) DO UPDATE SET
      participant_id    = excluded.participant_id,
      participant_name  = excluded.participant_name,
      participant_picture_url = excluded.participant_picture_url,
      last_message      = excluded.last_message,
      last_message_time = excluded.last_message_time,
      unread_count      = excluded.unread_count,
      updated_at        = excluded.updated_at,
      raw_data          = excluded.raw_data
  `),

  getConversations: db.prepare(`
    SELECT * FROM conversations 
    WHERE page_id = ?
    ORDER BY last_message_time DESC
    LIMIT 50
  `),

  getConversationsPaginated: db.prepare(`
    SELECT * FROM conversations 
    WHERE page_id = ? AND (? IS NULL OR last_message_time < ?)
    ORDER BY last_message_time DESC
    LIMIT ?
  `),

  getConversationsByPages: db.prepare(`
    SELECT * FROM conversations 
    WHERE page_id IN (SELECT value FROM json_each(?))
    ORDER BY last_message_time DESC
    LIMIT 100
  `),

  getConversationsByPagesPaginated: db.prepare(`
    SELECT * FROM conversations 
    WHERE page_id IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR last_message_time < ?)
    ORDER BY last_message_time DESC
    LIMIT ?
  `),

  getConversationByParticipant: db.prepare(`
    SELECT * FROM conversations
    WHERE page_id = ? AND participant_id = ?
    LIMIT 1
  `),

  getConversationById: db.prepare(`
    SELECT * FROM conversations WHERE id = ? LIMIT 1
  `),

  markConvRead: db.prepare(`
    UPDATE conversations SET unread_count = 0 WHERE id = ?
  `),

  incrementUnread: db.prepare(`
    UPDATE conversations SET unread_count = unread_count + 1 WHERE id = ?
  `),

  updateParticipantName: db.prepare(`
    UPDATE conversations SET participant_name = ? WHERE id = ? AND (participant_name = 'Unknown' OR participant_name = '' OR participant_name IS NULL)
  `),

  updateConversationLastMessage: db.prepare(`
    UPDATE conversations SET last_message = ?, last_message_time = ? WHERE id = ?
  `),

  // Messages — cập nhật sender_name khi có từ API (webhook thường để trống)
  upsertMessage: db.prepare(`
    INSERT INTO messages
      (id, conversation_id, page_id, text, timestamp, is_from_page,
       sender_name, sender_id, has_attachment, attachments, status,
       reply_to_id, reply_to_text, reply_to_is_from_page)
    VALUES
      (@id, @conversation_id, @page_id, @text, @timestamp, @is_from_page,
       @sender_name, @sender_id, @has_attachment, @attachments, @status,
       @reply_to_id, @reply_to_text, @reply_to_is_from_page)
    ON CONFLICT(id) DO UPDATE SET
      sender_name = CASE WHEN excluded.sender_name != '' THEN excluded.sender_name ELSE sender_name END,
      sender_id = CASE WHEN excluded.sender_id != '' THEN excluded.sender_id ELSE sender_id END,
      reply_to_id = excluded.reply_to_id,
      reply_to_text = excluded.reply_to_text,
      reply_to_is_from_page = excluded.reply_to_is_from_page
  `),

  getMessages: db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY timestamp DESC
    LIMIT 50
  `),

  getMessagesBefore: db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ? AND timestamp < ?
    ORDER BY timestamp DESC
    LIMIT 25
  `),

  getLatestMessage: db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `),

  getLatestParticipantMessage: db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ? AND is_from_page = 0 AND (sender_name IS NOT NULL AND sender_name != '')
    ORDER BY timestamp DESC
    LIMIT 1
  `),

  getMessageById: db.prepare(`SELECT * FROM messages WHERE id = ? LIMIT 1`),

  // Page tokens
  upsertToken: db.prepare(`
    INSERT INTO page_tokens (page_id, access_token, page_name, updated_at)
    VALUES (@page_id, @access_token, @page_name, @updated_at)
    ON CONFLICT(page_id) DO UPDATE SET
      access_token = excluded.access_token,
      page_name    = excluded.page_name,
      updated_at   = excluded.updated_at
  `),

  getToken: db.prepare(`SELECT access_token FROM page_tokens WHERE page_id = ?`),
};

// ── DB API ──

module.exports = {
  db,

  // Conversations
  upsertConversation(conv) {
    stmts.upsertConversation.run(conv);
  },

  upsertConversations(convs) {
    const run = db.transaction((list) => {
      list.forEach(c => stmts.upsertConversation.run(c));
    });
    run(convs);
  },

  getConversations(pageId) {
    return stmts.getConversations.all(pageId);
  },

  getConversationsPaginated(pageId, limit, afterTimestamp) {
    return stmts.getConversationsPaginated.all(pageId, afterTimestamp, afterTimestamp, limit);
  },

  getConversationsByPages(pageIds) {
    return stmts.getConversationsByPages.all(JSON.stringify(pageIds));
  },

  getConversationsByPagesPaginated(pageIds, limit, afterTimestamp) {
    return stmts.getConversationsByPagesPaginated.all(
      JSON.stringify(pageIds),
      afterTimestamp,
      afterTimestamp,
      limit
    );
  },

  getConversationByParticipant(pageId, participantId) {
    return stmts.getConversationByParticipant.get(pageId, participantId) ?? null;
  },

  getConversationById(convId) {
    return stmts.getConversationById.get(convId) ?? null;
  },

  markConvRead(convId) {
    stmts.markConvRead.run(convId);
  },

  incrementUnread(convId) {
    stmts.incrementUnread.run(convId);
  },

  updateParticipantName(convId, participantName) {
    stmts.updateParticipantName.run(participantName, convId);
  },

  updateConversationLastMessage(convId, text, lastMessageTime) {
    stmts.updateConversationLastMessage.run(text || 'Tệp đính kèm', lastMessageTime, convId);
  },

  // Messages
  upsertMessage(msg) {
    stmts.upsertMessage.run(msg);
  },

  upsertMessages(msgs) {
    const run = db.transaction((list) => {
      list.forEach(m => stmts.upsertMessage.run(m));
    });
    run(msgs);
  },

  getMessages(convId) {
    const rows = stmts.getMessages.all(convId);
    return rows.reverse(); // DESC → oldest-first for display
  },

  getMessagesBefore(convId, beforeTimestamp) {
    return stmts.getMessagesBefore.all(convId, beforeTimestamp);
  },

  getLatestMessage(convId) {
    return stmts.getLatestMessage.get(convId);
  },

  getLatestParticipantMessage(convId) {
    return stmts.getLatestParticipantMessage.get(convId);
  },

  getMessageById(id) {
    return stmts.getMessageById.get(id) ?? null;
  },

  /** Xóa toàn bộ dữ liệu trong database (giữ nguyên schema). */
  clearAllData() {
    const run = db.transaction(() => {
      db.prepare('DELETE FROM messages').run();
      db.prepare('DELETE FROM conversations').run();
      db.prepare('DELETE FROM page_tokens').run();
    });
    run();
  },
};
