import { createStore } from 'solid-js/store';
import type { ConversationData } from '../types/conversation';

const [searchState, setSearchState] = createStore<{
  query: string;
  results: ConversationData[];
  loading: boolean;
  isSearchMode: boolean;
}>({
  query: '',
  results: [],
  loading: false,
  isSearchMode: false,
});

export { searchState, setSearchState };

export function clearSearch() {
  setSearchState({ query: '', results: [], loading: false, isSearchMode: false });
}
