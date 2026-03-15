import { createStore } from 'solid-js/store';
import type { MessageData } from '../types/message';

const [msgState, setMsgState] = createStore<{
  messages: Record<string, MessageData[]>;
  beforeCursors: Record<string, string | null>;
  refreshTrigger: Record<string, number>;
  loading: boolean;
  loadingMore: boolean;
}>({
  messages: {},
  beforeCursors: {},
  refreshTrigger: {},
  loading: false,
  loadingMore: false,
});

export { msgState, setMsgState };
