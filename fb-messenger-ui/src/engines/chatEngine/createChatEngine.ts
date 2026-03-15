/**
 * createChatEngine — Message Engine kiểu Pancake
 *
 * Data Architecture: Normalized Store O(1)
 * - { [conversationId]: { messages: { [messageId]: MessageObj }, order: [id1, id2...] } }
 *
 * Smart Caching: Load từ Store/LocalStorage ngay → Update chỉ fetch latest → Merge
 * Sync: Outgoing tempId → Ack realId không nháy | Incoming Socket merge
 *
 * Tách biệt: logic dữ liệu vs logic Socket (adapter)
 */
import { createStore, produce, reconcile } from 'solid-js/store';
import { createMemo } from 'solid-js';
import type {
  ChatEngineStore,
  ConversationMessages,
  MessageWithRow,
  SendPayload,
  SendResult,
  FetchLatestOptions,
  SocketAdapter,
} from './types';
import type { MessageData } from '../../types/message';

const STORAGE_KEY = 'chat_engine_cache';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function ensureConv(store: ChatEngineStore, convId: string): ConversationMessages {
  if (!store.convs[convId]) {
    return {
      messages: {},
      order: [],
      beforeCursor: null,
      loading: false,
      loadingMore: false,
    };
  }
  return store.convs[convId];
}

/** Load từ LocalStorage — ưu tiên khi mở hội thoại */
function loadFromStorage(convId: string): ConversationMessages | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${convId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: ConversationMessages; ts: number };
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Persist vào LocalStorage */
function persistToStorage(convId: string, data: ConversationMessages): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      `${STORAGE_KEY}_${convId}`,
      JSON.stringify({ data, ts: Date.now() })
    );
  } catch {
    // ignore
  }
}

export interface CreateChatEngineOptions {
  /** Gọi API lấy tin mới nhất — merge vào Store */
  fetchLatest: (opts: FetchLatestOptions) => Promise<MessageData[]>;
  /** Gửi tin — trả về clientMsgId + serverId (nếu có) */
  sendMessage: (opts: {
    conversationId: string;
    pageId: string;
    recipientId: string;
    payload: SendPayload;
    clientMsgId: string;
  }) => Promise<SendResult>;
  /** Resolve convId từ pageId + participantId (khi Socket chưa có convId) */
  resolveConvId?: (pageId: string, participantId: string) => Promise<string | null>;
  /** Lấy pageId từ convId — dùng khi Socket báo messages_updated */
  getPageIdForConv?: (convId: string) => string | null;
}

export function createChatEngine(options: CreateChatEngineOptions) {
  const { fetchLatest, sendMessage, resolveConvId, getPageIdForConv } = options;

  const [store, setStore] = createStore<ChatEngineStore>({
    convs: {},
  });

  // ── Load Cache: Store trước, không có thì LocalStorage ──
  function loadCache(convId: string): boolean {
    const fromStorage = loadFromStorage(convId);
    if (fromStorage && Object.keys(fromStorage.messages).length > 0) {
      setStore('convs', convId, reconcile(fromStorage));
      return true;
    }
    return false;
  }

  // ── Update Cache: Chỉ fetch latest, merge vào Store (reconcile) ──
  async function updateCache(
    convId: string,
    pageId: string,
    afterMessageId?: string
  ): Promise<void> {
    if (!store.convs[convId]) {
      setStore('convs', convId, {
        messages: {},
        order: [],
        beforeCursor: null,
        loading: true,
        loadingMore: false,
      });
    } else {
      setStore('convs', convId, 'loading', true);
    }

    try {
      const latest = await fetchLatest({
        conversationId: convId,
        pageId,
        afterMessageId,
      });

      setStore(
        produce((draft) => {
          if (!draft.convs[convId]) {
            draft.convs[convId] = {
              messages: {},
              order: [],
              beforeCursor: null,
              loading: false,
              loadingMore: false,
            };
          }
          const c = draft.convs[convId];
          for (const msg of latest) {
            const id = msg.id;
            const withRow: MessageWithRow = {
              ...msg,
              rowId: (msg as MessageWithRow).rowId ?? id,
            };
            c.messages[id] = withRow;
            if (!c.order.includes(id)) c.order.push(id);
          }
          c.order.sort((a, b) => {
            const ta = c.messages[a]?.timestamp ?? 0;
            const tb = c.messages[b]?.timestamp ?? 0;
            return ta - tb;
          });
          c.loading = false;
        })
      );

      const conv = store.convs[convId];
      if (conv) persistToStorage(convId, conv);
    } catch {
      setStore('convs', convId, 'loading', false);
    }
  }

  // ── Outgoing: tempId + status sending → Ack realId ──
  function addOptimistic(
    convId: string,
    payload: SendPayload,
    meta: { pageId: string; pageName: string }
  ): string {
    const clientMsgId = `temp-${uuid()}`;
    const rowId = uuid();

    const msg: MessageWithRow = {
      id: clientMsgId,
      conversationId: convId,
      text: payload.text,
      media: payload.media,
      medias: payload.medias,
      timestamp: Date.now(),
      isFromPage: true,
      fromId: meta.pageId,
      senderName: meta.pageName,
      isRead: false,
      sendStatus: 'sending',
      rowId,
    };

    setStore(
      produce((draft) => {
        if (!draft.convs[convId]) {
          draft.convs[convId] = {
            messages: {},
            order: [],
            beforeCursor: null,
            loading: false,
            loadingMore: false,
          };
        }
        const c = draft.convs[convId];
        c.messages[clientMsgId] = msg;
        c.order.push(clientMsgId);
      })
    );

    return clientMsgId;
  }

  /** Ack: đổi tempId → realId, không nháy UI (giữ rowId) */
  function ackMessage(
    convId: string,
    clientMsgId: string,
    serverId: string
  ): void {
    const conv = store.convs[convId];
    if (!conv) return;
    const msg = conv.messages[clientMsgId];
    if (!msg) return;

    const rowId = msg.rowId ?? clientMsgId;
    const updated: MessageWithRow = {
      ...msg,
      id: serverId,
      sendStatus: 'sent',
      isRead: true,
      rowId,
    };

    setStore(
      produce((draft) => {
        const c = draft.convs[convId];
        if (!c) return;
        c.messages[serverId] = updated;
        delete c.messages[clientMsgId];
        c.order = c.order.map((id) => (id === clientMsgId ? serverId : id));
      })
    );

    const updatedConv = store.convs[convId];
    if (updatedConv) persistToStorage(convId, updatedConv);
  }

  /** Cập nhật status (sending → failed) */
  function setMessageStatus(
    convId: string,
    messageId: string,
    status: 'sending' | 'sent' | 'failed'
  ): void {
    const msg = store.convs[convId]?.messages[messageId];
    if (!msg) return;
    setStore('convs', convId, 'messages', messageId, 'sendStatus', status);
    if (status === 'sent') {
      setStore('convs', convId, 'messages', messageId, 'isRead', true);
    }
  }

  // ── Incoming Socket: ID có sẵn → update; chưa có → push ──
  function upsertIncoming(
    convId: string,
    message: MessageData,
    _pageId: string
  ): void {
    setStore(
      produce((draft) => {
        if (!draft.convs[convId]) {
          draft.convs[convId] = {
            messages: {},
            order: [],
            beforeCursor: null,
            loading: false,
            loadingMore: false,
          };
        }
        const c = draft.convs[convId];
        const id = message.id;
        const withRow: MessageWithRow = {
          ...message,
          rowId: (message as MessageWithRow).rowId ?? id,
        };
        c.messages[id] = withRow;
        if (!c.order.includes(id)) {
          c.order.push(id);
          c.order.sort((a, b) => {
            const ta = c.messages[a]?.timestamp ?? 0;
            const tb = c.messages[b]?.timestamp ?? 0;
            return ta - tb;
          });
        }
      })
    );

    const conv = store.convs[convId];
    if (conv) persistToStorage(convId, conv);
  }

  // ── Gửi tin: optimistic → API → ack ──
  async function send(
    convId: string,
    pageId: string,
    recipientId: string,
    payload: SendPayload,
    meta: { pageName: string }
  ): Promise<{ clientMsgId: string; ok: boolean }> {
    const clientMsgId = addOptimistic(convId, payload, {
      pageId,
      pageName: meta.pageName,
    });

    const result = await sendMessage({
      conversationId: convId,
      pageId,
      recipientId,
      payload,
      clientMsgId,
    });

    if (result.ok && result.serverId) {
      ackMessage(convId, clientMsgId, result.serverId);
    } else if (result.ok) {
      setMessageStatus(convId, clientMsgId, 'sent');
    } else {
      setMessageStatus(convId, clientMsgId, 'failed');
    }

    return { clientMsgId, ok: result.ok };
  }

  // ── Merge server messages (từ fetchLatest) — dùng reconcile giữ tham chiếu ──
  function mergeServerMessages(
    convId: string,
    serverMessages: MessageData[]
  ): void {
    if (serverMessages.length === 0) return;

    const conv = ensureConv(store, convId);
    const MATCH_WINDOW_MS = 15000;
    const temps = conv.order.filter((id) => id.startsWith('temp'));

    const toKeep = temps.filter((tempId) => {
      const t = conv.messages[tempId];
      if (!t?.isFromPage) return true;
      const hasMatch = serverMessages.some(
        (m) =>
          m.isFromPage &&
          (m.text ?? '') === (t.text ?? '') &&
          Math.abs((m.timestamp ?? 0) - (t.timestamp ?? 0)) < MATCH_WINDOW_MS
      );
      return !hasMatch;
    });

    const merged: Record<string, MessageWithRow> = {};
    const orderSet = new Set<string>();

    for (const m of serverMessages) {
      const withRow: MessageWithRow = { ...m, rowId: (m as MessageWithRow).rowId ?? m.id };
      merged[m.id] = withRow;
      orderSet.add(m.id);
    }
    for (const id of toKeep) {
      const m = conv.messages[id];
      if (m) {
        merged[id] = m;
        orderSet.add(id);
      }
    }

    const order = [...conv.order.filter((id) => orderSet.has(id))];
    const sorted = order
      .map((id) => ({ id, ts: merged[id]?.timestamp ?? 0 }))
      .sort((a, b) => a.ts - b.ts)
      .map((x) => x.id);

    const next = { ...conv, messages: merged, order: sorted };
    setStore('convs', convId, reconcile(next));

    const updated = store.convs[convId];
    if (updated) persistToStorage(convId, updated);
  }

  // ── Memo: danh sách message theo thứ tự (cho For) ──
  function createMessagesList(convId: string) {
    return createMemo(() => {
      const conv = store.convs[convId];
      if (!conv) return [];
      return conv.order
        .map((id) => conv.messages[id])
        .filter((m): m is MessageWithRow => m != null);
    });
  }

  // ── Kết nối Socket (adapter) ──
  function connectSocket(adapter: SocketAdapter): () => void {
    const unsubNew = adapter.onNewMessage(async (data) => {
      const convId =
        data.convId ??
        (resolveConvId && (await resolveConvId(data.pageId, data.senderId ?? '')));
      if (!convId) return;

      const msg: MessageData = {
        id: data.messageId ?? `incoming-${Date.now()}`,
        conversationId: convId,
        text: data.text ?? undefined,
        timestamp:
          data.timestamp < 1e12 ? data.timestamp * 1000 : data.timestamp,
        isFromPage: false,
        fromId: data.senderId,
        senderName: '',
        isRead: false,
      };
      upsertIncoming(convId, msg, data.pageId);
    });

    const unsubEcho = adapter.onMessageEcho(async (data) => {
      const convId =
        data.convId ??
        (resolveConvId && (await resolveConvId(data.pageId, data.recipientId ?? '')));
      if (!convId) return;

      const msg: MessageData = {
        id: data.messageId ?? `echo-${Date.now()}`,
        conversationId: convId,
        text: data.text ?? undefined,
        timestamp:
          data.timestamp < 1e12 ? data.timestamp * 1000 : data.timestamp,
        isFromPage: true,
        fromId: data.pageId,
        senderName: '',
        isRead: true,
      };
      upsertIncoming(convId, msg, data.pageId);
    });

    const unsubUpdated = adapter.onMessagesUpdated
      ? adapter.onMessagesUpdated(({ convId }) => {
          const pageId = getPageIdForConv?.(convId);
          if (pageId) updateCache(convId, pageId).catch(() => {});
        })
      : () => {};

    return () => {
      unsubNew();
      unsubEcho();
      unsubUpdated();
    };
  }

  return {
    store,
    setStore,
    loadCache,
    updateCache,
    addOptimistic,
    ackMessage,
    setMessageStatus,
    upsertIncoming,
    send,
    mergeServerMessages,
    createMessagesList,
    connectSocket,
  };
}
