/**
 * SyncService — 1 nguồn sự thật duy nhất.
 * Socket.io + BroadcastChannel. Tránh duplicate bằng Set fetching.
 */
import { io, type Socket } from 'socket.io-client';
import { produce } from 'solid-js/store';
import { setMsgState } from '../stores/messageStore';
import { convState, setConvState } from '../stores/conversationStore';
import { authState } from '../stores/authStore';
import type { MessageData } from '../types/message';
import type { MessageMedia } from '../types/message';
import type { ConversationData } from '../types/conversation';

const SERVER = 'http://localhost:3001';
let socket: Socket | null = null;
const bc =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fb_sync_v2') : null;

const fetching = new Set<string>();

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

async function subscribePagesToWebhook() {
  for (const page of authState.selectedPages) {
    try {
      const res = await fetch(`${SERVER}/api/subscribe-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: page.id, pageAccessToken: page.accessToken }),
      });
      if (res.ok) console.log('[SYNC] Page subscribed:', page.name);
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
      updatePreview(convId, data.text, tsMs, false);
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
        updatePreview(convId, data.text, tsMs, true);
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

  socket.on('conversations_synced', async (data: { pageId: string }) => {
    if (data?.pageId) {
      await fetchConversations(data.pageId);
    }
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
  await fetchConversations(pageId);
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
        setConvState(
          produce((s) => {
            const idx = s.conversations.findIndex((c) => c.id === convId);
            if (idx >= 0) {
              s.conversations[idx].participant.name = senderName;
            }
          })
        );
      }
    }

    // Scroll handled by ChatWindow createEffect - tránh nhảy lưng chừng

    console.log(`[CACHE] fetchMessages ${convId}: ${messages.length} msgs (${source})`);
  } catch (e) {
    console.error('[CACHE] fetchMessages error:', e);
  }
}

const CONV_PAGE_SIZE = 20;

function mapConvFromApi(c: Record<string, unknown>, pageId: string, page: { name?: string; avatarUrl?: string; color?: string }): ConversationData {
  const participants = (c.participants as { data?: Array<{ id: string; name?: string }> })
    ?.data ?? [];
  const participant =
    participants.find((p: { id: string }) => p.id !== pageId) ??
    participants[0] ?? { id: (c.participant_id as string) ?? '', name: (c.participant_name as string) ?? 'Unknown' };
  const avatarUrl = (participant as { picture?: string }).picture ?? (participant as { avatarUrl?: string }).avatarUrl;
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

/** Fetch conversation list - 20 đầu tiên. */
export async function fetchConversations(pageId: string): Promise<void> {
  const key = `convs:${pageId}`;
  if (fetching.has(key)) return;
  fetching.add(key);

  const page = authState.selectedPages.find((p) => p.id === pageId);
  if (!page) {
    fetching.delete(key);
    return;
  }

  try {
    const res = await fetch(
      `${SERVER}/api/conversations?token=${encodeURIComponent(page.accessToken)}&pageId=${pageId}&limit=${CONV_PAGE_SIZE}`
    );
    if (!res.ok) return;

    const body = await res.json();
    const raw = body.data ?? body;
    if (!Array.isArray(raw)) return;

    const convs: ConversationData[] = raw.map((c: Record<string, unknown>) =>
      mapConvFromApi(c, pageId, page)
    );

    const afterCursor = (body.afterCursor as string | null) ?? null;
    const hasMore = (body.hasMore as boolean) ?? false;

    setConvState(
      produce((state) => {
        const existingByPage = state.conversations.filter((c) => c.pageId === pageId);
        const existingById = new Map(existingByPage.map((c) => [c.id, c]));
        const merged = convs.map((c) => {
          const existing = existingById.get(c.id);
          const keepName = existing?.participant?.name && existing.participant.name !== 'Khách';
          const name = keepName && (!c.participant.name || c.participant.name === 'Khách')
            ? existing!.participant.name
            : c.participant.name;
          return { ...c, participant: { ...c.participant, name } };
        });
        const others = state.conversations.filter((c) => c.pageId !== pageId);
        state.conversations = [...others, ...merged].sort(
          (a, b) => b.lastMessageTime - a.lastMessageTime
        );
        state.afterCursors = { ...state.afterCursors, [pageId]: afterCursor };
        state.hasMore = { ...state.hasMore, [pageId]: hasMore };
      })
    );

    // Pre-fetch messages cho các hội thoại "Khách" để lấy tên thật (API conversations thường trả Unknown)
    const khachConvs = convs.filter((c) => !c.participant.name || c.participant.name === 'Khách');
    const PRE_FETCH_LIMIT = 12;
    khachConvs.slice(0, PRE_FETCH_LIMIT).forEach((c, i) => {
      setTimeout(() => fetchMessages(c.id, pageId), 300 * (i + 1));
    });

    console.log(`[SYNC] fetchConversations done: ${pageId} → ${convs.length} convs`);
  } catch (e) {
    console.error('[SYNC] fetchConversations error:', e);
  } finally {
    fetching.delete(key);
  }
}

/** Load thêm 20 hội thoại khi cuộn xuống hết. */
export async function fetchMoreConversations(pageId: string): Promise<void> {
  const after = convState.afterCursors[pageId];
  if (!after || !convState.hasMore[pageId] || convState.loadingMore) return;

  const key = `convs_more:${pageId}`;
  if (fetching.has(key)) return;
  fetching.add(key);
  setConvState('loadingMore', true);

  const page = authState.selectedPages.find((p) => p.id === pageId);
  if (!page) {
    fetching.delete(key);
    setConvState('loadingMore', false);
    return;
  }

  try {
    const res = await fetch(
      `${SERVER}/api/conversations?token=${encodeURIComponent(page.accessToken)}&pageId=${pageId}&limit=${CONV_PAGE_SIZE}&after=${encodeURIComponent(after)}`
    );
    if (!res.ok) return;

    const body = await res.json();
    const raw = body.data ?? body;
    if (!Array.isArray(raw)) return;

    const convs: ConversationData[] = raw.map((c: Record<string, unknown>) =>
      mapConvFromApi(c, pageId, page)
    );

    const nextCursor = (body.afterCursor as string | null) ?? null;
    const hasMore = (body.hasMore as boolean) ?? false;

    setConvState(
      produce((state) => {
        const existingByPage = state.conversations.filter((c) => c.pageId === pageId);
        const existingById = new Map(existingByPage.map((c) => [c.id, c]));
        const merged = convs.map((c) => {
          const existing = existingById.get(c.id);
          const keepName = existing?.participant?.name && existing.participant.name !== 'Khách';
          const name = keepName && (!c.participant.name || c.participant.name === 'Khách')
            ? existing!.participant.name
            : c.participant.name;
          return { ...c, participant: { ...c.participant, name } };
        });
        const others = state.conversations.filter((c) => c.pageId !== pageId);
        state.conversations = [...others, ...existingByPage, ...merged].sort(
          (a, b) => b.lastMessageTime - a.lastMessageTime
        );
        state.afterCursors = { ...state.afterCursors, [pageId]: nextCursor };
        state.hasMore = { ...state.hasMore, [pageId]: hasMore };
      })
    );

    console.log(`[SYNC] fetchMoreConversations: ${pageId} +${convs.length}`);
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
  isFromPage: boolean
) {
  setConvState(
    produce((state) => {
      const idx = state.conversations.findIndex((c) => c.id === convId);
      if (idx < 0) return;
      state.conversations[idx].lastMessage = text || 'Tệp đính kèm';
      state.conversations[idx].lastMessageTime = timestamp;
      if (!isFromPage && convState.selectedId !== convId) {
        state.conversations[idx].unreadCount =
          (state.conversations[idx].unreadCount || 0) + 1;
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
      const type = img || att.type === 'image' ? 'image' : vid || att.type === 'video' ? 'video' : att.type === 'sticker' ? 'sticker' : 'file';
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
