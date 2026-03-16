/**
 * SyncService — 1 nguồn sự thật duy nhất.
 * Socket.io + BroadcastChannel. Tránh duplicate bằng Set fetching.
 */
import { io, type Socket } from 'socket.io-client';
import { produce } from 'solid-js/store';
import { setMsgState } from '../stores/messageStore';
import { convState, setConvState } from '../stores/conversationStore';
import { authState } from '../stores/authStore';
import { setAvatarStore } from '../stores/avatarStore';
import type { MessageData } from '../types/message';
import type { MessageMedia } from '../types/message';
import type { ConversationData } from '../types/conversation';

const SERVER = 'http://localhost:3001';
let socket: Socket | null = null;
const bc =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fb_sync_v2') : null;

const fetching = new Set<string>();

const pendingNameUpdates = new Map<string, string>();
let pendingNameTimeout: ReturnType<typeof setTimeout> | null = null;

function flushPendingNameUpdates() {
  if (pendingNameUpdates.size === 0) return;
  const updates = new Map(pendingNameUpdates);
  pendingNameUpdates.clear();
  pendingNameTimeout = null;
  setConvState(
    produce((s) => {
      updates.forEach((name, convId) => {
        const idx = s.conversations.findIndex((c) => c.id === convId);
        if (idx >= 0) s.conversations[idx].participant.name = name;
      });
    })
  );
}

function scheduleNameUpdate(convId: string, name: string) {
  pendingNameUpdates.set(convId, name);
  if (!pendingNameTimeout) {
    pendingNameTimeout = setTimeout(flushPendingNameUpdates, 400);
  }
}

// Client-side session cache (mất khi F5)
const msgCache = new Map<
  string,
  { data: MessageData[]; fetchedAt: number }
>();
const CACHE_TTL = 30 * 1000; // 30 giây

export function startSync() {
  msgCache.clear();
  subscribePagesToWebhook();
  connectSocket();
  if (bc) {
    bc.onmessage = (e: MessageEvent<{ type: string; convId?: string; pageId?: string }>) => {
      const { type, convId, pageId } = e.data;
      if (type === 'msg_sent' && convId && pageId) {
        invalidateCache(convId);
        fetchMessages(convId, pageId);
      }
    };
  }
}

export function stopSync() {
  socket?.disconnect();
  socket = null;
  bc?.close();
}

export function getSocket(): Socket | null {
  return socket;
}

/** Gọi sau khi gửi tin thành công. */
export function notifySent(convId: string, pageId: string) {
  bc?.postMessage({ type: 'msg_sent', convId, pageId });
}

/** Invalidate client cache khi có data mới (webhook / messages_updated). */
export function invalidateCache(convId: string) {
  msgCache.delete(`msgs:${convId}`);
}

/** Xóa toàn bộ cache client + gọi server flush. Dùng khi cần bắt đầu lại. */
export async function clearAllCache(): Promise<void> {
  msgCache.clear();
  fetching.clear();
  setAvatarStore({});
  try {
    await fetch('http://localhost:3001/cache/flush', { method: 'DELETE' });
  } catch {}
}

async function subscribePagesToWebhook() {
  for (const page of authState.selectedPages) {
    if (!page.id || !page.accessToken) continue;
    try {
      const res = await fetch(`${SERVER}/api/subscribe-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: page.id, pageAccessToken: page.accessToken }),
      });
      if (res.ok) console.log('[SYNC] Page subscribed:', page.name);
      else if (res.status === 400) console.warn('[SYNC] Subscribe skip:', page.name, await res.text());
    } catch {}
  }
}

function connectSocket() {
  socket = io(SERVER, { reconnection: true, reconnectionDelay: 1000 });

  socket.on('connect', () => {
    console.log('[SYNC] connected');
    socket!.emit('subscribe', {
      pageIds: authState.selectedPages.map((p) => p.id),
    });
  });

  socket.on('subscribed', ({ pageIds }: { pageIds: string[] }) => {
    console.log('[SYNC] Subscribed to pages:', pageIds);
  });

  socket.on(
    'new_message',
    async (data: {
      pageId: string;
      senderId: string;
      convId: string | null;
      text: string | null;
      timestamp: number;
    }) => {
      console.log('[SYNC] new_message', data);
      invalidateCache(data.convId ?? '');
      const convId = await resolveConvId(data.pageId, data.senderId, data.convId);
      if (!convId) return;
      const tsMs = data.timestamp < 1e12 ? data.timestamp * 1000 : data.timestamp;
      updatePreview(convId, data.text, tsMs, false, data.pageId, data.senderId);
      await fetchMessages(convId, data.pageId);
    }
  );

  socket.on(
    'message_echo',
    async (data: {
      pageId: string;
      recipientId: string;
      convId: string | null;
      text: string | null;
      timestamp: number;
    }) => {
      console.log('[SYNC] echo', data);
      const convId = data.convId ?? (await resolveConvId(data.pageId, data.recipientId, null));
      if (convId) {
        invalidateCache(convId);
        const tsMs = data.timestamp < 1e12 ? data.timestamp * 1000 : data.timestamp;
        updatePreview(convId, data.text, tsMs, true, data.pageId, data.recipientId);
        await fetchMessages(convId, data.pageId);
        // Không gọi fetchConversations — tránh refetch toàn bộ list → mất tên, nháy Khách
      }
    }
  );

  socket.on('message_read', (data: { pageId: string; senderId: string; watermark: number }) => {
    markRead(data.pageId, data.senderId, data.watermark);
  });

  socket.on('messages_updated', async ({ convId }: { convId: string }) => {
    invalidateCache(convId);
    const conv = convState.conversations.find((c) => c.id === convId);
    if (conv && convState.selectedId === convId) {
      await fetchMessagesFromServer(convId, conv.pageId, true);
    }
  });

  socket.on('conversations_synced', async () => {
    await fetchConversations();
  });
}

async function resolveConvId(
  pageId: string,
  participantId: string,
  knownConvId: string | null
): Promise<string | null> {
  if (knownConvId) return knownConvId;
  const conv = convState.conversations.find(
    (c) => c.pageId === pageId && c.participant.id === participantId
  );
  if (conv) return conv.id;
  await fetchConversations();
  const conv2 = convState.conversations.find(
    (c) => c.pageId === pageId && c.participant.id === participantId
  );
  return conv2?.id ?? null;
}

function transformMsg(
  m: Record<string, unknown>,
  pageIdStr: string,
  convId: string
): MessageData {
  const createdTime = m.created_time;
  const ts =
    typeof createdTime === 'string'
      ? new Date(createdTime).getTime()
      : typeof m.timestamp === 'number'
        ? m.timestamp
        : 0;
  const from = (m.from as { id?: string; name?: string }) ?? {};
  let isFromPage: boolean;
  if (m.is_from_page !== undefined && m.is_from_page !== null) {
    isFromPage = Number(m.is_from_page) === 1;
  } else if (from.id != null && from.id !== '') {
    isFromPage = from.id === pageIdStr;
  } else {
    isFromPage = false;
  }
  const attachments = (m.attachments as { data?: unknown[] })?.data ?? [];
  const medias = parseAttachments(attachments);
  return {
    id: String(m.id),
    conversationId: convId,
    text: (m.message as string) || (m.text as string) || undefined,
    timestamp: ts,
    isFromPage,
    fromId: from.id ?? (m.sender_id as string) ?? '',
    senderName: from.name ?? (m.sender_name as string) ?? '',
    isRead: true,
    hasAttachment: attachments.length > 0 && medias.length === 0,
    medias: medias.length > 0 ? medias : undefined,
    media: medias[0],
  } as MessageData;
}

/** Nguồn sự thật: client cache (session) → server (memory / SQLite / Facebook). */
export async function fetchMessages(convId: string, pageId: string): Promise<void> {
  const key = `msgs:${convId}`;
  if (fetching.has(key)) return;

  const cached = msgCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    setMsgState(
      produce((state) => {
        const temps = (state.messages[convId] || []).filter((m) => m.id.startsWith('temp'));
        const MATCH_WINDOW_MS = 15000;
        const dedupedTemps = temps.filter((t) => {
          if (!t.isFromPage) return true;
          const hasMatch = cached.data.some(
            (m: MessageData) =>
              m.isFromPage &&
              (m.text ?? '') === (t.text ?? '') &&
              Math.abs((m.timestamp ?? 0) - (t.timestamp ?? 0)) < MATCH_WINDOW_MS
          );
          return !hasMatch;
        });
        state.messages[convId] = [...cached.data, ...dedupedTemps].sort(
          (a, b) => a.timestamp - b.timestamp
        );
      })
    );
    if (Date.now() - cached.fetchedAt > 10000) {
      fetchMessagesFromServer(convId, pageId, true).catch(() => {});
    }
    return;
  }

  fetching.add(key);
  try {
    await fetchMessagesFromServer(convId, pageId, false);
  } finally {
    fetching.delete(key);
  }
}

async function fetchMessagesFromServer(
  convId: string,
  pageId: string,
  background: boolean
): Promise<void> {
  const key = `msgs:${convId}`;
  const page = authState.selectedPages.find((p) => p.id === pageId);
  if (!page) return;

  try {
    const fresh = background ? '' : '&fresh=1';
    const res = await fetch(
      `${SERVER}/api/messages/${convId}?token=${encodeURIComponent(page.accessToken)}&pageId=${pageId}${fresh}`
    );
    if (!res.ok) return;

    const body = await res.json();
    const raw = body.data ?? [];
    const source = (body.source as string) || 'unknown';
    if (!Array.isArray(raw)) return;

    const pageIdStr = String(pageId);
    const messages: MessageData[] = raw
      .map((m: Record<string, unknown>) => transformMsg(m, pageIdStr, convId))
      .sort((a, b) => a.timestamp - b.timestamp);

    msgCache.set(key, { data: messages, fetchedAt: Date.now() });

    const beforeCursor = (body.paging as { cursors?: { before?: string } } | undefined)?.cursors?.before ?? null;

    setMsgState(
      produce((state) => {
        const temps = (state.messages[convId] || []).filter((m) => m.id.startsWith('temp'));
        const MATCH_WINDOW_MS = 15000;
        const dedupedTemps = temps.filter((t) => {
          if (!t.isFromPage) return true;
          const hasMatch = messages.some(
            (m) =>
              m.isFromPage &&
              (m.text ?? '') === (t.text ?? '') &&
              Math.abs((m.timestamp ?? 0) - (t.timestamp ?? 0)) < MATCH_WINDOW_MS
          );
          return !hasMatch;
        });
        state.messages[convId] = [...messages, ...dedupedTemps].sort(
          (a, b) => a.timestamp - b.timestamp
        );
        state.beforeCursors = { ...state.beforeCursors, [convId]: beforeCursor };
      })
    );

    // Cập nhật participant name từ tin nhắn khi API trả Unknown/Khách
    const fromParticipant = messages.filter((m) => !m.isFromPage);
    const senderName = fromParticipant.length > 0
      ? fromParticipant[fromParticipant.length - 1].senderName
      : '';
    if (senderName) {
      const conv = convState.conversations.find((c) => c.id === convId);
      if (conv && (!conv.participant.name || conv.participant.name === 'Khách')) {
        scheduleNameUpdate(convId, senderName);
      }
    }

    // Scroll handled by ChatWindow createEffect - tránh nhảy lưng chừng

    console.log(`[CACHE] fetchMessages ${convId}: ${messages.length} msgs (${source})`);
  } catch (e) {
    console.error('[CACHE] fetchMessages error:', e);
  }
}

const CONV_PAGE_SIZE = 20;

function mapConvFromApi(c: Record<string, unknown>, pageId: string, page: { name?: string; avatarUrl?: string; color?: string; accessToken?: string }): ConversationData {
  const participants = (c.participants as { data?: Array<{ id: string; name?: string }> })
    ?.data ?? [];
  const participant =
    participants.find((p: { id: string }) => p.id !== pageId) ??
    participants[0] ?? { id: (c.participant_id as string) ?? '', name: (c.participant_name as string) ?? 'Unknown' };
  const avatarUrlRaw = (participant as { picture?: string | { data?: { url?: string } } }).picture;
  const avatarUrlFromApi = typeof avatarUrlRaw === 'string' ? avatarUrlRaw : (avatarUrlRaw as { data?: { url?: string } })?.data?.url;
  const participantId = participant.id ?? (c.participant_id as string) ?? '';
  const avatarUrl = avatarUrlFromApi ?? undefined;
  const updatedTime = c.updated_time as string | undefined;
  const lastMsgTime = c.last_message_time as number | undefined;
  const lastMessageTime = updatedTime
    ? new Date(updatedTime).getTime()
    : lastMsgTime ?? 0;
  return {
    id: String(c.id),
    pageId,
    pageName: page.name ?? '',
    pageAvatarUrl: page.avatarUrl,
    pageColor: page.color,
    participant: {
      id: participant.id ?? '',
      name: (participant.name && participant.name !== 'Unknown') ? participant.name : 'Khách',
      avatarUrl: avatarUrl ?? undefined,
    },
    lastMessage: (c.snippet as string) ?? (c.last_message as string) ?? '',
    lastMessageTime,
    unreadCount: (c.unread_count as number) ?? 0,
    isRead: ((c.unread_count as number) ?? 0) === 0,
    latestMessageId: (updatedTime as string) ?? String(lastMessageTime),
  };
}

const MERGED_KEY = 'merged';

/** Lấy tên thật từ Facebook User API khi participant hiển thị Khách. */
async function fetchParticipantNameIfKhach(convId: string, pageId: string, participantId: string): Promise<void> {
  if (!participantId) return;
  const conv = convState.conversations.find((c) => c.id === convId);
  if (!conv || (conv.participant.name && conv.participant.name !== 'Khách')) return;

  const page = authState.selectedPages.find((p) => p.id === pageId);
  if (!page?.accessToken) return;

  try {
    const res = await fetch(
      `${SERVER}/api/user/${encodeURIComponent(participantId)}/name?token=${encodeURIComponent(page.accessToken)}`
    );
    if (!res.ok) return;
    const body = await res.json();
    const name = body.name as string;
    if (!name) return;
    scheduleNameUpdate(convId, name);
  } catch {}
}

/** Gọi 1 lần lấy tất cả avatar, tránh N request bị limit. */
async function fetchAvatarsBatch(psids: string[], token: string): Promise<void> {
  if (psids.length === 0 || !token) return;
  try {
    const res = await fetch(`${SERVER}/api/avatars`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psids, token }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, string>;
    setAvatarStore(data);
  } catch {}
}

/** Fetch 20 hội thoại tổng cộng (chung tất cả pages), không phải 20/page. */
export async function fetchConversations(): Promise<void> {
  const pages = authState.selectedPages;
  if (pages.length === 0) return;

  const key = 'convs_merged';
  if (fetching.has(key)) return;
  fetching.add(key);

  try {
    const pageIds = pages.map((p) => p.id).join(',');
    const tokens = JSON.stringify(pages.map((p) => p.accessToken));
    const res = await fetch(
      `${SERVER}/api/conversations/merged?pageIds=${encodeURIComponent(pageIds)}&tokens=${encodeURIComponent(tokens)}&limit=${CONV_PAGE_SIZE}`
    );
    if (!res.ok) return;

    const body = await res.json();
    const raw = body.data ?? body;
    if (!Array.isArray(raw)) return;

    const pageById = new Map(pages.map((p) => [p.id, p]));
    const convs: ConversationData[] = raw.map((c: Record<string, unknown>) => {
      const pageId = (c.page_id as string) ?? (c.participants as { data?: Array<{ id: string }> })?.data?.[0]?.id ?? '';
      const page = pageById.get(pageId) ?? pages[0];
      return mapConvFromApi(c, pageId, page);
    });

    const afterCursor = (body.afterCursor as string | null) ?? null;
    const hasMore = (body.hasMore as boolean) ?? false;

    setConvState(
      produce((state) => {
        const existingById = new Map(state.conversations.map((c) => [c.id, c]));
        const mergedIds = new Set(convs.map((c) => c.id));
        const merged = convs.map((c) => {
          const existing = existingById.get(c.id);
          const keepName = existing?.participant?.name && existing.participant.name !== 'Khách';
          const name = keepName && (!c.participant.name || c.participant.name === 'Khách')
            ? existing!.participant.name
            : c.participant.name;
          return { ...c, participant: { ...c.participant, name } };
        });
        const now = Date.now();
        const RECENT_MS = 45000;
        const preserved = state.conversations.filter(
          (c) =>
            !mergedIds.has(c.id) &&
            (c.id === state.selectedId || c.lastMessageTime > now - RECENT_MS)
        );
        state.conversations = [...merged, ...preserved].sort(
          (a, b) => b.lastMessageTime - a.lastMessageTime
        );
        state.afterCursors = { ...state.afterCursors, [MERGED_KEY]: afterCursor };
        state.hasMore = { ...state.hasMore, [MERGED_KEY]: hasMore };
      })
    );

    const khachConvs = convs.filter((c) => !c.participant.name || c.participant.name === 'Khách');
    khachConvs.forEach((c, i) => {
      setTimeout(() => fetchMessages(c.id, c.pageId), 200 * (i + 1));
    });
    khachConvs.forEach((c, i) => {
      setTimeout(() => fetchParticipantNameIfKhach(c.id, c.pageId, c.participant.id), 350 * (i + 1));
    });
    if (khachConvs.length > 0) {
      setTimeout(() => fetchConversations().catch(() => {}), 8000);
    }

    const psids = [...new Set(convs.map((c) => c.participant.id).filter(Boolean))];
    if (psids.length > 0 && pages[0]?.accessToken) {
      fetchAvatarsBatch(psids, pages[0].accessToken).catch(() => {});
    }
    console.log(`[SYNC] fetchConversations merged: ${convs.length} convs (chung ${pages.length} page), Khách: ${khachConvs.length}`);
  } catch (e) {
    console.error('[SYNC] fetchConversations error:', e);
  } finally {
    fetching.delete(key);
  }
}

/** Load thêm 20 hội thoại khi cuộn xuống hết (20 tổng, không phải mỗi page). */
export async function fetchMoreConversations(): Promise<void> {
  const after = convState.afterCursors[MERGED_KEY];
  if (!after || !convState.hasMore[MERGED_KEY] || convState.loadingMore) return;

  const pages = authState.selectedPages;
  if (pages.length === 0) return;

  const key = 'convs_merged_more';
  if (fetching.has(key)) return;
  fetching.add(key);
  setConvState('loadingMore', true);

  try {
    const pageIds = pages.map((p) => p.id).join(',');
    const tokens = JSON.stringify(pages.map((p) => p.accessToken));
    const res = await fetch(
      `${SERVER}/api/conversations/merged?pageIds=${encodeURIComponent(pageIds)}&tokens=${encodeURIComponent(tokens)}&limit=${CONV_PAGE_SIZE}&after=${encodeURIComponent(after)}`
    );
    if (!res.ok) return;

    const body = await res.json();
    const raw = body.data ?? body;
    if (!Array.isArray(raw)) return;

    const pageById = new Map(pages.map((p) => [p.id, p]));
    const convs: ConversationData[] = raw.map((c: Record<string, unknown>) => {
      const pageId = (c.page_id as string) ?? '';
      const page = pageById.get(pageId) ?? pages[0];
      return mapConvFromApi(c, pageId, page);
    });

    const nextCursor = (body.afterCursor as string | null) ?? null;
    const hasMore = (body.hasMore as boolean) ?? false;

    setConvState(
      produce((state) => {
        const existingById = new Map(state.conversations.map((c) => [c.id, c]));
        const merged = convs.map((c) => {
          const existing = existingById.get(c.id);
          const keepName = existing?.participant?.name && existing.participant.name !== 'Khách';
          const name = keepName && (!c.participant.name || c.participant.name === 'Khách')
            ? existing!.participant.name
            : c.participant.name;
          return { ...c, participant: { ...c.participant, name } };
        });
        state.conversations = [...state.conversations, ...merged].sort(
          (a, b) => b.lastMessageTime - a.lastMessageTime
        );
        state.afterCursors = { ...state.afterCursors, [MERGED_KEY]: nextCursor };
        state.hasMore = { ...state.hasMore, [MERGED_KEY]: hasMore };
      })
    );

    const morePsids = [...new Set(convs.map((c) => c.participant.id).filter(Boolean))];
    if (morePsids.length > 0 && pages[0]?.accessToken) {
      fetchAvatarsBatch(morePsids, pages[0].accessToken).catch(() => {});
    }
    const moreKhach = convs.filter((c) => !c.participant.name || c.participant.name === 'Khách');
    moreKhach.forEach((c, i) => {
      setTimeout(() => fetchParticipantNameIfKhach(c.id, c.pageId, c.participant.id), 400 * (i + 1));
    });
    console.log(`[SYNC] fetchMoreConversations merged: +${convs.length}`);
  } catch (e) {
    console.error('[SYNC] fetchMoreConversations error:', e);
  } finally {
    fetching.delete(key);
    setConvState('loadingMore', false);
  }
}

function updatePreview(
  convId: string,
  text: string | null,
  timestamp: number,
  isFromPage: boolean,
  pageId?: string,
  participantId?: string
) {
  setConvState(
    produce((state) => {
      const idx = state.conversations.findIndex((c) => c.id === convId);
      if (idx >= 0) {
        state.conversations[idx].lastMessage = text || 'Tệp đính kèm';
        state.conversations[idx].lastMessageTime = timestamp;
        if (!isFromPage && convState.selectedId !== convId) {
          state.conversations[idx].unreadCount =
            (state.conversations[idx].unreadCount || 0) + 1;
        }
      } else if (pageId && participantId) {
        const page = authState.selectedPages.find((p) => p.id === pageId);
        const stub: ConversationData = {
          id: convId,
          pageId,
          pageName: page?.name ?? '',
          pageAvatarUrl: page?.avatarUrl,
          pageColor: page?.color,
          participant: { id: participantId, name: 'Khách' },
          lastMessage: text || 'Tệp đính kèm',
          lastMessageTime: timestamp,
          unreadCount: isFromPage ? 0 : 1,
          isRead: isFromPage,
          latestMessageId: String(timestamp),
        };
        state.conversations = [stub, ...state.conversations];
      }
      state.conversations.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
    })
  );
}

function markRead(pageId: string, senderId: string, watermark: number) {
  const conv = convState.conversations.find(
    (c) => c.pageId === pageId && c.participant.id === senderId
  );
  if (!conv) return;
  const watermarkMs = watermark * 1000;
  setMsgState(
    produce((state) => {
      const list = state.messages[conv.id] ?? [];
      state.messages[conv.id] = list.map((m) =>
        m.isFromPage && m.timestamp <= watermarkMs ? { ...m, isRead: true } : m
      );
    })
  );
}

function parseAttachments(data: unknown[]): MessageMedia[] {
  return data
    .map((a: unknown) => {
      const att = a as Record<string, unknown>;
      const img = att.image_data as { url?: string } | undefined;
      const vid = att.video_data as { url?: string } | undefined;
      const payload = att.payload as { url?: string } | undefined;
      const url =
        img?.url ??
        vid?.url ??
        (att.file_url as string) ??
        payload?.url ??
        null;
      const type = att.type === 'sticker' ? 'sticker' : img || att.type === 'image' ? 'image' : vid || att.type === 'video' ? 'video' : 'file';
      if (!url && !att.id) return null;
      return {
        type: type as MessageMedia['type'],
        url,
        attachmentId: (att.id as string) ?? undefined,
        filename: (att.name as string) ?? undefined,
      } as MessageMedia;
    })
    .filter((m): m is MessageMedia => m != null);
}
