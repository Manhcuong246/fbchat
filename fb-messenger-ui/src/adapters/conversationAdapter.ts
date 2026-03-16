/**
 * Conversation adapter — normalize raw server/FB API shape to consistent frontend format.
 * Handles conv_id_resolved, participant_updated, upsert without refetch.
 */

export interface NormalizedConversation {
  id: string;
  pageId: string;
  participantId: string;
  participantName: string;
  participantPicture: string | null;
  snippet: string;
  updatedTime: number;
  unreadCount: number;
  isResolved: boolean;
}

type RawConversation = Record<string, unknown>;

function fallbackParticipantName(participantId: string): string {
  if (!participantId) return 'Đang tải...';
  return `FB_${participantId.slice(-6)}`;
}

function parseUpdatedTime(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return new Date(raw).getTime();
  return 0;
}

/**
 * Normalize a single raw conversation from server/FB API.
 */
export function normalizeConversation(raw: RawConversation, pageId?: string): NormalizedConversation {
  const id = String(raw.id ?? '');
  const participants = (raw.participants as { data?: Array<{ id?: string; name?: string; picture?: { data?: { url?: string } } }> })?.data ?? [];
  const participant = participants.find((p) => p.id !== pageId) ?? participants[0];
  const participantId = participant?.id ?? (raw.participant_id as string) ?? '';
  let participantName = participant?.name ?? (raw.participant_name as string) ?? '';
  if (!participantName || participantName === 'Unknown' || participantName.trim() === '') {
    participantName = fallbackParticipantName(participantId);
  }
  const pictureData = participant?.picture as { data?: { url?: string } } | undefined;
  const participantPicture = pictureData?.data?.url ?? (raw.participant_picture_url as string) ?? null;
  const snippet = (raw.snippet as string) ?? (raw.last_message as string) ?? '';
  const updatedTime = parseUpdatedTime(raw.updated_time ?? raw.last_message_time);
  const unreadCount = (raw.unread_count as number) ?? 0;
  const isResolved = !id.startsWith('thread_');

  const resolvedPageId = (pageId ?? raw.page_id) as string;

  return {
    id,
    pageId: resolvedPageId,
    participantId,
    participantName,
    participantPicture,
    snippet,
    updatedTime,
    unreadCount,
    isResolved,
  };
}

/**
 * Normalize an array of raw conversations.
 */
export function normalizeConversations(raws: RawConversation[], pageId?: string): NormalizedConversation[] {
  return raws.map((r) => normalizeConversation(r, pageId));
}

export interface ConvIdResolvedPayload {
  oldConvId: string;
  newConvId: string;
  participantName?: string;
  participantPicture?: string | null;
}

/**
 * Apply conv_id_resolved event: replace oldConvId with newConvId in list, update name/picture if provided.
 */
export function applyConvIdResolved<T extends { id: string; participant?: { name?: string; avatarUrl?: string } }>(
  conversations: T[],
  payload: ConvIdResolvedPayload
): T[] {
  const { oldConvId, newConvId, participantName, participantPicture } = payload;
  return conversations.map((c) => {
    if (c.id !== oldConvId) return c;
    const updated = { ...c, id: newConvId };
    if (participantName != null || participantPicture != null) {
      updated.participant = {
        ...(c.participant ?? {}),
        ...(participantName != null && { name: participantName }),
        ...(participantPicture != null && { avatarUrl: participantPicture ?? undefined }),
      } as T['participant'];
    }
    return updated;
  });
}

export interface ParticipantUpdatedPayload {
  convId: string;
  participantName?: string;
  participantPicture?: string | null;
}

/**
 * Apply participant_updated event: update name/picture for the given convId.
 */
export function applyParticipantUpdated<T extends { id: string; participant?: { name?: string; avatarUrl?: string } }>(
  conversations: T[],
  payload: ParticipantUpdatedPayload
): T[] {
  const { convId, participantName, participantPicture } = payload;
  return conversations.map((c) => {
    if (c.id !== convId) return c;
    const updated = { ...c };
    if (participantName != null || participantPicture != null) {
      updated.participant = {
        ...(c.participant ?? {}),
        ...(participantName != null && { name: participantName }),
        ...(participantPicture != null && { avatarUrl: participantPicture ?? undefined }),
      } as T['participant'];
    }
    return updated;
  });
}

/**
 * Upsert a conversation: add new or update existing, sort by updatedTime descending.
 */
export function upsertConversation<T extends { id: string; updatedTime?: number; lastMessageTime?: number }>(
  conversations: T[],
  incoming: T
): T[] {
  const existing = conversations.findIndex((c) => c.id === incoming.id);
  let next: T[];
  if (existing >= 0) {
    next = [...conversations];
    next[existing] = incoming;
  } else {
    next = [...conversations, incoming];
  }
  return next.sort((a, b) => {
    const ta = a.updatedTime ?? a.lastMessageTime ?? 0;
    const tb = b.updatedTime ?? b.lastMessageTime ?? 0;
    return tb - ta;
  });
}
