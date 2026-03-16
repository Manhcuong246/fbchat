/**
 * Message adapter — normalize raw server/FB API shape to consistent frontend format.
 * Handles upsert, migrate, optimistic messages.
 */

export interface NormalizedAttachment {
  id?: string;
  type: 'image' | 'video' | 'file' | 'audio' | 'sticker' | 'unknown';
  url: string | null;
  name?: string;
  mimeType?: string;
}

export interface NormalizedMessage {
  id: string;
  conversationId: string;
  text: string | null;
  createdTime: number;
  isFromPage: boolean;
  senderId: string;
  senderName: string;
  attachments: NormalizedAttachment[];
  status: 'sending' | 'sent' | 'received' | 'failed';
  replyToId: string | null;
  replyToText: string | null;
  replyToIsFromPage: boolean | null;
}

type RawMessage = Record<string, unknown>;

function parseIsFromPage(raw: RawMessage, pageId: string): boolean {
  if (raw.is_from_page !== undefined && raw.is_from_page !== null) {
    return Number(raw.is_from_page) === 1;
  }
  const from = raw.from as { id?: string } | undefined;
  if (from?.id != null && from.id !== '') {
    return from.id === pageId;
  }
  return false;
}

function parseCreatedTime(raw: RawMessage): number {
  const createdTime = raw.created_time;
  if (typeof createdTime === 'number') return createdTime;
  if (typeof createdTime === 'string') return new Date(createdTime).getTime();
  const ts = raw.timestamp;
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
  return 0;
}

function parseAttachments(raw: RawMessage): NormalizedAttachment[] {
  const data = (raw.attachments as { data?: unknown[] })?.data ?? [];
  if (Array.isArray(data)) {
    return data
      .map((a: unknown) => {
        const att = a as Record<string, unknown>;
        const img = att.image_data as { url?: string } | undefined;
        const vid = att.video_data as { url?: string } | undefined;
        const fileUrl = att.file_url as string | undefined;
        const payload = att.payload as { url?: string } | undefined;
        const url = img?.url ?? vid?.url ?? fileUrl ?? payload?.url ?? null;
        let type: NormalizedAttachment['type'] = 'unknown';
        if (img || att.type === 'image') type = 'image';
        else if (vid || att.type === 'video') type = 'video';
        else if (att.type === 'audio') type = 'audio';
        else if (att.type === 'sticker') type = 'sticker';
        else if (fileUrl || att.type === 'file') type = 'file';
        return {
          id: att.id as string | undefined,
          type,
          url: url ?? null,
          name: att.name as string | undefined,
          mimeType: att.mime_type as string | undefined,
        };
      })
      .filter((a) => a.url != null || a.id != null);
  }
  return [];
}

/**
 * Normalize a single raw message from server/FB API.
 */
export function normalizeMessage(raw: RawMessage, pageId: string): NormalizedMessage {
  const from = (raw.from as { id?: string; name?: string }) ?? {};
  const isFromPage = parseIsFromPage(raw, pageId);
  const senderId = isFromPage ? pageId : (from.id ?? (raw.sender_id as string) ?? '');
  const senderName = (from.name as string) ?? (raw.sender_name as string) ?? '';
  const createdTime = parseCreatedTime(raw);
  const text = (raw.message as string) ?? (raw.text as string) ?? null;
  const attachments = parseAttachments(raw);

  let status: NormalizedMessage['status'] = 'received';
  const rawStatus = raw.status as string | undefined;
  if (rawStatus === 'sending' || rawStatus === 'sent' || rawStatus === 'failed') {
    status = rawStatus;
  } else if (raw.is_from_page === 1 || isFromPage) {
    status = 'sent';
  }

  return {
    id: String(raw.id ?? ''),
    conversationId: String(raw.conversation_id ?? raw.conversationId ?? ''),
    text,
    createdTime,
    isFromPage,
    senderId,
    senderName,
    attachments,
    status,
    replyToId: (raw as Record<string, unknown>).reply_to_id != null ? String((raw as Record<string, unknown>).reply_to_id) : null,
    replyToText: (raw as Record<string, unknown>).reply_to_text != null ? String((raw as Record<string, unknown>).reply_to_text) : null,
    replyToIsFromPage: (raw as Record<string, unknown>).reply_to_is_from_page === 1 ? true : (raw as Record<string, unknown>).reply_to_is_from_page === 0 ? false : null,
  };
}

/**
 * Normalize an array of raw messages, sorted by createdTime ascending (oldest first).
 */
export function normalizeMessages(raws: RawMessage[], pageId: string): NormalizedMessage[] {
  return raws
    .map((r) => normalizeMessage(r, pageId))
    .sort((a, b) => a.createdTime - b.createdTime);
}

export type MessagesMap = Record<string, NormalizedMessage[]>;

/**
 * Upsert a message into the messages map: add or update, dedup by id, sort by createdTime.
 */
export function upsertMessage(
  messagesMap: MessagesMap,
  convId: string,
  incoming: NormalizedMessage
): MessagesMap {
  const list = messagesMap[convId] ?? [];
  const idx = list.findIndex((m) => m.id === incoming.id);
  let next: NormalizedMessage[];
  if (idx >= 0) {
    next = [...list];
    next[idx] = incoming;
  } else {
    next = [...list, incoming];
  }
  next = next.sort((a, b) => a.createdTime - b.createdTime);
  return { ...messagesMap, [convId]: next };
}

type MessageWithIdAndTime = { id: string; conversationId?: string; createdTime?: number; timestamp?: number };

function getMessageTime(m: MessageWithIdAndTime): number {
  const nm = m as NormalizedMessage;
  if ('createdTime' in nm && typeof nm.createdTime === 'number') return nm.createdTime;
  const md = m as { timestamp?: number };
  return md.timestamp ?? 0;
}

/**
 * Migrate messages from oldConvId to newConvId. Merge with existing at newConvId, dedup, sort.
 * Works with NormalizedMessage or MessageData (has timestamp).
 */
export function migrateMessages<T extends MessageWithIdAndTime>(
  messagesMap: Record<string, T[]>,
  oldConvId: string,
  newConvId: string
): Record<string, T[]> {
  const oldList = messagesMap[oldConvId] ?? [];
  const newList = messagesMap[newConvId] ?? [];
  const byId = new Map<string, T>();
  [...newList, ...oldList].forEach((m) => {
    const existing = byId.get(m.id);
    const mTime = getMessageTime(m);
    const existingTime = existing ? getMessageTime(existing) : 0;
    if (!existing || mTime > existingTime) {
      byId.set(m.id, { ...m, conversationId: newConvId } as T);
    }
  });
  const merged = Array.from(byId.values()).sort((a, b) => getMessageTime(a) - getMessageTime(b));
  const { [oldConvId]: _, ...rest } = messagesMap;
  return { ...rest, [newConvId]: merged };
}

/**
 * Create an optimistic message for immediate display when user sends, before server confirm.
 */
export function createOptimisticMessage(
  text: string,
  pageId: string,
  convId: string,
  replyTo?: { id: string; text: string | null; isFromPage: boolean }
): NormalizedMessage {
  return {
    id: `optimistic_${Date.now()}`,
    conversationId: convId,
    text,
    createdTime: Date.now(),
    isFromPage: true,
    senderId: pageId,
    senderName: '',
    attachments: [],
    status: 'sending',
    replyToId: replyTo?.id ?? null,
    replyToText: replyTo?.text?.slice(0, 100) ?? null,
    replyToIsFromPage: replyTo != null ? replyTo.isFromPage : null,
  };
}

/** Convert NormalizedMessage to MessageData for store/display. */
export function toMessageData(n: NormalizedMessage, pageName: string): import('../types/message').MessageData {
  return {
    id: n.id,
    conversationId: n.conversationId,
    text: n.text ?? undefined,
    timestamp: n.createdTime,
    isFromPage: n.isFromPage,
    fromId: n.senderId,
    senderName: n.senderName || pageName,
    isRead: n.status === 'sent' || n.status === 'received',
    sendStatus: n.status === 'sending' || n.status === 'sent' || n.status === 'failed' ? n.status : undefined,
    replyToId: n.replyToId ?? undefined,
    replyToText: n.replyToText ?? undefined,
    replyToIsFromPage: n.replyToIsFromPage ?? undefined,
    ...(n.attachments.length > 0 && {
      media: {
        type: n.attachments[0].type as 'image' | 'video' | 'file' | 'audio' | 'sticker',
        url: n.attachments[0].url,
      },
    }),
  };
}
