import type { ConversationData } from '../types/conversation';
import type { PageInfo } from '../types/auth';

const BASE = 'http://localhost:3001/api';

export const SearchService = {
  async search(query: string, pages: PageInfo[]): Promise<ConversationData[]> {
    if (!query.trim() || pages.length === 0) return [];
    const pageIds = pages.map((p) => p.id).join(',');
    const tokens = JSON.stringify(pages.map((p) => p.accessToken));
    const params = new URLSearchParams({ query: query.trim(), pageIds, tokens });
    const res = await fetch(`${BASE}/search?${params}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    return (data.results ?? []).map((conv: Record<string, unknown>) => {
      const page = pages.find((p) => p.id === conv.pageId);
      const participants = (conv.participants as { data?: Array<{ id: string; name?: string }> })?.data ?? [];
      const participant = participants.find((p: { id: string }) => p.id !== conv.pageId) ?? participants[0];
      return {
        id: conv.id as string,
        pageId: conv.pageId as string,
        pageName: page?.name ?? '',
        pageAvatarUrl: page?.avatarUrl,
        pageColor: page?.color,
        participant: { id: participant?.id ?? '', name: participant?.name ?? 'Unknown' },
        lastMessage: (conv.snippet as string) ?? '',
        lastMessageTime: new Date((conv.updated_time as string) ?? 0).getTime(),
        unreadCount: (conv.unread_count as number) ?? 0,
        isRead: (conv.unread_count as number) === 0,
        latestMessageId: (conv.updated_time as string) ?? '',
      } as ConversationData;
    });
  },
};
