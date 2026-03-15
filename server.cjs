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
app.use(express.json());

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
function mapDbConvToFbShape(row) {
  return {
    id: row.id,
    participants: {
      data: [{
        id: row.participant_id,
        name: row.participant_name,
        picture: row.participant_picture_url || undefined,
      }],
    },
    snippet: row.last_message || '',
    updated_time: row.last_message_time ? new Date(row.last_message_time).toISOString() : '',
    unread_count: row.unread_count || 0,
  };
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

app.get('/db/stats', (req, res) => {
  const stats = {
    conversations: dbModule.db.prepare('SELECT COUNT(*) as count FROM conversations').get(),
    messages: dbModule.db.prepare('SELECT COUNT(*) as count FROM messages').get(),
    cache: cache.getStats(),
    cacheKeys: cache.keys().length,
  };
  res.json(stats);
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
        const pageIdEntry = recipientId;
        let conv = dbModule.getConversationByParticipant(pageIdEntry, senderId);
        if (!conv) {
          const threadId = `thread_${pageIdEntry}_${senderId}`;
          dbModule.upsertConversation({
            id: threadId,
            page_id: pageIdEntry,
            participant_id: senderId,
            participant_name: 'Unknown',
            participant_picture_url: null,
            last_message: event.message.text || '',
            last_message_time: timestamp * 1000,
            unread_count: 1,
            updated_at: Date.now(),
            raw_data: null,
          });
          conv = dbModule.getConversationByParticipant(pageIdEntry, senderId);
        }
        const convId = conv ? conv.id : `thread_${pageIdEntry}_${senderId}`;

        dbModule.upsertMessage({
          id: event.message.mid,
          conversation_id: convId,
          page_id: pageIdEntry,
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

        cache.del(`convs:${pageIdEntry}`);
        cache.del(`msgs:${convId}`);

        console.log(`[WEBHOOK] new_message page=${pageIdEntry} sender=${senderId} conv=${convId}`);
        broadcastToPage(pageIdEntry, 'new_message', {
          pageId: pageIdEntry,
          senderId,
          convId,
          messageId: event.message.mid,
          text: event.message.text || null,
          timestamp,
          attachments: event.message.attachments || [],
        });
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
    res.json(result);
  } catch (e) {
    console.error('[AUTH PAGES] Network error:', e.message);
    res.status(500).json({ error: 'Network error' });
  }
});

// ── SUBSCRIBE PAGE TO WEBHOOK (bắt buộc để nhận tin nhắn) ──
app.post('/api/subscribe-page', async (req, res) => {
  const { pageId, pageAccessToken } = req.body;
  if (!pageId || !pageAccessToken) {
    return res.status(400).json({ error: 'Missing pageId or pageAccessToken' });
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

async function syncConversationsBackground(token, pageId) {
  if (!token) return;
  const fbData = await fetchConversationsFromFacebook(token, pageId, 50);
  if (!fbData) return;
  const transformed = transformAndSaveConversations(fbData, pageId);
  const mapped = transformed.map(mapDbConvToFbShape);
  cache.set(`convs:${pageId}`, mapped, 30);
  broadcastToPage(pageId, 'conversations_synced', { pageId });
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
        const latest = dbModule.getLatestMessage(row.id);
        if (latest && latest.is_from_page === 0 && latest.sender_name) {
          participantName = latest.sender_name;
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

// ── MAP: senderId → convId (dùng sau khi nhận webhook) ──
app.get('/api/participant/:senderId/conversation', (req, res) => {
  const { senderId } = req.params;
  const cached = cacheGet(`participant_conv_${senderId}`);
  if (cached) return res.json(cached);
  // Không có trong cache → cần fetch conversations trước
  res.status(404).json({ error: 'Not found in cache' });
});

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
  const msgs = (rawMsgs || []).map(msg => {
    const isFromPage = msg.from?.id === pageId ? 1 : 0;
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
    };
  });
  dbModule.upsertMessages(msgs);
  return msgs.map(m => mapDbMsgToFbShape(m, pageId));
}

async function syncMessagesBackground(token, pageId, conversationId) {
  if (!token) return;
  try {
    const fbData = await fetchMessagesFromFacebook(token, conversationId);
    if (!fbData) return;
    const raw = fbData.data || [];
    const dbLatestBefore = dbModule.getLatestMessage(conversationId);
    const fbLatest = raw[0];
    saveMessagesToDb(raw, conversationId, pageId);
    const mapped = dbModule.getMessages(conversationId).map(m => mapDbMsgToFbShape(m, pageId));
    const normalize = (m) => (m.is_from_page !== undefined ? { ...m, from: { id: m.is_from_page ? pageId : (m.from?.id ?? m.sender_id ?? ''), name: m.from?.name ?? m.sender_name ?? '' } } : m);
    const parsed = mapped.map(normalize);
    cache.set(`msgs:${conversationId}`, parsed, 60);
    if (fbLatest && dbLatestBefore && fbLatest.id !== dbLatestBefore.id) {
      console.log(`[SYNC BG] New messages for ${conversationId}`);
      broadcastToPage(pageId, 'messages_updated', { convId: conversationId });
    }
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
    const fbData = await fetchMessagesFromFacebook(token, conversationId, before);
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

// ── SEND MESSAGE ──
app.post('/api/messages/send', async (req, res) => {
  const { token, recipientId, text, pageId } = req.body;

  console.log('[SEND] pageId:', pageId);
  console.log('[SEND] recipientId:', recipientId);
  console.log('[SEND] Socket rooms page:' + pageId + ' →', io.sockets.adapter.rooms.get(`page:${pageId}`)?.size ?? 0, 'clients');

  if (!token || !recipientId || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const fbRes = await fetch(`${FB_API}/me/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        access_token: token,
      }),
    });

    const data = await fbRes.json();

    if (fbRes.ok) {
      const messageId = data.message_id ?? data.mid ?? `mid_${Date.now()}`;
      const now = Date.now();
      let conv = null;
      if (pageId) {
        const dbConvs = dbModule.getConversations(pageId);
        conv = dbConvs.find(c => c.participant_id === recipientId);
        if (conv) {
          dbModule.upsertMessage({
            id: messageId,
            conversation_id: conv.id,
            page_id: pageId,
            text,
            timestamp: now,
            is_from_page: 1,
            sender_name: '',
            sender_id: pageId,
            has_attachment: 0,
            attachments: '[]',
            status: 'sent',
          });
          dbModule.upsertConversation({
            ...conv,
            last_message: text,
            last_message_time: now,
            updated_at: now,
          });
        }
        cache.del(`convs:${pageId}`);
        if (conv) cache.del(`msgs:${conv.id}`);
      }
      cacheDelPrefix('msgs:');

      if (pageId) {
        broadcastToPage(pageId, 'message_echo', {
          type: 'message_echo',
          pageId,
          senderId: pageId,
          recipientId,
          messageId,
          text,
          timestamp: Math.floor(now / 1000),
          attachments: [],
          source: 'api_send',
        });
        console.log('[SEND] Broadcasted echo to page:', pageId);
      }

      return res.json(data);
    }

    res.status(fbRes.status).json(data);
  } catch (e) {
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
  const { pageId } = req.params;
  const reply = req.body;
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
});

app.delete('/api/quick-replies/:pageId/:replyId', (req, res) => {
  const { pageId, replyId } = req.params;
  const data = readJSON(getQuickRepliesPath(pageId), { replies: [] });
  data.replies = data.replies.filter(r => r.id !== replyId);
  writeJSON(getQuickRepliesPath(pageId), data);
  cacheDel(`qr_${pageId}`);
  res.json({ ok: true });
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
╚════════════════════════════════════════╝
  `);
});
