'use strict';
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const fetch = require('node-fetch');
const NodeCache = require('node-cache');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const dbModule = require('./src/database/db.cjs');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ── DIRECTORIES ──
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
[UPLOAD_DIR, DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── JSON helpers ──
function readJSON(filePath, defaultVal) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return defaultVal; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const getPageDir = (pageId) => {
  const dir = path.join(UPLOAD_DIR, pageId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const getSettingsPath   = (pageId) => path.join(DATA_DIR, `settings_${pageId}.json`);
const getQuickRepliesPath = (pageId) => path.join(DATA_DIR, `quick_replies_${pageId}.json`);
const getLibraryMetaPath  = (pageId) => path.join(getPageDir(pageId), 'meta.json');
const getPageTokensPath = () => path.join(DATA_DIR, 'page_tokens.json');

function savePageToken(pageId, accessToken) {
  const tokens = readJSON(getPageTokensPath(), {});
  tokens[pageId] = { accessToken, savedAt: Date.now() };
  writeJSON(getPageTokensPath(), tokens);
  cacheSet(`page_token_${pageId}`, accessToken, 60 * 60);
}

async function validateAndSavePageToken(pageId, accessToken) {
  try {
    const testUrl = `${FB_API}/me?fields=id,name&access_token=${accessToken}`;
    const r = await fetch(testUrl);
    const data = await r.json();
    if (data.error) {
      console.error(`[TOKEN] Invalid token for page ${pageId}:`, data.error.message);
      return false;
    }
    savePageToken(pageId, accessToken);
    console.log(`[TOKEN] Valid token saved for page ${pageId} (${data.name})`);
    return true;
  } catch (e) {
    console.error('[TOKEN] Validation failed:', e.message);
    return false;
  }
}

function loadPageTokens() {
  const tokens = readJSON(getPageTokensPath(), {});
  Object.entries(tokens).forEach(([pageId, data]) => {
    if (data.accessToken) {
      cacheSet(`page_token_${pageId}`, data.accessToken, 60 * 60);
      console.log(`[TOKEN] Restored token for page ${pageId}`);
    }
  });
}

// ── IMAGE LIBRARY — disk storage (fixed) ──
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const pageId = req.params.pageId;
    if (!pageId) return cb(new Error('Missing pageId'), '');
    cb(null, getPageDir(pageId));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const base = path.basename(file.originalname, ext)
      .replace(/[^\w\u00C0-\u024F\u4E00-\u9FFF\s-]/g, '')
      .trim().replace(/\s+/g, '_').substring(0, 80);
    cb(null, `${base}_${Date.now()}${ext}`);
  },
});

const diskUpload = multer({
  storage: diskStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Chỉ nhận file ảnh'));
  },
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', etag: true }));

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = 3001;
const FB_API = 'https://graph.facebook.com/v19.0';
const WEBHOOK_VERIFY_TOKEN = 'fb_messenger_webhook_2024';

// ============================================================
// CACHE LAYER
// Tất cả data đều đi qua đây trước khi gọi Facebook API
// ============================================================

const cache = new NodeCache({ 
  stdTTL: 0,           // không set default, từng key tự set TTL
  checkperiod: 120,    // tự dọn expired keys mỗi 2 phút
  useClones: false,    // không clone object để tiết kiệm memory
});

// TTL config tập trung — dễ chỉnh sửa sau
const TTL = {
  PAGE_INFO:        60 * 60,      // 1 giờ — thông tin Page ít thay đổi
  CONVERSATIONS:    30,           // 30 giây — cần fresh để hiện unread
  MESSAGES:         5 * 60,       // 5 phút — tin nhắn cũ không đổi
  MESSAGES_NEW:     10,           // 10 giây — tin nhắn gần nhất
  ATTACHMENT:       24 * 60 * 60, // 24 giờ — attachment không bao giờ đổi
  IMAGE:            24 * 60 * 60, // 24 giờ — ảnh không đổi
  PARTICIPANT:      6 * 60 * 60,  // 6 giờ — thông tin user ít đổi
  POLL_SIGNATURE:   0,            // không cache — luôn fresh
};

// DB layer cache TTL (smart cache)
const CACHE_TTL = {
  CONVERSATIONS: 60,   // 1 phút
  MESSAGES:      300,  // 5 phút
  PAGE_INFO:     3600, // 1 giờ
};

async function getCached(key, ttl, fetchFn) {
  const cached = cache.get(key);
  if (cached !== undefined) return { data: cached, fromCache: true };
  const data = await fetchFn();
  if (data) cache.set(key, data, ttl);
  return { data, fromCache: false };
}

// Map DB conversation row to FB API shape (for frontend compatibility)
function mapDbConvToFbShape(row, includePageId = false) {
  let snippet = row.last_message || '';
  if (!snippet) {
    const latest = dbModule.getLatestMessage(row.id);
    if (latest) {
      snippet = latest.text || (latest.has_attachment ? 'Tệp đính kèm' : '');
    }
  }
  const base = {
    id: row.id,
    participants: {
      data: [{
        id: row.participant_id,
        name: row.participant_name,
        picture: row.participant_picture_url || undefined,
      }],
    },
    snippet,
    updated_time: row.last_message_time ? new Date(row.last_message_time).toISOString() : '',
    unread_count: row.unread_count || 0,
  };
  if (includePageId && row.page_id) base.page_id = row.page_id;
  return base;
}

// Map DB message row to FB API shape (includes is_from_page for client)
function mapDbMsgToFbShape(row, pageId) {
  const isFromPage = row.is_from_page === 1;
  return {
    id: row.id,
    message: row.text || null,
    created_time: row.timestamp ? new Date(row.timestamp).toISOString() : '',
    from: {
      id: isFromPage ? (pageId || row.sender_id || '') : (row.sender_id || ''),
      name: row.sender_name || '',
    },
    is_from_page: row.is_from_page,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    attachments: row.attachments ? { data: JSON.parse(row.attachments) } : { data: [] },
    reply_to_id: row.reply_to_id || null,
    reply_to_text: row.reply_to_text || null,
    reply_to_is_from_page: row.reply_to_is_from_page ?? null,
  };
}

// Cache helper với log
function cacheGet(key) {
  const val = cache.get(key);
  if (val !== undefined) {
    console.log(`[CACHE HIT] ${key}`);
    return val;
  }
  console.log(`[CACHE MISS] ${key}`);
  return null;
}

function cacheSet(key, value, ttl) {
  cache.set(key, value, ttl);
  console.log(`[CACHE SET] ${key} TTL=${ttl}s`);
}

function cacheDel(key) {
  cache.del(key);
  console.log(`[CACHE DEL] ${key}`);
}

function cacheDelPrefix(prefix) {
  const keys = cache.keys().filter(k => k.startsWith(prefix));
  keys.forEach(k => cache.del(k));
  console.log(`[CACHE DEL PREFIX] ${prefix} (${keys.length} keys)`);
}

// Stats endpoint để debug
app.get('/cache/stats', (req, res) => {
  res.json({
    keys: cache.keys().length,
    stats: cache.getStats(),
    keyList: cache.keys(),
  });
});

app.delete('/cache/flush', (req, res) => {
  cache.flushAll();
  res.json({ ok: true, message: 'Cache cleared' });
});

app.delete('/db/clear', (req, res) => {
  try {
    dbModule.clearAllData();
    cache.flushAll();
    console.log('[DB] Cleared all data');
    res.json({ ok: true, message: 'Database cleared' });
  } catch (e) {
    console.error('[DB] Clear error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/db/stats', (req, res) => {
  const stats = {
    conversations: dbModule.db.prepare('SELECT COUNT(*) as count FROM conversations').get(),
    messages: dbModule.db.prepare('SELECT COUNT(*) as count FROM messages').get(),
    cache: cache.getStats(),
    cacheKeys: cache.keys().length,
  };
  res.json(stats);
});

// ── DEBUG: Enrich flow diagnostic ──
app.get('/debug/enrich/:pageId', async (req, res) => {
  const { pageId } = req.params;
  const tokenFromCache = cache.get(`page_token_${pageId}`);
  const tokenFromDisk = readJSON(getPageTokensPath(), {})[pageId]?.accessToken;
  const token = tokenFromCache || tokenFromDisk;

  const convs = dbModule.getConversations(pageId);
  const unknowns = convs.filter((c) => !c.participant_name || c.participant_name === 'Unknown');

  let testResult = null;
  if (unknowns[0] && token) {
    try {
      const url =
        `${FB_API}/${pageId}/conversations` +
        `?fields=id,participants{id,name}` +
        `&user_id=${encodeURIComponent(unknowns[0].participant_id)}&platform=messenger&limit=1` +
        `&access_token=${token}`;
      const r = await fetch(url);
      testResult = await r.json();
    } catch (e) {
      testResult = { error: e.message };
    }
  }

  res.json({
    pageId,
    tokenInCache: !!tokenFromCache,
    tokenOnDisk: !!tokenFromDisk,
    token_preview: token ? token.substring(0, 20) + '...' : null,
    totalConvs: convs.length,
    unknownConvs: unknowns.length,
    firstUnknown: unknowns[0] || null,
    facebookApiTest: testResult,
  });
});

// ============================================================
// Socket.io — realtime cho nhiều nhân viên / nhiều thiết bị
// ============================================================

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 30000,
  pingInterval: 10000,
});

const connectedClients = new Map();

io.on('connection', (socket) => {
  console.log(`[SOCKET] Connected: ${socket.id}`);

  socket.on('subscribe', ({ pageIds }) => {
    if (!Array.isArray(pageIds)) return;
    pageIds.forEach((pageId) => {
      socket.join(`page:${pageId}`);
      console.log(`[SOCKET] ${socket.id} joined page:${pageId}`);
    });
    connectedClients.set(socket.id, { pageIds });
    socket.emit('subscribed', { pageIds, socketId: socket.id });
  });

  socket.on('disconnect', (reason) => {
    connectedClients.delete(socket.id);
    console.log(`[SOCKET] Disconnected: ${socket.id} (${reason})`);
  });
});

function broadcastToPage(pageId, event, data) {
  io.to(`page:${pageId}`).emit(event, data);
  const room = io.sockets.adapter.rooms.get(`page:${pageId}`);
  console.log(`[SOCKET EMIT] ${event} → room page:${pageId} | clients: ${room?.size ?? 0}`);
}

function broadcastAll(event, data) {
  io.emit(event, data);
}

// ============================================================
// WEBHOOK
// ============================================================

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('[WEBHOOK] Verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Thay thế toàn bộ logic xử lý incoming message
function handleIncomingMessage(pageId, senderId, event, timestamp) {
  let conv = dbModule.getConversationByParticipant(pageId, senderId);

  if (!conv) {
    const threadId = `thread_${pageId}_${senderId}`;
    dbModule.upsertConversation({
      id: threadId,
      page_id: pageId,
      participant_id: senderId,
      participant_name: 'Unknown',
      participant_picture_url: null,
      last_message: event.message.text || (event.message.attachments?.length ? 'Tệp đính kèm' : ''),
      last_message_time: timestamp * 1000,
      unread_count: 1,
      updated_at: Date.now(),
      raw_data: null,
    });
    conv = dbModule.getConversationByParticipant(pageId, senderId);
  }

  const convId = conv?.id ?? `thread_${pageId}_${senderId}`;

  dbModule.upsertMessage({
    id: event.message.mid,
    conversation_id: convId,
    page_id: pageId,
    text: event.message.text || null,
    timestamp: timestamp * 1000,
    is_from_page: 0,
    sender_name: '',
    sender_id: senderId,
    has_attachment: (event.message.attachments?.length || 0) > 0 ? 1 : 0,
    attachments: JSON.stringify(event.message.attachments || []),
    status: 'received',
  });

  if (conv) {
    dbModule.incrementUnread(conv.id);
    dbModule.upsertConversation({
      ...conv,
      last_message: event.message.text || 'Tệp đính kèm',
      last_message_time: timestamp * 1000,
      updated_at: Date.now(),
    });
  }

  cache.del(`convs:${pageId}`);
  cache.del(`msgs:${convId}`);
  cacheDelPrefix('convs_merged:');

  broadcastToPage(pageId, 'new_message', {
    pageId,
    senderId,
    convId,
    messageId: event.message.mid,
    text: event.message.text || null,
    timestamp,
    attachments: event.message.attachments || [],
  });

  resolveAndEnrichConversation(pageId, senderId, convId).catch(console.error);
}

// Resolve thread_xxx → real FB ID, enrich participant name
async function resolveAndEnrichConversation(pageId, participantId, currentConvId) {
  const tokenFromCache = cache.get(`page_token_${pageId}`);
  const tokenFromDisk = readJSON(getPageTokensPath(), {})[pageId]?.accessToken;
  const token = tokenFromCache || tokenFromDisk;

  if (!token) {
    console.error(`[ENRICH] No token for page ${pageId} — cannot enrich ${currentConvId}`);
    return;
  }

  console.log(`[ENRICH] Resolving conv=${currentConvId} participant=${participantId} page=${pageId}`);

  try {
    const url =
      `${FB_API}/${pageId}/conversations` +
      `?fields=id,participants{id,name,picture.type(large)}` +
      `&user_id=${encodeURIComponent(participantId)}&platform=messenger&limit=1` +
      `&access_token=${token}`;

    console.log(`[ENRICH] Calling FB API...`);
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error(`[ENRICH] FB API error:`, data.error.message);
      return;
    }

    console.log(`[ENRICH] FB API response:`, JSON.stringify(data).substring(0, 200));

    const fbConv = data.data?.[0];
    if (!fbConv) {
      console.warn(`[ENRICH] No conversation found for participant ${participantId}`);
      return;
    }

    const realId = fbConv.id;
    const participant = fbConv.participants?.data?.find((p) => p.id !== pageId);
    const realName = participant?.name || null;
    const realPicture = participant?.picture?.data?.url || null;

    console.log(`[ENRICH] Found: convId=${realId} name=${realName} picture=${!!realPicture}`);

    if (realId && realId !== currentConvId && currentConvId.startsWith('thread_')) {
      const oldConv = dbModule.getConversationById(currentConvId);
      if (oldConv) {
        dbModule.upsertConversation({
          ...oldConv,
          id: realId,
          participant_name: realName || oldConv.participant_name,
          participant_picture_url: realPicture || oldConv.participant_picture_url,
        });
        dbModule.db.prepare(`UPDATE messages SET conversation_id=? WHERE conversation_id=?`).run(realId, currentConvId);
        dbModule.db.prepare(`DELETE FROM conversations WHERE id=?`).run(currentConvId);

        cache.del(`msgs:${currentConvId}`);
        cache.del(`msgs:${realId}`);
        cache.del(`convs:${pageId}`);
        cacheDelPrefix('convs_merged:');

        console.log(`[ENRICH] Merged ${currentConvId} -> ${realId} name=${realName}`);

        broadcastToPage(pageId, 'conv_id_resolved', {
          pageId,
          oldConvId: currentConvId,
          newConvId: realId,
          participantName: realName,
          participantPicture: realPicture,
        });
      }
    } else if (realName && realName !== 'Unknown') {
      dbModule.updateParticipantName(currentConvId, realName);
      if (realPicture) {
        dbModule.db.prepare(`UPDATE conversations SET participant_picture_url=? WHERE id=?`).run(realPicture, currentConvId);
      }
      cache.del(`convs:${pageId}`);
      cacheDelPrefix('convs_merged:');

      console.log(`[ENRICH] Updated name=${realName} for conv=${currentConvId}`);

      broadcastToPage(pageId, 'participant_updated', {
        pageId,
        convId: currentConvId,
        participantName: realName,
        participantPicture: realPicture,
      });
    }
  } catch (e) {
    console.error('[ENRICH] Exception:', e.message);
  }
}

app.post('/webhook', (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== 'page') return;

  body.entry?.forEach((entry) => {
    const pageId = entry.id;

    entry.messaging?.forEach((event) => {
      const senderId = event.sender?.id;
      const recipientId = event.recipient?.id;
      const timestamp = event.timestamp;

      if (event.message && !event.message.is_echo) {
        handleIncomingMessage(recipientId, senderId, event, timestamp);
      }

      if (event.message?.is_echo) {
        const pageIdEcho = senderId;
        let conv = dbModule.getConversationByParticipant(pageIdEcho, recipientId);
        if (!conv) {
          const threadId = `thread_${pageIdEcho}_${recipientId}`;
          dbModule.upsertConversation({
            id: threadId,
            page_id: pageIdEcho,
            participant_id: recipientId,
            participant_name: 'Unknown',
            participant_picture_url: null,
            last_message: event.message.text || 'Tệp đính kèm',
            last_message_time: timestamp * 1000,
            unread_count: 0,
            updated_at: Date.now(),
            raw_data: null,
          });
          conv = dbModule.getConversationByParticipant(pageIdEcho, recipientId);
        }
        const convId = conv ? conv.id : `thread_${pageIdEcho}_${recipientId}`;

        dbModule.upsertMessage({
          id: event.message.mid,
          conversation_id: convId,
          page_id: pageIdEcho,
          text: event.message.text || null,
          timestamp: timestamp * 1000,
          is_from_page: 1,
          sender_name: '',
          sender_id: pageIdEcho,
          has_attachment: (event.message.attachments?.length || 0) > 0 ? 1 : 0,
          attachments: JSON.stringify(event.message.attachments || []),
          status: 'sent',
        });

        cache.del(`convs:${pageIdEcho}`);
        cacheDelPrefix('convs_merged:');
        cache.del(`msgs:${convId}`);

        console.log(`[WEBHOOK] echo page=${pageIdEcho} to=${recipientId} conv=${convId}`);
        broadcastToPage(pageIdEcho, 'message_echo', {
          pageId: pageIdEcho,
          recipientId,
          convId,
          messageId: event.message.mid,
          text: event.message.text || null,
          timestamp,
        });
      }

      if (event.read) {
        broadcastToPage(pageId, 'message_read', {
          type: 'message_read',
          pageId,
          senderId,
          watermark: event.read.watermark,
        });
      }

      if (event.sender_action === 'typing_on') {
        broadcastToPage(pageId, 'typing', { senderId, isTyping: true });
      }
    });
  });
});

// ============================================================
// API PROXY — Tất cả Facebook API calls qua đây
// Mọi endpoint đều check cache trước khi gọi Facebook
// ============================================================

// ── AUTH: Validate User Token ──
app.get('/api/auth/me', async (req, res) => {
  const { userToken } = req.query;
  if (!userToken) return res.status(400).json({ error: 'Missing userToken' });

  const cacheKey = `user_me_${userToken.substring(0, 20)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = `${FB_API}/me?fields=id,name,picture{url}&access_token=${userToken}`;
    const fbRes = await fetch(url);
    const data = await fbRes.json();

    if (!fbRes.ok || data.error) {
      console.error('[AUTH ME] Error:', data.error?.message);
      return res.status(401).json({ error: data.error?.message || 'Token không hợp lệ' });
    }

    cacheSet(cacheKey, data, TTL.PAGE_INFO);
    res.json(data);
  } catch (e) {
    console.error('[AUTH ME] Network error:', e.message);
    res.status(500).json({ error: 'Network error' });
  }
});

// ── AUTH: Lấy danh sách Pages từ User Token ──
app.get('/api/auth/pages', async (req, res) => {
  const { userToken } = req.query;
  if (!userToken) return res.status(400).json({ error: 'Missing userToken' });

  const cacheKey = `user_pages_${userToken.substring(0, 20)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = `${FB_API}/me/accounts`
      + `?fields=id,name,picture{url},access_token,tasks,category`
      + `&access_token=${userToken}`;

    const fbRes = await fetch(url);
    const data = await fbRes.json();

    if (!fbRes.ok || data.error) {
      console.error('[AUTH PAGES] Error:', data.error?.message);
      return res.status(fbRes.status).json({ error: data.error?.message || 'Token không hợp lệ' });
    }

    const pages = (data.data || []).map(page => ({
      id: page.id,
      name: page.name,
      avatarUrl: page.picture?.data?.url || null,
      accessToken: page.access_token,
      category: page.category || '',
      tasks: page.tasks || [],
    }));

    const result = { pages, total: pages.length };
    cacheSet(cacheKey, result, TTL.PAGE_INFO);
    await Promise.all(
      pages.filter((p) => p.accessToken).map((p) => validateAndSavePageToken(p.id, p.accessToken))
    );
    res.json(result);
  } catch (e) {
    console.error('[AUTH PAGES] Network error:', e.message);
    res.status(500).json({ error: 'Network error' });
  }
});

// ── ENRICH PARTICIPANTS (re-trigger enrich for Unknown) ──
app.post('/api/enrich-participants', async (req, res) => {
  const { convIds, pageId } = req.body || {};
  if (!pageId) {
    return res.status(400).json({ error: 'Missing pageId' });
  }

  let token = cache.get(`page_token_${pageId}`);
  if (!token) {
    const tokens = readJSON(getPageTokensPath(), {});
    token = tokens[pageId]?.accessToken;
  }
  if (!token) {
    return res.status(400).json({ error: 'No token for this page' });
  }

  const convs =
    convIds === 'ALL'
      ? dbModule.getConversations(pageId).filter(
          (c) => !c.participant_name || c.participant_name === 'Unknown'
        )
      : (Array.isArray(convIds) ? convIds : []).map((id) => dbModule.getConversationById(id)).filter(Boolean);

  res.json({ ok: true, message: 'Enriching in background', queued: convs.length });

  console.log(`[ENRICH API] Processing ${convs.length} conversations`);

  for (let i = 0; i < convs.length; i++) {
    const conv = convs[i];
    await new Promise((r) => setTimeout(r, 400 * i));
    resolveAndEnrichConversation(pageId, conv.participant_id, conv.id).catch((e) =>
      console.error('[ENRICH API]', e.message)
    );
  }
});

// ── SUBSCRIBE PAGE TO WEBHOOK (bắt buộc để nhận tin nhắn) ──
app.post('/api/subscribe-page', async (req, res) => {
  const { pageId, pageAccessToken } = req.body || {};
  if (!pageId || !pageAccessToken) {
    const missing = [];
    if (!pageId) missing.push('pageId');
    if (!pageAccessToken) missing.push('pageAccessToken');
    return res.status(400).json({ error: `Missing: ${missing.join(', ')}` });
  }
  try {
    const url = `${FB_API}/${pageId}/subscribed_apps`
      + `?subscribed_fields=messages,message_echoes,messaging_postbacks,message_reads`
      + `&access_token=${encodeURIComponent(pageAccessToken)}`;
    const fbRes = await fetch(url, { method: 'POST' });
    const data = await fbRes.json();
    if (!fbRes.ok) {
      console.error('[SUBSCRIBE] Error:', data.error?.message);
      return res.status(fbRes.status).json({ error: data.error?.message || 'Subscribe failed' });
    }
    const saved = await validateAndSavePageToken(pageId, pageAccessToken);
    if (!saved) {
      console.warn('[SUBSCRIBE] Page token validation failed, token not persisted');
    }
    console.log(`[SUBSCRIBE] Page ${pageId} subscribed to webhook`);
    res.json({ success: true, data });
  } catch (e) {
    console.error('[SUBSCRIBE] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── AUTH: Validate Page Token (legacy) ──
app.get('/api/auth/validate', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const cacheKey = `page_info_${token.substring(0, 20)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = `${FB_API}/me`
      + `?fields=id,name,picture{url}`
      + `&access_token=${token}`;

    const fbRes = await fetch(url);
    const data = await fbRes.json();

    if (!fbRes.ok) {
      console.error('[AUTH] Validate error:', data.error?.message);
      return res.status(fbRes.status).json(data);
    }

    cacheSet(cacheKey, data, TTL.PAGE_INFO);
    res.json(data);
  } catch (e) {
    console.error('[AUTH] Network error:', e.message);
    res.status(500).json({ error: 'Network error' });
  }
});

// In-flight deduplication — tránh gọi Facebook nhiều lần cùng lúc cho cùng 1 key
const inflight = new Map();

async function fetchConversationsFromFacebook(token, pageId, limit = 20, after = null) {
  try {
    let url = `${FB_API}/${pageId}/conversations`
      + `?platform=messenger`
      + `&fields=id,participants{id,name,picture.type(large)},unread_count,updated_time,snippet`
      + `&limit=${limit}`
      + `&access_token=${token}`;
    if (after) url += `&after=${encodeURIComponent(after)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function transformAndSaveConversations(fbData, pageId) {
  const convs = (fbData.data || []).map(conv => {
    const participant = conv.participants?.data?.find(p => p.id !== pageId);
    const pictureUrl = participant?.picture?.data?.url || null;
    const transformed = {
      id: conv.id,
      page_id: pageId,
      participant_id: participant?.id || '',
      participant_name: participant?.name || 'Unknown',
      participant_picture_url: pictureUrl,
      last_message: conv.snippet || '',
      last_message_time: new Date(conv.updated_time || 0).getTime(),
      unread_count: conv.unread_count || 0,
      updated_at: Date.now(),
      raw_data: JSON.stringify(conv),
    };
    dbModule.upsertConversation(transformed);
    return transformed;
  });
  return convs;
}

function hasConversationsChanged(oldList, newList) {
  if (oldList.length !== newList.length) return true;
  const oldMap = new Map(oldList.map(c => [c.id, c.updated_time]));
  for (const conv of newList) {
    if (oldMap.get(conv.id) !== conv.updated_time) return true;
  }
  return false;
}

async function syncConversationsBackground(token, pageId) {
  if (!token) return;
  const fbData = await fetchConversationsFromFacebook(token, pageId, 50);
  if (!fbData) return;

  const transformed = transformAndSaveConversations(fbData, pageId);
  const mapped = transformed.map(mapDbConvToFbShape);

  const existing = cache.get(`convs:${pageId}`);
  const hasChanged = !existing || hasConversationsChanged(existing, mapped);

  cache.set(`convs:${pageId}`, mapped, 30);

  if (hasChanged) {
    broadcastToPage(pageId, 'conversations_synced', { pageId });
  }
}

// ── CONVERSATIONS: Layer 1 memory → Layer 2 SQLite → Layer 3 Facebook ──
const CONV_PAGE_SIZE = 20;

app.get('/api/conversations', async (req, res) => {
  const { token, pageId, limit, after } = req.query;
  if (!token || !pageId) {
    return res.status(400).json({ error: 'Missing token or pageId' });
  }
  const pageSize = Math.min(parseInt(limit, 10) || CONV_PAGE_SIZE, 50);
  const afterCursor = after && String(after).trim() ? String(after) : null;

  const memKey = `convs:${pageId}`;
  const isLoadMore = !!afterCursor;

  // Layer 1: Memory (chỉ dùng cho lần load đầu, không có after)
  if (!isLoadMore) {
    const mem = cache.get(memKey);
    if (mem) {
      const lastItem = mem.length > 0 ? mem[mem.length - 1] : null;
      const nextCursor = lastItem?.updated_time ? String(new Date(lastItem.updated_time).getTime()) : null;
      res.setHeader('X-Cache', 'HIT');
      return res.json({ data: mem, source: 'memory', afterCursor: nextCursor, hasMore: mem.length >= pageSize });
    }
  }

  // Layer 2: SQLite (chỉ dùng after khi là timestamp từ DB; cursor FB bỏ qua layer này)
  const afterTs = afterCursor && /^\d+$/.test(afterCursor) ? parseInt(afterCursor, 10) : null;
  const useDbForPaginate = !afterCursor || afterTs !== null;
  const dbConvs = useDbForPaginate ? dbModule.getConversationsPaginated(pageId, pageSize, afterTs) : [];
  if (dbConvs.length > 0) {
    const mapped = dbConvs.map((row) => {
      let participantName = row.participant_name;
      if (participantName === 'Unknown' || !participantName) {
        const fromParticipant = dbModule.getLatestParticipantMessage(row.id);
        if (fromParticipant?.sender_name) {
          participantName = fromParticipant.sender_name;
        } else {
          const latest = dbModule.getLatestMessage(row.id);
          if (latest && latest.is_from_page === 0 && latest.sender_name) {
            participantName = latest.sender_name;
          }
        }
      }
      return mapDbConvToFbShape({ ...row, participant_name: participantName });
    });
    const lastTs = mapped.length > 0 ? (mapped[mapped.length - 1].updated_time ? new Date(mapped[mapped.length - 1].updated_time).getTime() : null) : null;
    const nextCursor = lastTs ? String(lastTs) : null;
    if (!isLoadMore) {
      cache.set(memKey, mapped, 30);
      syncConversationsBackground(token, pageId).catch(console.error);
    }
    res.setHeader('X-Cache', 'DB');
    return res.json({ data: mapped, source: 'sqlite', afterCursor: nextCursor, hasMore: dbConvs.length >= pageSize });
  }

  // Layer 3: Facebook API
  const fbData = await fetchConversationsFromFacebook(token, pageId, pageSize, afterCursor || undefined);
  if (!fbData) return res.status(500).json({ error: 'Facebook API error' });

  const rawConvs = fbData.data || [];
  const transformed = transformAndSaveConversations({ ...fbData, data: rawConvs }, pageId);
  const mapped = transformed.map(mapDbConvToFbShape);
  const fbNextCursor = fbData.paging?.cursors?.after || null;
  if (!isLoadMore) {
    cache.set(memKey, mapped, 30);
  }
  res.setHeader('X-Cache', 'MISS');
  res.json({ data: mapped, source: 'facebook', afterCursor: fbNextCursor, hasMore: !!fbNextCursor });
});

// ── CONVERSATIONS MERGED: 20 tổng cộng cho tất cả pages (không phải 20/page) ──
const MERGED_PAGE_SIZE = 20;

/** Lấy từ Facebook tất cả pages, merge và sort theo updated_time mới nhất (giống pancake.vn) */
async function fetchMergedFromFacebook(tokenByPage, pageSize) {
  const pageIdList = Array.from(tokenByPage.keys());
  const results = await Promise.allSettled(
    pageIdList.map((pageId) => fetchConversationsFromFacebook(tokenByPage.get(pageId), pageId, 50))
  );
  const allConvs = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value?.data) {
      const pageId = pageIdList[i];
      transformAndSaveConversations(result.value, pageId);
      (result.value.data || []).forEach((c) => {
        const participant = c.participants?.data?.find((p) => p.id !== pageId);
        const ts = new Date(c.updated_time || 0).getTime();
        allConvs.push({
          id: c.id,
          page_id: pageId,
          participant_id: participant?.id || '',
          participant_name: participant?.name || 'Unknown',
          participant_picture_url: participant?.picture?.data?.url || null,
          snippet: c.snippet || '',
          updated_time: c.updated_time || '',
          unread_count: c.unread_count || 0,
          _ts: ts,
        });
      });
    }
  });
  const byKey = new Map();
  allConvs.forEach((c) => {
    const key = `${c.page_id}:${c.participant_id}`;
    const existing = byKey.get(key);
    if (!existing || c._ts > existing._ts) byKey.set(key, c);
  });
  return Array.from(byKey.values())
    .sort((a, b) => b._ts - a._ts)
    .slice(0, pageSize);
}

app.get('/api/conversations/merged', async (req, res) => {
  const { pageIds, tokens, limit, after } = req.query;
  if (!pageIds || !tokens) {
    return res.status(400).json({ error: 'Missing pageIds or tokens' });
  }
  const pageIdList = pageIds.split(',').map((s) => s.trim()).filter(Boolean);
  let tokenList;
  try {
    tokenList = JSON.parse(tokens);
  } catch {
    return res.status(400).json({ error: 'Invalid tokens JSON' });
  }
  if (!Array.isArray(tokenList) || pageIdList.length !== tokenList.length) {
    return res.status(400).json({ error: 'Invalid tokens: must match pageIds length' });
  }
  const tokenByPage = new Map(pageIdList.map((p, i) => [p, tokenList[i]]));
  const pageSize = Math.min(parseInt(limit, 10) || MERGED_PAGE_SIZE, 50);
  const afterCursor = after && String(after).trim() ? String(after) : null;
  const afterTs = afterCursor && /^\d+$/.test(afterCursor) ? parseInt(afterCursor, 10) : null;
  const isLoadMore = !!afterCursor;

  const memKey = `convs_merged:${[...pageIdList].sort().join(',')}`;

  if (!isLoadMore) {
    const mem = cache.get(memKey);
    if (mem) {
      const enriched = await enrichParticipantNames(mem, tokenByPage);
      const lastItem = enriched.length > 0 ? enriched[enriched.length - 1] : null;
      const nextCursor = lastItem?.updated_time ? String(new Date(lastItem.updated_time).getTime()) : null;
      res.setHeader('X-Cache', 'HIT');
      return res.json({ data: enriched, source: 'memory', afterCursor: nextCursor, hasMore: enriched.length >= pageSize });
    }
  }

  if (!isLoadMore) {
    const fbMerged = await fetchMergedFromFacebook(tokenByPage, pageSize);
    if (fbMerged.length > 0) {
      const mapped = fbMerged.map((c) => mapDbConvToFbShape({
        id: c.id,
        page_id: c.page_id,
        participant_id: c.participant_id,
        participant_name: c.participant_name,
        participant_picture_url: c.participant_picture_url,
        last_message: c.snippet,
        last_message_time: c._ts,
        unread_count: c.unread_count,
      }, true));
      const enriched = await enrichParticipantNames(mapped, tokenByPage);
      const lastTs = enriched.length > 0 && enriched[enriched.length - 1].updated_time
        ? new Date(enriched[enriched.length - 1].updated_time).getTime() : null;
      cache.set(memKey, enriched, 30);
      const stillKhach = enriched.filter((c) => {
        const name = c.participants?.data?.[0]?.name;
        return !name || name === 'Unknown';
      });
      stillKhach.forEach((c, i) => {
        const pageId = c.page_id;
        const token = tokenByPage.get(pageId);
        if (token && c.id) {
          setTimeout(() => syncMessagesBackground(token, pageId, c.id).catch(() => {}), 500 * (i + 1));
        }
      });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ data: enriched, source: 'facebook', afterCursor: lastTs ? String(lastTs) : null, hasMore: fbMerged.length >= pageSize });
    }
  }

  const dbConvs = dbModule.getConversationsByPagesPaginated(pageIdList, pageSize, afterTs);
  if (dbConvs.length > 0) {
    let mapped = dbConvs.map((row) => {
      let participantName = row.participant_name;
      if (participantName === 'Unknown' || !participantName) {
        const fromParticipant = dbModule.getLatestParticipantMessage(row.id);
        if (fromParticipant?.sender_name) {
          participantName = fromParticipant.sender_name;
        } else {
          const latest = dbModule.getLatestMessage(row.id);
          if (latest && latest.is_from_page === 0 && latest.sender_name) {
            participantName = latest.sender_name;
          }
        }
      }
      return mapDbConvToFbShape({ ...row, participant_name: participantName }, true);
    });
    mapped = await enrichParticipantNames(mapped, tokenByPage);
    const lastTs = mapped.length > 0 ? (mapped[mapped.length - 1].updated_time ? new Date(mapped[mapped.length - 1].updated_time).getTime() : null) : null;
    const nextCursor = lastTs ? String(lastTs) : null;
    if (!isLoadMore) {
      cache.set(memKey, mapped, 30);
      pageIdList.forEach((pageId, i) => {
        if (tokenList[i]) syncConversationsBackground(tokenList[i], pageId).catch(console.error);
      });
      const stillKhach = mapped.filter((c) => {
        const name = c.participants?.data?.[0]?.name;
        return !name || name === 'Unknown';
      });
      stillKhach.forEach((c, i) => {
        const pageId = c.page_id;
        const token = tokenByPage.get(pageId);
        if (token && c.id) {
          setTimeout(() => syncMessagesBackground(token, pageId, c.id).catch(() => {}), 500 * (i + 1));
        }
      });
    }
    res.setHeader('X-Cache', 'DB');
    return res.json({ data: mapped, source: 'sqlite', afterCursor: nextCursor, hasMore: dbConvs.length >= pageSize });
  }

  if (!isLoadMore) {
    const allFetched = await Promise.allSettled(
      pageIdList.map((pageId, i) => fetchConversationsFromFacebook(tokenList[i], pageId, 50))
    );
    allFetched.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        transformAndSaveConversations(result.value, pageIdList[i]);
      }
    });
    const retryConvs = dbModule.getConversationsByPagesPaginated(pageIdList, pageSize, null);
    if (retryConvs.length > 0) {
      let mapped = retryConvs.map((row) => {
        let participantName = row.participant_name;
        if (participantName === 'Unknown' || !participantName) {
          const fromParticipant = dbModule.getLatestParticipantMessage(row.id);
          if (fromParticipant?.sender_name) {
            participantName = fromParticipant.sender_name;
          } else {
            const latest = dbModule.getLatestMessage(row.id);
            if (latest && latest.is_from_page === 0 && latest.sender_name) {
              participantName = latest.sender_name;
            }
          }
        }
        return mapDbConvToFbShape({ ...row, participant_name: participantName }, true);
      });
      mapped = await enrichParticipantNames(mapped, tokenByPage);
      const lastTs = mapped.length > 0 ? (mapped[mapped.length - 1].updated_time ? new Date(mapped[mapped.length - 1].updated_time).getTime() : null) : null;
      cache.set(memKey, mapped, 30);
      const stillKhach = mapped.filter((c) => {
        const name = c.participants?.data?.[0]?.name;
        return !name || name === 'Unknown';
      });
      stillKhach.forEach((c, i) => {
        const pageId = c.page_id;
        const token = tokenByPage.get(pageId);
        if (token && c.id) {
          setTimeout(() => syncMessagesBackground(token, pageId, c.id).catch(() => {}), 500 * (i + 1));
        }
      });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ data: mapped, source: 'facebook', afterCursor: lastTs ? String(lastTs) : null, hasMore: retryConvs.length >= pageSize });
    }
  }

  res.json({ data: [], source: 'empty', afterCursor: null, hasMore: false });
});

// ── SEARCH: Tìm conversations từ tất cả pages ──
app.get('/api/search', async (req, res) => {
  const { query, pageIds, tokens } = req.query;
  if (!query || !pageIds || !tokens) {
    return res.status(400).json({ error: 'Missing params: query, pageIds, tokens' });
  }
  const pageIdList = pageIds.split(',');
  let tokenList;
  try {
    tokenList = JSON.parse(tokens);
  } catch {
    return res.status(400).json({ error: 'Invalid tokens JSON' });
  }
  if (!Array.isArray(tokenList) || pageIdList.length !== tokenList.length) {
    return res.status(400).json({ error: 'Invalid tokens: must be JSON array matching pageIds length' });
  }
  const q = query.toLowerCase().trim();
  if (!q) return res.json({ results: [], total: 0, query: '' });

  try {
    const results = await Promise.allSettled(
      pageIdList.map(async (pageId, i) => {
        const token = tokenList[i];
        const url = `${FB_API}/${pageId}/conversations`
          + `?platform=messenger`
          + `&fields=id,participants{id,name},unread_count,updated_time,snippet`
          + `&limit=100`
          + `&access_token=${token}`;
        const fbRes = await fetch(url);
        if (!fbRes.ok) return [];
        const data = await fbRes.json();
        const matched = (data.data || []).filter((conv) => {
          const participantName = conv.participants?.data?.find((p) => p.id !== pageId)?.name || '';
          const snippet = conv.snippet || '';
          return participantName.toLowerCase().includes(q) || snippet.toLowerCase().includes(q);
        });
        return matched.map((conv) => ({ ...conv, pageId }));
      })
    );

    const allResults = [];
    results.forEach((r) => {
      if (r.status === 'fulfilled') allResults.push(...r.value);
    });
    allResults.sort((a, b) => new Date(b.updated_time).getTime() - new Date(a.updated_time).getTime());

    res.json({ results: allResults, total: allResults.length, query });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Lấy tên user từ Facebook khi API conversations trả Unknown ──
async function fetchUserNameFromFacebook(token, userId) {
  if (!userId || !token) return null;
  const cacheKey = `user_name:${userId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  try {
    const url = `${FB_API}/${userId}?fields=name&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const name = data.name || null;
    if (name) cache.set(cacheKey, name, 3600);
    return name;
  } catch { return null; }
}

/** Enrich participant names từ Facebook User API khi Unknown. */
async function enrichParticipantNames(mapped, tokenByPage) {
  const enriched = await Promise.all(mapped.map(async (c) => {
    const pageId = c.page_id;
    const participant = c.participants?.data?.[0];
    const currentName = participant?.name;
    if (currentName && currentName !== 'Unknown') return c;
    const participantId = participant?.id;
    if (!participantId || !pageId) return c;
    const token = tokenByPage.get(pageId);
    if (!token) return c;
    const name = await fetchUserNameFromFacebook(token, participantId);
    if (!name) return c;
    return {
      ...c,
      participants: {
        ...c.participants,
        data: c.participants?.data?.map((p, i) => i === 0 ? { ...p, name } : p) ?? [{ ...participant, name }],
      },
    };
  }));
  return enriched;
}

app.get('/api/user/:userId/name', async (req, res) => {
  const { userId } = req.params;
  const { token } = req.query;
  if (!token || !userId) return res.status(400).json({ error: 'Missing token or userId' });
  const name = await fetchUserNameFromFacebook(token, userId);
  if (name) return res.json({ name });
  res.status(404).json({ error: 'Name not found' });
});

// ── MAP: senderId → convId (dùng sau khi nhận webhook) ──
app.get('/api/participant/:senderId/conversation', (req, res) => {
  const { senderId } = req.params;
  const cached = cacheGet(`participant_conv_${senderId}`);
  if (cached) return res.json(cached);
  // Không có trong cache → cần fetch conversations trước
  res.status(404).json({ error: 'Not found in cache' });
});

/** Resolve thread_xxx (webhook) to real Facebook conversation ID for Messages API. Never returns null. */
async function resolveConversationIdForApi(token, convId) {
  if (!convId || !convId.startsWith('thread_')) return convId;

  const conv = dbModule.getConversationById(convId);
  if (!conv) return convId;

  const { page_id, participant_id } = conv;
  if (!participant_id) return convId;

  try {
    const url = `${FB_API}/${page_id}/conversations`
      + `?fields=id&user_id=${encodeURIComponent(participant_id)}&platform=messenger&limit=1`
      + `&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return convId;
    const data = await res.json();
    const fbId = data.data?.[0]?.id;
    if (fbId) {
      console.log(`[RESOLVE] thread_xxx -> ${fbId} for participant ${participant_id}`);
      return fbId;
    }
  } catch (e) {
    console.error('[RESOLVE]', e.message);
  }
  return convId;
}

async function fetchMessagesFromFacebook(token, conversationId, before) {
  try {
    let url = `${FB_API}/${conversationId}/messages`
      + `?fields=id,message,created_time,from{id,name},attachments{image_data,video_data,file_url,name,mime_type,type}`
      + `&limit=25`
      + `&access_token=${token}`;
    if (before) url += `&before=${before}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch { return null; }
}

function saveMessagesToDb(rawMsgs, convId, pageId) {
  const existingById = new Map();
  const existingRows = dbModule.getMessages(convId);
  existingRows.forEach(r => { existingById.set(r.id, r); });

  const msgs = (rawMsgs || []).map(msg => {
    const isFromPage = msg.from?.id === pageId ? 1 : 0;
    const existing = existingById.get(msg.id);
    return {
      id: msg.id,
      conversation_id: convId,
      page_id: pageId,
      text: msg.message || null,
      timestamp: new Date(msg.created_time || 0).getTime(),
      is_from_page: isFromPage,
      sender_name: msg.from?.name || '',
      sender_id: msg.from?.id || '',
      has_attachment: (msg.attachments?.data?.length || 0) > 0 ? 1 : 0,
      attachments: JSON.stringify(msg.attachments?.data || []),
      status: 'received',
      reply_to_id: existing?.reply_to_id ?? null,
      reply_to_text: existing?.reply_to_text ?? null,
      reply_to_is_from_page: existing?.reply_to_is_from_page ?? null,
    };
  });
  dbModule.upsertMessages(msgs);
  const participantMsg = msgs.find(m => m.is_from_page === 0 && m.sender_name);
  if (participantMsg) {
    dbModule.updateParticipantName(convId, participantMsg.sender_name);
    cache.keys().filter(k => k.startsWith('convs_merged')).forEach(k => cache.del(k));
  }
  const latest = msgs[0];
  if (latest) {
    const text = latest.text || (latest.has_attachment ? 'Tệp đính kèm' : '');
    dbModule.updateConversationLastMessage(convId, text, latest.timestamp);
  }
  return msgs.map(m => mapDbMsgToFbShape(m, pageId));
}

async function syncMessagesBackground(token, pageId, conversationId) {
  if (!token) return;
  try {
    const apiConvId = await resolveConversationIdForApi(token, conversationId) || conversationId;
    const fbData = await fetchMessagesFromFacebook(token, apiConvId);
    if (!fbData) return;

    const raw = fbData.data || [];
    const dbLatestBefore = dbModule.getLatestMessage(conversationId);
    const fbLatest = raw[0];

    saveMessagesToDb(raw, conversationId, pageId);

    const isNewMessage = fbLatest && (!dbLatestBefore || fbLatest.id !== dbLatestBefore.id);
    if (!isNewMessage) return;

    const mapped = dbModule.getMessages(conversationId).map(m => mapDbMsgToFbShape(m, pageId));
    const parsed = mapped.map(m => ({
      ...m,
      from: {
        id: m.is_from_page ? pageId : (m.from?.id ?? m.sender_id ?? ''),
        name: m.from?.name ?? m.sender_name ?? '',
      },
    }));
    cache.set(`msgs:${conversationId}`, parsed, 60);
    broadcastToPage(pageId, 'messages_updated', { convId: conversationId });
  } catch (e) {
    console.error('[SYNC BG]', e.message);
  }
}

// ── MESSAGES: DB first, then cache, then Facebook ──
app.get('/api/messages/:conversationId', async (req, res) => {
  const { conversationId } = req.params;
  const { token, pageId, before, fresh } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const memKey = `msgs:${conversationId}`;
  const addConvId = (payload) => ({ ...payload, convId: conversationId });
  const pageIdParam = pageId || '';
  const normalizeMessage = (m) => {
    const isFromPage = (m.is_from_page !== undefined && m.is_from_page !== null && Number(m.is_from_page) === 1) ||
      (m.from?.id === pageIdParam);
    return {
      ...m,
      from: {
        id: isFromPage ? pageIdParam : (m.from?.id ?? m.sender_id ?? ''),
        name: m.from?.name ?? m.sender_name ?? '',
      },
      is_from_page: isFromPage ? 1 : 0,
    };
  };

  function addPaging(payload, msgs, fbPaging) {
    const beforeCursor = fbPaging?.cursors?.before ?? (() => {
      if (msgs.length === 0) return null;
      const ts = (m) => new Date(m.created_time || 0).getTime();
      const oldest = msgs.reduce((a, b) => (ts(a) < ts(b) ? a : b));
      return String(ts(oldest));
    })();
    return { ...payload, paging: beforeCursor ? { cursors: { before: beforeCursor } } : undefined };
  }

  // ── LAYER 1: Memory (hot) ──
  if (!fresh && !before) {
    const mem = cache.get(memKey);
    if (mem) {
      const normalized = mem.map(normalizeMessage);
      res.setHeader('X-Cache', 'HIT');
      return res.json(addConvId(addPaging({ data: normalized, source: 'memory' }, normalized, null)));
    }
  }

  // ── LAYER 2: SQLite (warm) ──
  if (!fresh) {
    const beforeNum = before && /^\d+$/.test(String(before)) ? Number(before) : null;
    let dbMsgs = beforeNum != null
      ? dbModule.getMessagesBefore(conversationId, beforeNum)
      : dbModule.getMessages(conversationId);
    if (beforeNum != null && dbMsgs.length > 0) dbMsgs = dbMsgs.reverse();
    if (dbMsgs.length > 0) {
      const conv = dbModule.getConversationById(conversationId);
      const needNameFromFb = conversationId.startsWith('thread_') && token && pageIdParam
        && conv && (!conv.participant_name || conv.participant_name === 'Unknown');
      if (needNameFromFb && !beforeNum) {
        const apiConvId = await resolveConversationIdForApi(token, conversationId);
        if (apiConvId) {
          const fbData = await fetchMessagesFromFacebook(token, apiConvId);
          if (fbData?.data?.length) {
            const raw = fbData.data || [];
            const msgs = saveMessagesToDb(raw, conversationId, pageIdParam);
            const normalized = msgs.map(normalizeMessage);
            cache.set(memKey, normalized, 60);
            res.setHeader('X-Cache', 'DB+FB');
            return res.json(addConvId(addPaging({ data: normalized, source: 'facebook' }, normalized, fbData.paging)));
          }
        }
      }
      const parsed = dbMsgs.map(m => mapDbMsgToFbShape(m, pageIdParam)).map(normalizeMessage);
      if (!beforeNum) {
        cache.set(memKey, parsed, 60);
        if (token && pageId) syncMessagesBackground(token, pageId, conversationId).catch(console.error);
      }
      res.setHeader('X-Cache', 'DB');
      return res.json(addConvId(addPaging({ data: parsed, source: 'sqlite' }, parsed, null)));
    }
  }

  // ── LAYER 3: Facebook API ──
  if (!token) return res.status(400).json({ error: 'Missing token' });
  try {
    const apiConvId = await resolveConversationIdForApi(token, conversationId) || conversationId;
    const fbData = await fetchMessagesFromFacebook(token, apiConvId, before);
    if (!fbData) {
      const dbMsgs = dbModule.getMessages(conversationId);
      if (dbMsgs.length > 0) {
        const parsed = dbMsgs.map(m => mapDbMsgToFbShape(m, pageIdParam)).map(normalizeMessage);
        return res.json(addConvId(addPaging({ data: parsed, source: 'sqlite_fallback' }, parsed, null)));
      }
      return res.status(500).json({ error: 'Cannot fetch messages' });
    }
    const raw = fbData.data || [];
    const msgs = saveMessagesToDb(raw, conversationId, pageIdParam);
    const normalized = msgs.map(normalizeMessage);
    if (!before) cache.set(memKey, normalized, 60);
    res.setHeader('X-Cache', 'MISS');
    return res.json(addConvId(addPaging({ data: normalized, source: 'facebook' }, normalized, fbData.paging)));
  } catch (e) {
    const dbMsgs = dbModule.getMessages(conversationId);
    if (dbMsgs.length > 0) {
      const parsed = dbMsgs.map(m => mapDbMsgToFbShape(m, pageIdParam)).map(normalizeMessage);
      return res.json(addConvId({ data: parsed, source: 'sqlite_fallback' }));
    }
    res.status(500).json({ error: e.message });
  }
});

// Debug: xem 5 tin đầu trong SQLite (tạm thời)
app.get('/debug/messages/:convId', (req, res) => {
  const msgs = dbModule.getMessages(req.params.convId);
  res.json(
    msgs.slice(0, 5).map(m => ({
      id: m.id?.substring(0, 15),
      sender_id: m.sender_id,
      is_from_page: m.is_from_page,
      text: m.text?.substring(0, 20),
    }))
  );
});

// ── SEND MESSAGE (auto-split for FB 2000 char limit) ──
function splitMessage(text, maxLen = 1900) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitAt = maxLen;

    const lastNewline = remaining.lastIndexOf('\n', maxLen);
    if (lastNewline > maxLen * 0.6) {
      splitAt = lastNewline + 1;
    } else {
      const lastSentence = Math.max(
        remaining.lastIndexOf('. ', maxLen),
        remaining.lastIndexOf('! ', maxLen),
        remaining.lastIndexOf('? ', maxLen),
        remaining.lastIndexOf('.\n', maxLen),
      );
      if (lastSentence > maxLen * 0.6) {
        splitAt = lastSentence + 1;
      } else {
        const lastSpace = remaining.lastIndexOf(' ', maxLen);
        if (lastSpace > maxLen * 0.5) splitAt = lastSpace + 1;
      }
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function sendTextChunks(token, recipientId, text) {
  const chunks = splitMessage(text);
  const results = [];

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 300));

    const fbRes = await fetch(`${FB_API}/me/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: chunks[i] },
        access_token: token,
      }),
    });

    const data = await fbRes.json();
    if (!fbRes.ok) throw { status: fbRes.status, data, chunkIndex: i };
    results.push(data);
  }

  return results;
}

app.post('/api/messages/send', async (req, res) => {
  const { token, recipientId, text, pageId, replyToId } = req.body;

  if (!token || !recipientId || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const chunks = splitMessage(text);
    if (chunks.length > 1) console.log(`[SEND] Splitting ${text.length} chars into ${chunks.length} chunks`);
    const results = await sendTextChunks(token, recipientId, text);
    const now = Date.now();

    if (pageId) {
      const dbConvs = dbModule.getConversations(pageId);
      let conv = dbConvs.find(c => c.participant_id === recipientId);

      if (!conv) conv = dbModule.getConversationById(`thread_${pageId}_${recipientId}`);
      if (!conv) {
        try {
          const resolved = await resolveConversationIdForApi(token, `thread_${pageId}_${recipientId}`);
          if (resolved && !resolved.startsWith('thread_')) {
            conv = dbModule.getConversationById(resolved);
          }
        } catch {}
      }

      if (conv) {
        const replyToMsg = replyToId ? dbModule.getMessageById(replyToId) : null;
        const replyToText = replyToMsg?.text ? replyToMsg.text.slice(0, 100) : null;
        const replyToIsFromPage = replyToMsg ? (replyToMsg.is_from_page === 1 ? 1 : 0) : null;

        results.forEach((result, i) => {
          dbModule.upsertMessage({
            id: result.message_id ?? result.mid ?? `mid_${now}_${i}`,
            conversation_id: conv.id,
            page_id: pageId,
            text: chunks[i],
            timestamp: now + i * 300,
            is_from_page: 1,
            sender_name: '',
            sender_id: pageId,
            has_attachment: 0,
            attachments: '[]',
            status: 'sent',
            reply_to_id: i === 0 ? (replyToId || null) : null,
            reply_to_text: i === 0 ? replyToText : null,
            reply_to_is_from_page: i === 0 ? replyToIsFromPage : null,
          });
        });

        dbModule.upsertConversation({
          ...conv,
          last_message: chunks.at(-1),
          last_message_time: now,
          updated_at: now,
        });

        cache.del(`msgs:${conv.id}`);
      }

      cache.del(`convs:${pageId}`);
      cacheDelPrefix('convs_merged:');

      results.forEach((result, i) => {
        broadcastToPage(pageId, 'message_echo', {
          type: 'message_echo',
          pageId,
          senderId: pageId,
          recipientId,
          convId: conv?.id || `thread_${pageId}_${recipientId}`,
          messageId: result.message_id ?? result.mid ?? `mid_${now}_${i}`,
          text: chunks[i],
          timestamp: Math.floor((now + i * 300) / 1000),
          attachments: [],
          source: 'api_send',
        });
      });
    }

    return res.json(results[0]);
  } catch (e) {
    if (e.chunkIndex !== undefined) {
      console.error(`[SEND] Failed at chunk ${e.chunkIndex}:`, e.data);
      return res.status(e.status).json(e.data);
    }
    console.error('[SEND] Error:', e.message);
    res.status(500).json({ error: 'Network error' });
  }
});

// ── SEND IMAGE ──
app.post('/api/messages/send-image',
  upload.single('image'),
  async (req, res) => {
    const { token, recipientId } = req.body;
    if (!token || !recipientId || !req.file) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const formData = new FormData();
      formData.append('recipient', JSON.stringify({ id: recipientId }));
      formData.append('message', JSON.stringify({
        attachment: {
          type: 'image',
          payload: { is_reusable: true }
        }
      }));
      formData.append('access_token', token);
      formData.append('filedata', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      const fbRes = await fetch(`${FB_API}/me/messages`, {
        method: 'POST',
        body: formData,
      });

      const data = await fbRes.json();

      if (fbRes.ok) {
        cacheDelPrefix('msgs:');
      }

      res.status(fbRes.status).json(data);
    } catch (e) {
      console.error('[SEND IMAGE] Error:', e.message);
      res.status(500).json({ error: 'Network error' });
    }
  }
);

// ── ATTACHMENTS: Lấy URL attachment từ messageId ──
app.get('/api/attachments/:messageId', async (req, res) => {
  const { messageId } = req.params;
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const cacheKey = `attachment_${messageId}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    const url = `${FB_API}/${messageId}/attachments`
      + `?fields=id,type,image_data,video_data,file_url,name,mime_type`
      + `&access_token=${token}`;

    const fbRes = await fetch(url);
    const data = await fbRes.json();

    if (!fbRes.ok) return res.status(fbRes.status).json(data);

    // Attachment không bao giờ thay đổi → cache lâu nhất
    cacheSet(cacheKey, data, TTL.ATTACHMENT);

    res.setHeader('X-Cache', 'MISS');
    res.json(data);
  } catch (e) {
    console.error('[ATTACHMENT] Error:', e.message);
    res.status(500).json({ error: 'Network error' });
  }
});

// ── AVATAR PROXY: Lấy ảnh PSID qua server (tránh App Review chặn profile_pic) ──
// Stream binary từ Facebook, cache 7 ngày, token giấu ở server
const PLACEHOLDER_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#e0e0e0"/><circle cx="50" cy="38" r="18" fill="#9e9e9e"/><ellipse cx="50" cy="95" rx="35" ry="25" fill="#9e9e9e"/></svg>',
  'utf8'
);

async function fetchOneAvatar(psid, accessToken) {
  const cacheKey = `avatar_${psid}`;
  const cached = cache.get(cacheKey);
  if (cached) return { psid, dataUrl: `data:${cached.contentType};base64,${cached.buffer.toString('base64')}` };
  try {
    const fbUrl = `https://graph.facebook.com/${encodeURIComponent(psid)}/picture?type=large&access_token=${encodeURIComponent(accessToken)}`;
    const imgRes = await fetch(fbUrl);
    if (!imgRes.ok) return { psid, dataUrl: null };
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    cache.set(cacheKey, { buffer, contentType }, 7 * 24 * 60 * 60);
    return { psid, dataUrl: `data:${contentType};base64,${buffer.toString('base64')}` };
  } catch (e) {
    return { psid, dataUrl: null };
  }
}

// Batch: 1 request lấy nhiều avatar, tránh gọi N lần bị limit
app.post('/api/avatars', async (req, res) => {
  const { psids, token } = req.body || {};
  if (!Array.isArray(psids) || psids.length === 0 || !token) {
    return res.status(400).json({ error: 'Missing psids (array) or token' });
  }
  const unique = [...new Set(psids)].filter(Boolean).slice(0, 50);
  if (unique.length === 0) return res.json({});

  const accessToken = token || process.env.PAGE_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!accessToken) return res.status(400).json({ error: 'Missing token' });

  const BATCH_SIZE = 5;
  const result = {};
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((psid) => fetchOneAvatar(psid, accessToken)));
    settled.forEach((s) => {
      if (s.status === 'fulfilled' && s.value?.dataUrl) {
        result[s.value.psid] = s.value.dataUrl;
      }
    });
  }
  res.json(result);
});

app.get('/api/avatar', async (req, res) => {
  const { psid, token } = req.query;
  if (!psid || typeof psid !== 'string') return res.status(400).send('Missing psid');

  const accessToken = token || process.env.PAGE_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!accessToken) return res.status(400).send('Missing token or PAGE_ACCESS_TOKEN in env');

  const cacheKey = `avatar_${psid}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 ngày
    return res.send(cached.buffer);
  }

  try {
    const fbUrl = `https://graph.facebook.com/${encodeURIComponent(psid)}/picture?type=large&access_token=${encodeURIComponent(accessToken)}`;
    const imgRes = await fetch(fbUrl);
    if (!imgRes.ok) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(PLACEHOLDER_SVG);
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    cacheSet(cacheKey, { buffer, contentType }, 7 * 24 * 60 * 60); // 7 ngày

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 ngày
    res.send(buffer);
  } catch (e) {
    console.error('[AVATAR] Error:', e.message);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(PLACEHOLDER_SVG);
  }
});

// ── IMAGE PROXY: Serve ảnh Facebook tránh CORS ──
app.get('/api/image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');

  const cacheKey = `image_${url}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cached.buffer);
  }

  try {
    const imgRes = await fetch(decodeURIComponent(url));
    if (!imgRes.ok) return res.status(imgRes.status).send('Image not found');

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    cacheSet(cacheKey, { buffer, contentType }, TTL.IMAGE);

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (e) {
    console.error('[IMAGE] Error:', e.message);
    res.status(500).send('Image fetch failed');
  }
});

// ============================================================
// POLLING — Fallback khi SSE mất kết nối
// ============================================================

const pollState = new Map(); // pageId → { convId: updatedTime }

app.get('/api/poll/:pageId', async (req, res) => {
  const { pageId } = req.params;
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    const url = `${FB_API}/${pageId}/conversations`
      + `?fields=id,updated_time&limit=30`
      + `&access_token=${token}`;

    const fbRes = await fetch(url);
    if (!fbRes.ok) return res.status(fbRes.status).json(await fbRes.json());
    const data = await fbRes.json();

    const prev = pollState.get(pageId) || {};
    const changes = [];

    data.data?.forEach(conv => {
      if (!prev[conv.id] || prev[conv.id] !== conv.updated_time) {
        changes.push({
          convId: conv.id,
          updatedTime: conv.updated_time,
          isNew: !prev[conv.id],
        });
        prev[conv.id] = conv.updated_time;
      }
    });

    pollState.set(pageId, prev);

    if (changes.length > 0) {
      cacheDel(`convs:${pageId}`);
      changes.forEach((c) => cache.del(`msgs:${c.convId}`));
      broadcastToPage(pageId, 'conversations_changed', { pageId, changes });
    }

    res.json({ changes, hasChanges: changes.length > 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/socket/stats', (req, res) => {
  const rooms = {};
  io.sockets.adapter.rooms.forEach((sockets, room) => {
    if (room.startsWith('page:')) rooms[room] = sockets.size;
  });
  res.json({
    totalClients: connectedClients.size,
    rooms,
    clients: Array.from(connectedClients.entries()).map(([id, data]) => ({
      socketId: id,
      pageIds: data.pageIds,
    })),
  });
});

// Legacy poll — compatibility (same logic, old response format)
app.get('/api/conversations/poll', async (req, res) => {
  const { token, pageId } = req.query;
  if (!token || !pageId) return res.status(400).json({ error: 'Missing params' });
  try {
    const url = `${FB_API}/${pageId}/conversations?fields=id,updated_time&limit=30&access_token=${token}`;
    const fbRes = await fetch(url);
    if (!fbRes.ok) return res.status(fbRes.status).json(await fbRes.json());
    const data = await fbRes.json();

    const prev = pollState.get(pageId) || {};
    const changes = [];
    data.data?.forEach(conv => {
      if (!prev[conv.id] || prev[conv.id] !== conv.updated_time) {
        changes.push(conv.id);
        prev[conv.id] = conv.updated_time;
      }
    });
    pollState.set(pageId, prev);

    if (changes.length > 0) {
      cacheDel(`convs:${pageId}`);
      broadcastToPage(pageId, 'conversations_changed', { pageId, changes: changes.map((c) => ({ convId: c })) });
    }
    res.json({ changes, total: data.data?.length || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── MANUAL CACHE INVALIDATION ──
app.delete('/api/cache/conversations/:pageId', (req, res) => {
  cacheDel(`convs:${req.params.pageId}`);
  res.json({ ok: true });
});

app.delete('/api/cache/messages/:conversationId', (req, res) => {
  cache.del(`msgs:${req.params.conversationId}`);
  res.json({ ok: true });
});

// ============================================================
// SETTINGS API
// ============================================================

app.get('/api/settings/:pageId', (req, res) => {
  const { pageId } = req.params;
  const settings = readJSON(getSettingsPath(pageId), {
    pageId, sendMode: 'single', autoReply: false, signature: '', createdAt: Date.now(),
  });
  res.json(settings);
});

app.put('/api/settings/:pageId', (req, res) => {
  const { pageId } = req.params;
  const current = readJSON(getSettingsPath(pageId), {});
  const updated = { ...current, ...req.body, pageId, updatedAt: Date.now() };
  writeJSON(getSettingsPath(pageId), updated);
  cacheDel(`settings_${pageId}`);
  res.json(updated);
});

// ============================================================
// QUICK REPLIES API
// ============================================================

app.get('/api/quick-replies/:pageId', (req, res) => {
  const { pageId } = req.params;
  const cacheKey = `qr_${pageId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);
  const data = readJSON(getQuickRepliesPath(pageId), { replies: [] });
  cacheSet(cacheKey, data, 300);
  res.json(data);
});

app.post('/api/quick-replies/:pageId', (req, res) => {
  try {
    const { pageId } = req.params;
    const reply = req.body;
    if (!reply || typeof reply !== 'object') return res.status(400).json({ error: 'Invalid body' });
    if (!reply.shortcut) return res.status(400).json({ error: 'Missing shortcut' });

    const data = readJSON(getQuickRepliesPath(pageId), { replies: [] });
    const idx = data.replies.findIndex(r => r.id === reply.id);
    if (idx >= 0) {
      data.replies[idx] = { ...data.replies[idx], ...reply, updatedAt: Date.now() };
    } else {
      data.replies.unshift({
        ...reply,
        id: reply.id || `qr_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        createdAt: Date.now(),
      });
    }
    writeJSON(getQuickRepliesPath(pageId), data);
    cacheDel(`qr_${pageId}`);
    res.json(data);
  } catch (e) {
    console.error('[quick-replies POST]', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

app.delete('/api/quick-replies/:pageId/:replyId', (req, res) => {
  const { pageId, replyId } = req.params;
  const data = readJSON(getQuickRepliesPath(pageId), { replies: [] });
  data.replies = data.replies.filter(r => r.id !== replyId);
  writeJSON(getQuickRepliesPath(pageId), data);
  cacheDel(`qr_${pageId}`);
  res.json({ ok: true });
});

// Export quick replies (JSON for copy/paste between pages)
app.get('/api/quick-replies/:pageId/export', (req, res) => {
  const data = readJSON(getQuickRepliesPath(req.params.pageId), { replies: [] });
  res.json({
    source_page_id: req.params.pageId,
    exported_at: Date.now(),
    replies: data.replies,
  });
});

// Import quick replies (merge or replace)
app.post('/api/quick-replies/:pageId/import', (req, res) => {
  const { pageId } = req.params;
  const { replies, mode } = req.body;

  if (!Array.isArray(replies)) {
    return res.status(400).json({ error: 'replies must be array' });
  }

  const current = readJSON(getQuickRepliesPath(pageId), { replies: [] });

  let result;
  if (mode === 'replace') {
    result = replies.map((r) => ({
      ...r,
      id: `qr_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
    }));
  } else {
    const existingShortcuts = new Set(current.replies.map((r) => r.shortcut));
    const incoming = replies
      .filter((r) => !existingShortcuts.has(r.shortcut))
      .map((r) => ({
        ...r,
        id: `qr_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        createdAt: Date.now(),
      }));
    result = [...current.replies, ...incoming];
  }

  writeJSON(getQuickRepliesPath(pageId), { replies: result });
  cacheDel(`qr_${pageId}`);
  res.json({
    ok: true,
    total: result.length,
    imported: mode === 'replace' ? result.length : result.length - current.replies.length,
  });
});

// ============================================================
// IMAGE LIBRARY — upload/list/delete per page
// ============================================================

app.post('/api/library/:pageId/upload',
  (req, res, next) => { if (!req.params.pageId) return res.status(400).json({ error: 'Missing pageId' }); next(); },
  diskUpload.array('images', 20),
  (err, req, res, _next) => {
    if (err) { console.error('[UPLOAD ERROR]', err.message); return res.status(400).json({ error: err.message }); }
  },
  (req, res) => {
    const { pageId } = req.params;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Không có file nào được upload' });
    }
    const uploaded = req.files.map(file => ({
      id: `img_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      filename: file.filename,
      originalName: file.originalname,
      url: `http://localhost:3001/uploads/${pageId}/${file.filename}`,
      size: file.size,
      mimetype: file.mimetype,
      createdAt: Date.now(),
      pageId,
    }));
    const meta = readJSON(getLibraryMetaPath(pageId), []);
    meta.unshift(...uploaded);
    writeJSON(getLibraryMetaPath(pageId), meta);
    cacheDelPrefix(`library_${pageId}`);
    console.log(`[UPLOAD] ${uploaded.length} files for page ${pageId}`);
    res.json({ uploaded, total: meta.length });
  }
);

app.get('/api/library/:pageId', (req, res) => {
  const { pageId } = req.params;
  const { search = '', limit = 50, offset = 0 } = req.query;
  const cacheKey = `library_${pageId}_${search}_${offset}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  let meta = readJSON(getLibraryMetaPath(pageId), []);
  // Filter only files that exist on disk
  meta = meta.filter(img => fs.existsSync(path.join(getPageDir(pageId), img.filename)));

  if (search) {
    const q = String(search).toLowerCase();
    meta = meta.filter(img => img.originalName.toLowerCase().includes(q));
  }

  const total = meta.length;
  const items = meta.slice(Number(offset), Number(offset) + Number(limit));
  const result = { items, total };
  cacheSet(cacheKey, result, 30);
  res.json(result);
});

app.delete('/api/library/:pageId/:imageId', (req, res) => {
  const { pageId, imageId } = req.params;
  try {
    let meta = readJSON(getLibraryMetaPath(pageId), []);
    const img = meta.find(i => i.id === imageId);
    if (img) {
      const fp = path.join(getPageDir(pageId), img.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      meta = meta.filter(i => i.id !== imageId);
      writeJSON(getLibraryMetaPath(pageId), meta);
    }
    cacheDelPrefix(`library_${pageId}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/library/:pageId', (req, res) => {
  const { pageId } = req.params;
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be array' });
  try {
    let meta = readJSON(getLibraryMetaPath(pageId), []);
    ids.forEach(imageId => {
      const img = meta.find(i => i.id === imageId);
      if (img) {
        const fp = path.join(getPageDir(pageId), img.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
    });
    meta = meta.filter(i => !ids.includes(i.id));
    writeJSON(getLibraryMetaPath(pageId), meta);
    cacheDelPrefix(`library_${pageId}`);
    res.json({ ok: true, deleted: ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/library/:pageId/stats', (req, res) => {
  const { pageId } = req.params;
  const meta = readJSON(getLibraryMetaPath(pageId), []);
  const totalSize = meta.reduce((sum, img) => sum + (img.size || 0), 0);
  res.json({ count: meta.length, totalSize, totalSizeMB: (totalSize / 1024 / 1024).toFixed(2) });
});

// ── SEND IMAGE VIA URL — luôn dùng binary upload (localhost không gửi được URL lên Facebook) ──
async function sendImageBinary(token, recipientId, imageUrl) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Cannot fetch image: ${imgRes.status}`);

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.split('/')[1] || 'jpg';

  const formData = new FormData();
  formData.append('recipient', JSON.stringify({ id: recipientId }));
  formData.append('message', JSON.stringify({
    attachment: {
      type: 'image',
      payload: { is_reusable: true },
    },
  }));
  formData.append('access_token', token);
  formData.append('filedata', buffer, {
    filename: `image.${ext}`,
    contentType,
  });

  return fetch(`${FB_API}/me/messages`, {
    method: 'POST',
    body: formData,
  });
}

app.post('/api/messages/send-image-url', async (req, res) => {
  const { token, recipientId, imageUrl } = req.body;

  console.log('[SERVER SEND IMAGE URL]', {
    recipientId,
    imageUrl: imageUrl?.substring?.(0, 80),
    hasToken: !!token,
  });

  if (!token || !recipientId || !imageUrl) {
    return res.status(400).json({ error: 'Missing: token, recipientId, or imageUrl' });
  }

  try {
    const fbRes = await sendImageBinary(token, recipientId, imageUrl);
    const data = await fbRes.json();
    console.log('[SERVER] Send image result:', fbRes.status, JSON.stringify(data));
    res.status(fbRes.status).json(data);
  } catch (e) {
    console.error('[SEND IMAGE URL]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// START SERVER
// ============================================================

loadPageTokens();

async function enrichAllUnknownParticipants() {
  const tokens = readJSON(getPageTokensPath(), {});
  const pageIds = Object.keys(tokens);
  if (pageIds.length === 0) return;

  for (const pageId of pageIds) {
    const token = tokens[pageId]?.accessToken;
    if (!token) continue;

    const convs = dbModule.getConversations(pageId);
    const unknowns = convs.filter(c =>
      !c.participant_name || c.participant_name === 'Unknown'
    );

    if (unknowns.length === 0) continue;
    console.log(`[ENRICH] Page ${pageId}: ${unknowns.length} unknown participants`);

    for (let i = 0; i < unknowns.length; i++) {
      const conv = unknowns[i];
      await new Promise(r => setTimeout(r, 300 * i));
      resolveAndEnrichConversation(pageId, conv.participant_id, conv.id)
        .catch(e => console.error('[ENRICH]', e.message));
    }
  }
}

setTimeout(() => enrichAllUnknownParticipants().catch(console.error), 2000);

httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   FB Messenger Backend                 ║
║   Port: ${PORT}                           ║
║   Socket.io enabled                    ║
║                                        ║
║   GET  /webhook         FB verify      ║
║   POST /webhook         FB events      ║
║   GET  /socket/stats    Socket debug   ║
║   GET  /api/auth/validate              ║
║   GET  /api/conversations              ║
║   GET  /api/messages/:id               ║
║   POST /api/messages/send              ║
║   GET  /cache/stats     Debug cache    ║
║   GET  /db/stats        DB + cache     ║
║   DEL  /db/clear       Xóa toàn bộ DB ║
╚════════════════════════════════════════╝
  `);
});
