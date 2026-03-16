# PROMPT CHO AI — FIX TOÀN BỘ APP FB MESSENGER INBOX

## CONTEXT

Đây là một ứng dụng inbox Facebook Messenger clone, gồm:
- **Backend**: Node.js (`server.cjs`) — Express + Socket.io + SQLite + NodeCache + Facebook Graph API
- **Frontend**: SolidJS + TypeScript (`fb-messenger-ui/src/`)
- **Database**: SQLite qua `src/database/db.cjs`

App hoạt động bằng cách:
1. Nhận tin nhắn qua Facebook Webhook
2. Lưu vào SQLite
3. Broadcast realtime qua Socket.io
4. Frontend subscribe Socket.io và render danh sách hội thoại + tin nhắn

---

## CẤU TRÚC FILE QUAN TRỌNG

```
server.cjs                          ← Backend chính (1804 dòng)
src/database/db.cjs                 ← SQLite helpers
fb-messenger-ui/src/
  App.tsx                           ← Root component (SolidJS)
  stores/
    authStore.ts                    ← Auth state
    conversationStore.ts            ← Conversation list state
    messageStore.ts                 ← Messages state (keyed by convId)
  services/
    syncService.ts                  ← Polling/sync logic
  adapters/
    conversationAdapter.ts          ← HIỆN TẠI RỖNG — phải viết mới
    messageAdapter.ts               ← HIỆN TẠI RỖNG — phải viết mới
  components/
    layout/MainApp.tsx
    conversations/ConversationList.tsx
    messages/MessageList.tsx
```

---

## PHẦN 1 — FRONTEND: VIẾT 2 FILE ADAPTER

### 1.1 `conversationAdapter.ts`

File này hiện tại **rỗng hoàn toàn**. Viết toàn bộ từ đầu.

**Yêu cầu:**

```typescript
// Shape chuẩn sau khi normalize
export interface NormalizedConversation {
  id: string;
  pageId: string;
  participantId: string;
  participantName: string;       // không bao giờ là "Unknown" hay rỗng
  participantPicture: string | null;
  snippet: string;
  updatedTime: number;           // timestamp milliseconds
  unreadCount: number;
  isResolved: boolean;           // false nếu id bắt đầu bằng "thread_"
}
```

**Các hàm phải có:**

1. `normalizeConversation(raw, pageId?)` — nhận raw shape từ server, trả về `NormalizedConversation`
   - Server trả participant name có thể là `"Unknown"` hoặc `""` → fallback hiển thị `"Người dùng XXXX"` (4 số cuối của ID)
   - `updated_time` từ server là ISO string → convert sang ms timestamp
   - `isResolved = !id.startsWith('thread_')`

2. `normalizeConversations(raws[], pageId?)` — map array

3. `applyConvIdResolved(conversations, payload)` — nhận event `conv_id_resolved` từ socket, thay `oldConvId → newConvId` trong list **mà không fetch lại API**. Payload: `{ oldConvId, newConvId, participantName?, participantPicture? }`

4. `applyParticipantUpdated(conversations, payload)` — nhận event `participant_updated`, cập nhật name/picture trong list. Payload: `{ convId, participantName?, participantPicture? }`

5. `upsertConversation(conversations, incoming)` — thêm mới hoặc update conversation, sort lại theo `updatedTime` giảm dần

---

### 1.2 `messageAdapter.ts`

File này hiện tại **rỗng hoàn toàn**. Viết toàn bộ từ đầu.

**Yêu cầu:**

```typescript
export interface NormalizedMessage {
  id: string;
  conversationId: string;
  text: string | null;
  createdTime: number;           // timestamp ms
  isFromPage: boolean;
  senderId: string;
  senderName: string;
  attachments: NormalizedAttachment[];
  status: 'sending' | 'sent' | 'received' | 'failed';
}

export interface NormalizedAttachment {
  id?: string;
  type: 'image' | 'video' | 'file' | 'audio' | 'sticker' | 'unknown';
  url: string | null;
  name?: string;
  mimeType?: string;
}
```

**Các hàm phải có:**

1. `normalizeMessage(raw, pageId)` — normalize 1 message
   - `is_from_page` từ server có thể là `0/1` (number) hoặc `true/false` (boolean) hoặc check `from.id === pageId` → phải handle cả 3 case
   - `created_time` là ISO string → convert sang ms
   - Attachments: server trả `{ image_data: { url } }` hoặc `{ file_url }` hoặc `{ video_data: { url } }` → normalize hết về `{ type, url }`

2. `normalizeMessages(raws[], pageId)` — map + sort theo `createdTime` tăng dần (cũ nhất trên đầu)

3. `upsertMessage(messagesMap, convId, incoming)` — thêm/update message trong object map `{convId: Message[]}`, dedup theo id, sort theo createdTime

4. `migrateMessages(messagesMap, oldConvId, newConvId)` — chuyển toàn bộ messages từ key cũ → key mới (dùng khi nhận `conv_id_resolved`), merge với messages đã có ở key mới nếu có

5. `createOptimisticMessage(text, pageId, convId)` — tạo message giả để hiển thị ngay khi user gửi, trước khi server confirm. `id = "optimistic_${Date.now()}"`, `status = "sending"`

---

## PHẦN 2 — BACKEND: SỬA `server.cjs`

### 2.1 FIX BUG NGHIÊM TRỌNG: Mất hội thoại khi tin nhắn mới đến

**Nguyên nhân:**
Khi webhook nhận tin, server tạo conversation với ID giả `thread_{pageId}_{senderId}` và broadcast event `new_message`. Frontend refresh danh sách → Facebook API trả về ID thật `t_1234567`. Kết quả có 2 record trong DB cho cùng 1 người → frontend không tìm thấy `thread_xxx` → hội thoại biến mất.

**Fix:**

**Bước 1:** Thêm 2 hàm mới trước `app.post('/webhook')`:

```javascript
// Thay thế toàn bộ logic xử lý incoming message
function handleIncomingMessage(pageId, senderId, event, timestamp) {
  // Tìm conv hiện có theo participant
  let conv = dbModule.getConversationByParticipant(pageId, senderId);
  
  if (!conv) {
    // Tạo tạm với thread_xxx
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

  // Xóa cache — bao gồm cả convs_merged (quan trọng!)
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

  // Resolve ID thật và enrich tên trong background
  resolveAndEnrichConversation(pageId, senderId, convId).catch(console.error);
}
```

```javascript
// Resolve thread_xxx → real FB ID, enrich participant name
async function resolveAndEnrichConversation(pageId, participantId, currentConvId) {
  const token = cache.get(`page_token_${pageId}`);
  if (!token) return;

  try {
    const url = `${FB_API}/${pageId}/conversations`
      + `?fields=id,participants{id,name,picture.type(large)}`
      + `&user_id=${encodeURIComponent(participantId)}&platform=messenger&limit=1`
      + `&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const fbConv = data.data?.[0];
    if (!fbConv) return;

    const realId = fbConv.id;
    const participant = fbConv.participants?.data?.find(p => p.id !== pageId);
    const realName = participant?.name || null;
    const realPicture = participant?.picture?.data?.url || null;

    if (realId && realId !== currentConvId && currentConvId.startsWith('thread_')) {
      // Merge: đổi ID trong DB
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

        // Notify frontend đổi ID
        broadcastToPage(pageId, 'conv_id_resolved', {
          pageId,
          oldConvId: currentConvId,
          newConvId: realId,
          participantName: realName,
          participantPicture: realPicture,
        });
      }
    } else if (realName && realName !== 'Unknown') {
      // ID đúng rồi, chỉ update name
      dbModule.updateParticipantName(currentConvId, realName);
      if (realPicture) {
        dbModule.db.prepare(`UPDATE conversations SET participant_picture_url=? WHERE id=?`).run(realPicture, currentConvId);
      }
      cache.del(`convs:${pageId}`);
      cacheDelPrefix('convs_merged:');
      broadcastToPage(pageId, 'participant_updated', {
        pageId,
        convId: currentConvId,
        participantName: realName,
        participantPicture: realPicture,
      });
    }
  } catch (e) {
    console.error('[RESOLVE ENRICH]', e.message);
  }
}
```

**Bước 2:** Trong `app.post('/webhook')`, thay đoạn xử lý `if (event.message && !event.message.is_echo)` (hiện ~40 dòng) bằng:
```javascript
if (event.message && !event.message.is_echo) {
  handleIncomingMessage(recipientId, senderId, event, timestamp);
}
```

---

### 2.2 FIX BUG: Tên participant luôn là "Unknown"

**Nguyên nhân:** Webhook lưu `participant_name: 'Unknown'`. `enrichParticipantNames` chạy async nhưng không update DB, chỉ update in-memory. Load lại → vẫn Unknown.

**Fix:** Trong endpoint `GET /api/auth/pages`, sau khi lấy pages thành công, thêm:
```javascript
// Lưu token vào cache để webhook có thể dùng
pages.forEach(p => {
  if (p.accessToken) cacheSet(`page_token_${p.id}`, p.accessToken, 60 * 60);
});
```
(hàm `resolveAndEnrichConversation` ở trên sẽ dùng token này để lấy tên thật và update DB)

---

### 2.3 FIX BUG: Re-render không cần thiết

**Nguyên nhân:** `syncConversationsBackground` luôn emit `conversations_synced` dù data không đổi. Kèm `syncMessagesBackground` chạy setTimeout với delay 500ms × i → 10 conv = 5 giây emit liên tục.

**Fix:** Thay toàn bộ 2 hàm này:

```javascript
async function syncConversationsBackground(token, pageId) {
  if (!token) return;
  const fbData = await fetchConversationsFromFacebook(token, pageId, 50);
  if (!fbData) return;

  const transformed = transformAndSaveConversations(fbData, pageId);
  const mapped = transformed.map(mapDbConvToFbShape);

  const existing = cache.get(`convs:${pageId}`);
  const hasChanged = !existing || hasConversationsChanged(existing, mapped);

  cache.set(`convs:${pageId}`, mapped, 30);

  // Chỉ broadcast khi thực sự có thay đổi
  if (hasChanged) {
    broadcastToPage(pageId, 'conversations_synced', { pageId });
  }
}

// Helper so sánh bằng updated_time
function hasConversationsChanged(oldList, newList) {
  if (oldList.length !== newList.length) return true;
  const oldMap = new Map(oldList.map(c => [c.id, c.updated_time]));
  for (const conv of newList) {
    if (oldMap.get(conv.id) !== conv.updated_time) return true;
  }
  return false;
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

    // Chỉ broadcast khi có tin mới
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
```

---

### 2.4 FIX BUG: Không đồng bộ khi bật 2 tab

**Nguyên nhân:** Webhook chỉ xóa `convs:{pageId}` nhưng không xóa `convs_merged:*`. Tab 2 fetch `convs_merged` → cache còn hạn → nhận data cũ.

**Fix:** Ở mọi chỗ trong code có `cache.del(`convs:${pageId}`)`, thêm ngay sau:
```javascript
cacheDelPrefix('convs_merged:');
```

Danh sách các chỗ cần thêm:
1. Trong `handleIncomingMessage` (đã có trong Fix 2.1)
2. Trong xử lý `event.message.is_echo` trong webhook
3. Trong `/api/messages/send` sau khi gửi thành công
4. Trong `resolveAndEnrichConversation` (đã có trong Fix 2.1)

---

### 2.5 FIX BUG: Gửi tin nhắn không lưu vào DB

**Nguyên nhân:** Trong `/api/messages/send`:
```javascript
conv = dbConvs.find(c => c.participant_id === recipientId); // có thể miss
```
Nếu conv được tạo từ webhook (`thread_xxx`) thì `participant_id` có thể không match. `conv = null` → message không lưu → UI lệch.

**Fix:** Thay toàn bộ endpoint `POST /api/messages/send`:
```javascript
app.post('/api/messages/send', async (req, res) => {
  const { token, recipientId, text, pageId } = req.body;
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

      if (pageId) {
        // Tìm conv bằng nhiều cách — không chỉ participant_id
        const dbConvs = dbModule.getConversations(pageId);
        let conv = dbConvs.find(c => c.participant_id === recipientId);

        // Fallback 1: tìm bằng thread ID pattern
        if (!conv) {
          conv = dbModule.getConversationById(`thread_${pageId}_${recipientId}`);
        }

        // Fallback 2: resolve qua Facebook API
        if (!conv) {
          try {
            const resolved = await resolveConversationIdForApi(token, `thread_${pageId}_${recipientId}`);
            if (resolved && !resolved.startsWith('thread_')) {
              conv = dbModule.getConversationById(resolved);
            }
          } catch {}
        }

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
          cache.del(`msgs:${conv.id}`);
        }

        cache.del(`convs:${pageId}`);
        cacheDelPrefix('convs_merged:');

        broadcastToPage(pageId, 'message_echo', {
          type: 'message_echo',
          pageId,
          senderId: pageId,
          recipientId,
          convId: conv?.id || `thread_${pageId}_${recipientId}`,
          messageId,
          text,
          timestamp: Math.floor(now / 1000),
          attachments: [],
          source: 'api_send',
        });
      }

      return res.json(data);
    }

    res.status(fbRes.status).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Network error' });
  }
});
```

---

### 2.6 FIX BUG: `resolveConversationIdForApi` trả `null` gây lỗi

**Nguyên nhân:** Hàm trả `null` khi fail → caller dùng `|| conversationId` nhưng có chỗ không guard → gọi FB API với `null` → crash.

**Fix:** Thay toàn bộ hàm, không bao giờ trả `null`:
```javascript
async function resolveConversationIdForApi(token, convId) {
  if (!convId || !convId.startsWith('thread_')) return convId; // trả luôn nếu đã là real ID
  
  const conv = dbModule.getConversationById(convId);
  if (!conv) return convId; // trả convId thay vì null

  const { page_id, participant_id } = conv;
  if (!participant_id) return convId;

  try {
    const url = `${FB_API}/${page_id}/conversations`
      + `?fields=id&user_id=${encodeURIComponent(participant_id)}&platform=messenger&limit=1`
      + `&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return convId; // trả convId thay vì null
    const data = await res.json();
    const fbId = data.data?.[0]?.id;
    if (fbId) return fbId;
  } catch (e) {
    console.error('[RESOLVE]', e.message);
  }
  return convId; // luôn trả convId hợp lệ
}
```

---

## PHẦN 3 — FRONTEND: XỬ LÝ SOCKET EVENTS MỚI

Trong file quản lý socket connection (thường là `syncService.ts` hoặc nơi setup Socket.io client), thêm xử lý cho 2 event mới từ server:

### 3.1 Event `conv_id_resolved`
```typescript
socket.on('conv_id_resolved', (payload: {
  pageId: string;
  oldConvId: string;
  newConvId: string;
  participantName?: string;
  participantPicture?: string | null;
}) => {
  // 1. Cập nhật conversation list
  setConvState('conversations', prev =>
    applyConvIdResolved(prev, payload)
  );
  
  // 2. Migrate messages map
  setMsgState('messages', prev =>
    migrateMessages(prev, payload.oldConvId, payload.newConvId)
  );
  
  // 3. Nếu đang xem conv bị đổi ID → update selectedId
  if (convState.selectedId === payload.oldConvId) {
    setConvState('selectedId', payload.newConvId);
  }
  
  // 4. Xóa cursor cũ
  setMsgState('beforeCursors', prev => {
    const { [payload.oldConvId]: _, ...rest } = prev;
    return rest;
  });
});
```

### 3.2 Event `participant_updated`
```typescript
socket.on('participant_updated', (payload: {
  convId: string;
  participantName?: string;
  participantPicture?: string | null;
}) => {
  setConvState('conversations', prev =>
    applyParticipantUpdated(prev, payload)
  );
});
```

### 3.3 Optimistic send — hiển thị tin ngay khi gửi
Trong component gửi tin (thường là `MessageInput.tsx` hoặc tương tự):
```typescript
const handleSend = async (text: string) => {
  const convId = convState.selectedId!;
  const pageId = convState.selectedPageId!;
  
  // 1. Hiển thị ngay (optimistic)
  const optimistic = createOptimisticMessage(text, pageId, convId);
  setMsgState('messages', prev => upsertMessage(prev, convId, optimistic));
  
  try {
    await sendMessage({ token, recipientId, text, pageId });
    // Server sẽ broadcast message_echo → tự update optimistic → confirmed
  } catch (err) {
    // Đánh dấu thất bại
    setMsgState('messages', prev => {
      const msgs = prev[convId] ?? [];
      return {
        ...prev,
        [convId]: msgs.map(m =>
          m.id === optimistic.id ? { ...m, status: 'failed' } : m
        ),
      };
    });
  }
};
```

---

## PHẦN 4 — YÊU CẦU KỸ THUẬT CHUNG

1. **TypeScript strict** — không dùng `any`, tất cả interface phải typed đầy đủ
2. **SolidJS reactivity** — dùng `createStore` + `produce` hoặc functional update, không mutate trực tiếp
3. **Không breaking change** — các fix phải backward compatible với code hiện có
4. **Error handling** — mọi async call phải có try/catch, không để unhandled rejection
5. **Console.log** — backend giữ log có prefix `[TÊN_MODULE]` để dễ debug
6. **Dedup** — mọi upsert phải dedup theo `id`, không tạo duplicate

---

## THỨ TỰ VIẾT CODE

1. `conversationAdapter.ts` — cần trước mọi thứ
2. `messageAdapter.ts` — cần trước mọi thứ
3. Sửa `server.cjs` theo thứ tự: 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6
4. Sửa `syncService.ts` / socket handler — thêm xử lý 2 event mới
5. Sửa message send component — thêm optimistic update

---

## KIỂM TRA SAU KHI VIẾT

- [ ] Gửi tin từ Facebook test account → log có `[RESOLVE] Merged thread_xxx → t_xxx`
- [ ] Tên người gửi hiện đúng sau <3 giây (không còn "Unknown")
- [ ] Mở 2 tab → gửi tin tab 1 → tab 2 cập nhật trong vòng 5 giây
- [ ] Gửi tin từ app → tin hiện ngay (optimistic), không biến mất
- [ ] Hội thoại không biến mất sau khi có tin mới đến
- [ ] Không có console error về `null` convId
