import { createStore } from 'solid-js/store';
import type { ConversationData } from '../types/conversation';

const [convState, setConvState] = createStore<{
  conversations: ConversationData[];
  selectedId: string | null;
  selectedPageId: string | null;
  loading: boolean;
  loadingMore: boolean;
  /** Cursor cho load more, key = pageId */
  afterCursors: Record<string, string | null>;
  /** Có thêm hội thoại để load không, key = pageId */
  hasMore: Record<string, boolean>;
  error: string | null;
}>({
  conversations: [],
  selectedId: null,
  selectedPageId: null,
  loading: true,
  loadingMore: false,
  afterCursors: {},
  hasMore: {},
  error: null,
});

export { convState, setConvState };
