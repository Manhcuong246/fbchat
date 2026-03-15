import { fbFetch } from './fbApiService';
import { CacheService } from './cacheService';
import type { ConversationData } from '../types/conversation';
import type { PageInfo } from '../types/auth';

const CACHE_TTL = {
  CONVERSATION_LIST: 30,
  CONVERSATION_DETAIL: 60,
  PAGE_INFO: 3600,
} as const;

interface FbParticipant {
  id: string;
  name?: string;
  pic?: string;
  picture?: { data?: { url?: string } };
}

interface FbMessageRef {
  id: string;
}

interface FbConversation {
  id: string;
  participants?: { data?: FbParticipant[] };
  unread_count?: number;
  updated_time?: string;
  snippet?: string;
  messages?: { data?: FbMessageRef[] };
}

interface FbConversationsResponse {
  data?: FbConversation[];
  paging?: { cursors?: { after?: string } };
}

export interface GetConversationsResult {
  conversations: ConversationData[];
  afterCursor: string | null;
}

const BACKEND = 'http://localhost:3001';

// Per-page light signatures
const lightSignatures: Record<string, string> = {};

/** Fetch only id,updated_time via backend proxy. Returns needFull: true when signature changed. */
export async function getConversationsLight(
  pageToken: string,
  pageId: string
): Promise<{ needFull: boolean }> {
  // Dùng backend /api/conversations/poll — nhẹ, có cache server-side
  const url = `${BACKEND}/api/conversations/poll?token=${encodeURIComponent(pageToken)}&pageId=${pageId}`;
  const res = await fetch(url);
  if (!res.ok) return { needFull: true };
  const data = (await res.json()) as { changes: string[]; total: number };
  // changes có nghĩa là có thay đổi → cần full fetch
  const needFull = !lightSignatures[pageId] || data.changes.length > 0;
  lightSignatures[pageId] = String(Date.now());
  return { needFull };
}

export function clearConversationsLightCache(): void {
  Object.keys(lightSignatures).forEach((k) => delete lightSignatures[k]);
}

function transformConversations(
  json: FbConversationsResponse,
  page: { id: string; name?: string; avatarUrl?: string; color?: string }
): GetConversationsResult {
  const list = json.data ?? [];
  const pageIdStr = String(page.id);
  const conversations: ConversationData[] = list.map((c) => {
    const participants = c.participants?.data ?? [];
    const other = participants.find((p) => String(p.id) !== pageIdStr);
    const participant = other ?? participants[0];
    const pid = participant?.id ?? '';
    const lastMessageTime = c.updated_time ? new Date(c.updated_time).getTime() : 0;
    const unreadCount = c.unread_count ?? 0;
    const latestMessageId = c.messages?.data?.[0]?.id ?? c.updated_time ?? c.id;
    return {
      id: c.id,
      pageId: page.id,
      pageName: page.name ?? '',
      pageAvatarUrl: page.avatarUrl,
      pageColor: page.color,
      participant: {
        id: pid,
        name: participant?.name ?? 'Unknown',
      },
      lastMessage: c.snippet ?? '',
      lastMessageTime,
      unreadCount,
      isRead: unreadCount === 0,
      latestMessageId,
    };
  });
  const afterCursor = json.paging?.cursors?.after ?? null;
  return { conversations, afterCursor };
}

export async function getConversations(
  pageToken: string,
  pageId: string,
  after?: string,
  pageInfo?: { name?: string; avatarUrl?: string; color?: string }
): Promise<GetConversationsResult> {
  const cacheKey = after ? `convs_${pageId}_after_${after}` : `convs_${pageId}`;

  if (!after) {
    CacheService.loadPersisted(cacheKey);
  }

  // Gọi qua backend proxy — không gọi thẳng Facebook
  let url = `${BACKEND}/api/conversations?token=${encodeURIComponent(pageToken)}&pageId=${pageId}`;
  if (after) url += `&after=${encodeURIComponent(after)}`;

  const page = { id: pageId, ...pageInfo };
  const data = await fbFetch<FbConversationsResponse>(url, cacheKey, CACHE_TTL.CONVERSATION_LIST);

  if (!data) {
    const raw = CacheService.get<FbConversationsResponse>(cacheKey);
    if (raw) return transformConversations(raw, page);
    return { conversations: [], afterCursor: null };
  }

  const result = transformConversations(data, page);

  if (!after) {
    CacheService.persist(cacheKey);
  }
  return result;
}

/** Fetch conversations for one page via backend proxy (uses server-side cache). */
async function fetchPageConversations(page: PageInfo): Promise<ConversationData[]> {
  const res = await fetch(
    `http://localhost:3001/api/conversations` +
      `?token=${encodeURIComponent(page.accessToken)}&pageId=${page.id}`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as FbConversationsResponse;
  if (!data.data) return [];
  return transformConversations(data, page).conversations;
}

/** Fetch conversations for ALL pages in parallel, merged & sorted newest first. */
export async function getAllConversations(pages: PageInfo[]): Promise<ConversationData[]> {
  if (pages.length === 0) return [];

  const results = await Promise.allSettled(pages.map((page) => fetchPageConversations(page)));

  const all: ConversationData[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      all.push(...result.value);
    } else {
      console.error(`Failed to fetch page ${pages[i].name}:`, result.reason);
    }
  });

  all.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
  return all;
}
