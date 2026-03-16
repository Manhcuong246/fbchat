import { fbFetch } from './fbApiService';
import { CacheService } from './cacheService';
import type { MessageData, MessageMedia } from '../types/message';

const CACHE_TTL = {
  MESSAGES: 300,
  MESSAGES_RECENT: 10,
} as const;

const messageAttachmentsCache = new Map<string, MessageMedia[]>();

interface FbFrom {
  id: string;
  name?: string;
  pic?: string;
  picture?: { data?: { url?: string } };
}

interface FbAttachment {
  id?: string;
  type?: string;
  payload?: { url?: string; thumbnail_url?: string; name?: string };
  url?: string;
  file_url?: string;
  title?: string;
  image_data?: { url?: string; preview_url?: string };
  video_data?: { url?: string; preview_url?: string };
  name?: string;
  mime_type?: string;
}

interface FbMessage {
  id: string;
  message?: string;
  created_time?: string;
  from?: FbFrom;
  attachments?: { data?: FbAttachment[] };
}

interface FbMessagesResponse {
  data?: FbMessage[];
  paging?: { cursors?: { before?: string } };
}

export interface GetMessagesResult {
  messages: MessageData[];
  beforeCursor: string | null;
  fromCache?: boolean;
}

/** Transform raw API message to MessageData (dùng cho fetch fresh). */
export function transformMessageFromApi(
  msg: FbMessage,
  conversationId: string,
  pageId: string
): MessageData {
  const from = msg.from ?? { id: '', name: '' };
  const timestamp = msg.created_time ? new Date(msg.created_time).getTime() : 0;
  const rawAttachments = msg.attachments?.data ?? [];
  if (rawAttachments.length > 0) {
    console.log('[TRANSFORM] attachment raw:', JSON.stringify(rawAttachments[0]));
  }

  const medias = rawAttachments
    .map((a) => transformAttachment(a))
    .filter((a): a is MessageMedia => a != null);

  const media = medias[0] ?? undefined;
  const isFromPage = from.id === pageId;

  return {
    id: msg.id,
    conversationId,
    text: msg.message ?? undefined,
    media,
    medias: medias.length > 0 ? medias : undefined,
    timestamp,
    isFromPage,
    fromId: from.id,
    senderName: from.name ?? 'Unknown',
    isRead: false,
    hasAttachment: rawAttachments.length > 0 && medias.length === 0,
  };
}

function transformAttachment(att: FbAttachment): MessageMedia | null {
  if (!att) return null;

  const url =
    att.image_data?.url ??
    att.video_data?.url ??
    att.file_url ??
    att.payload?.url ??
    (att as { url?: string }).url ??
    null;

  const aid = att.id ? { attachmentId: att.id } : {};

  switch ((att.type ?? '').toLowerCase()) {
    case 'image':
      if (att.image_data?.url) {
        return { type: 'image', url: att.image_data.url, thumbnailUrl: att.image_data?.preview_url ?? att.payload?.thumbnail_url, ...aid };
      }
      if (att.id) return { type: 'pending', url: null, attachmentId: att.id };
      return null;
    case 'sticker':
      return url ? { type: 'sticker', url, ...aid } : att.id ? { type: 'pending', url: null, attachmentId: att.id } : null;
    case 'video':
      if (att.video_data?.url) {
        return { type: 'video', url: att.video_data.url, thumbnailUrl: att.video_data?.preview_url ?? att.payload?.thumbnail_url, ...aid };
      }
      if (att.id) return { type: 'pending', url: null, attachmentId: att.id };
      return null;
    case 'audio':
      return url ? { type: 'audio', url, ...aid } : att.id ? { type: 'pending', url: null, attachmentId: att.id } : null;
    case 'file':
      if (att.file_url || url) {
        return { type: 'file', url: url ?? att.file_url ?? null, filename: att.name ?? att.payload?.name ?? 'file', ...aid };
      }
      if (att.id) return { type: 'pending', url: null, attachmentId: att.id };
      return null;
    case 'share':
      return url ? { type: 'share', url, ...aid } : att.id ? { type: 'pending', url: null, attachmentId: att.id } : null;
    case 'fallback':
      return { type: 'fallback', url: null, title: att.title ?? '' };
    default:
      if (att.image_data?.url) return { type: 'image', url: att.image_data.url, ...aid };
      if (att.video_data?.url) return { type: 'video', url: att.video_data.url, ...aid };
      if (att.file_url) return { type: 'file', url: att.file_url, filename: att.name ?? att.payload?.name, ...aid };
      if (att.id) return { type: 'pending', url: null, attachmentId: att.id };
      if (att.type) console.log('Unknown attachment type:', att.type, att);
      return null;
  }
}

const PROXY_BASE = 'http://localhost:3001';

export async function fetchMessageAttachments(
  messageId: string,
  pageToken: string
): Promise<MessageMedia[]> {
  if (messageAttachmentsCache.has(messageId)) {
    return messageAttachmentsCache.get(messageId)!;
  }
  const url = `${PROXY_BASE}/api/attachments/${messageId}?token=${encodeURIComponent(pageToken)}`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const data = (await res.json()) as { data?: Array<Record<string, unknown>> };
  if (!data.data) return [];

  const medias = data.data
    .map((att: Record<string, unknown>): MessageMedia | null => {
      const a = att as FbAttachment;
      return transformAttachment(a);
    })
    .filter((m): m is MessageMedia => m != null);

  if (medias.length > 0) messageAttachmentsCache.set(messageId, medias);
  return medias;
}

function transformMessages(
  json: FbMessagesResponse,
  conversationId: string,
  pageId: string,
  _pageToken: string
): GetMessagesResult {
  const list = json.data ?? [];
  const messages: MessageData[] = list.map((m) => {
    const from = m.from ?? { id: '', name: '' };
    const timestamp = m.created_time ? new Date(m.created_time).getTime() : 0;
    const rawAttachments = m.attachments?.data ?? [];
    if (rawAttachments.length > 0) {
      console.log('[TRANSFORM] attachment raw:', JSON.stringify(rawAttachments[0]));
    }

    const attachments = rawAttachments
      .map((a) => transformAttachment(a))
      .filter((a): a is MessageMedia => a != null);

    const media = attachments[0] ?? undefined;
    const medias = attachments.length > 0 ? attachments : undefined;

    const isFromPage = from.id === pageId;
    return {
      id: m.id,
      conversationId,
      text: m.message ?? undefined,
      media,
      medias,
      timestamp,
      isFromPage,
      fromId: from.id,
      senderName: from.name ?? 'Unknown',
      isRead: false,
    };
  });
  messages.sort((a, b) => a.timestamp - b.timestamp);
  const beforeCursor = json.paging?.cursors?.before ?? null;
  return { messages, beforeCursor };
}

function enrichMessagesWithAttachments(
  data: FbMessagesResponse,
  conversationId: string,
  pageId: string,
  _pageToken: string
): GetMessagesResult {
  const result = transformMessages(data, conversationId, pageId, _pageToken);
  const rawById = new Map((data.data ?? []).map((m) => [m.id, m]));

  const messagesWithFlags = result.messages.map((msg) => {
    const rawMsg = rawById.get(msg.id) as FbMessage | undefined;
    const rawAttachments = rawMsg?.attachments?.data ?? [];

    if (rawAttachments.length === 0) return msg;
    if ((msg.medias?.length ?? 0) > 0) return msg;

    return {
      ...msg,
      hasAttachment: true,
      medias: [],
      media: undefined,
    };
  });

  return {
    messages: messagesWithFlags,
    beforeCursor: result.beforeCursor,
  };
}

export async function getMessages(
  conversationId: string,
  pageToken: string,
  pageId: string,
  before?: string,
  forceRefresh = false
): Promise<GetMessagesResult> {
  const cacheKey = `msgs_${conversationId}`;

  CacheService.loadPersisted(cacheKey);
  const stale = CacheService.get<GetMessagesResult>(cacheKey);

  if (stale && !forceRefresh && !before) return { ...stale, fromCache: true };

  // Gọi qua backend proxy
  let url = `${PROXY_BASE}/api/messages/${conversationId}?token=${encodeURIComponent(pageToken)}&pageId=${pageId}`;
  if (before) url += `&before=${encodeURIComponent(before)}`;

  const data = await fbFetch<FbMessagesResponse>(url, before ? `msgs_raw_${conversationId}_before_${before}` : `msgs_raw_${conversationId}`, CACHE_TTL.MESSAGES);

  if (!data) return stale ?? { messages: [], beforeCursor: null };

  const result = enrichMessagesWithAttachments(data, conversationId, pageId, pageToken);

  if (!before) {
    CacheService.set(cacheKey, result, CACHE_TTL.MESSAGES);
    CacheService.persist(cacheKey);
  }
  return { ...result, fromCache: false };
}

export async function getNewMessages(
  conversationId: string,
  pageToken: string,
  pageId: string,
  afterMessageId: string
): Promise<MessageData[]> {
  // Gọi qua backend proxy
  const url = `${PROXY_BASE}/api/messages/${conversationId}?token=${encodeURIComponent(pageToken)}&pageId=${pageId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as FbMessagesResponse;
    const out = enrichMessagesWithAttachments(data, conversationId, pageId, pageToken);
    // Lọc chỉ tin nhắn mới hơn afterMessageId
    const afterIdx = out.messages.findIndex((m) => m.id === afterMessageId);
    return afterIdx >= 0 ? out.messages.slice(afterIdx + 1) : [];
  } catch {
    return [];
  }
}

/** Gửi tin nhắn text qua backend proxy. */
export async function sendMessage(
  pageToken: string,
  recipientId: string,
  text: string,
  pageId?: string,
  replyToId?: string
): Promise<boolean> {
  try {
    const res = await fetch(`${PROXY_BASE}/api/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pageToken, recipientId, text, pageId, replyToId }),
    });
    const json = (await res.json()) as { error?: { message?: string } };
    if (!res.ok || json.error) {
      console.error('[fbMessage] sendMessage:', json.error?.message ?? json);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[fbMessage] sendMessage:', err);
    return false;
  }
}

export async function sendImageMessage(
  pageToken: string,
  recipientId: string,
  imageBase64: string,
  imageType: string,
  _caption?: string
): Promise<boolean> {
  try {
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const byteString = atob(base64Data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: imageType });
    const ext = imageType === 'image/png' ? 'png' : 'jpg';

    const formData = new FormData();
    formData.append('recipient', JSON.stringify({ id: recipientId }));
    formData.append('message', JSON.stringify({
      attachment: { type: 'image', payload: { is_reusable: true } },
    }));
    formData.append('filedata', blob, `image.${ext}`);
    formData.append('access_token', pageToken);

    const res = await fetch(`${PROXY_BASE}/api/messages/send-image`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      console.error('[fbMessage] sendImageMessage:', err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[fbMessage] sendImageMessage:', e);
    return false;
  }
}

export async function markAsRead(
  _conversationId: string,
  _pageToken: string
): Promise<void> {
  // no-op — read status tracked client-side via ReadTracker
}
