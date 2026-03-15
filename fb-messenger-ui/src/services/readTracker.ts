const STORAGE_KEY = 'read_tracker';

interface ReadState {
  [conversationId: string]: {
    lastReadTimestamp: number;
    lastReadMessageId: string;
  };
}

function load(): ReadState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as ReadState;
  } catch {
    return {};
  }
}

function save(state: ReadState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const ReadTracker = {
  markRead(conversationId: string, lastMessageId: string) {
    const state = load();
    state[conversationId] = {
      lastReadTimestamp: Date.now(),
      lastReadMessageId: lastMessageId,
    };
    save(state);
  },

  isUnread(conversationId: string, latestMessageId: string): boolean {
    const state = load();
    const entry = state[conversationId];
    if (!entry) return true;
    return entry.lastReadMessageId !== latestMessageId;
  },

  getDisplayCount(
    conversationId: string,
    latestMessageId: string,
    apiUnreadCount: number
  ): number {
    if (!this.isUnread(conversationId, latestMessageId)) return 0;
    return apiUnreadCount;
  },
};
