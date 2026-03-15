import { createStore } from 'solid-js/store';
import type { AuthState, PageInfo } from '../types/auth';
import { FbAuthService } from '../services/fbAuthService';

const [authState, setAuthState] = createStore<AuthState>({
  availablePages: [],
  selectedPages: [],
  step: 'input_token',
  loading: false,
});

export { authState, setAuthState };

// Compat: các nơi cũ dùng authState.pages → trỏ về selectedPages
export const getPages = () => authState.selectedPages;

export function initAuth(): boolean {
  const saved = FbAuthService.loadAuth();
  if (saved && saved.selectedPages.length > 0) {
    setAuthState({
      userToken: saved.userToken,
      userInfo: saved.userInfo,
      selectedPages: saved.selectedPages,
      availablePages: saved.selectedPages,
      step: 'ready',
      loading: false,
    });
    return true;
  }
  return false;
}

export async function submitUserToken(userToken: string): Promise<boolean> {
  setAuthState({ loading: true, error: undefined });

  const result = await FbAuthService.validateUserToken(userToken);
  if (!result.ok) {
    setAuthState({ loading: false, error: result.error });
    return false;
  }
  const userInfo = result.user;

  const pages = await FbAuthService.getAvailablePages(userToken);
  if (pages.length === 0) {
    setAuthState({
      loading: false,
      error: 'Không tìm thấy Page nào. Token cần quyền pages_show_list hoặc manage_pages.',
    });
    return false;
  }

  setAuthState({
    userToken,
    userInfo,
    availablePages: pages,
    step: 'select_pages',
    loading: false,
    error: undefined,
  });
  return true;
}

export function confirmSelectedPages(selected: PageInfo[]) {
  if (selected.length === 0) return;
  FbAuthService.saveAuth(authState.userToken!, authState.userInfo!, selected);
  setAuthState({ selectedPages: selected, step: 'ready' });
}

export function logout() {
  FbAuthService.clearAuth();
  setAuthState({
    userToken: undefined,
    userInfo: undefined,
    availablePages: [],
    selectedPages: [],
    step: 'input_token',
    loading: false,
    error: undefined,
  });
}

// Legacy compat — các nơi gọi addPage/removePage
export function addPage(page: PageInfo) {
  const pages = [...authState.selectedPages.filter(p => p.id !== page.id), page];
  setAuthState('selectedPages', pages);
}

export function removePage(pageId: string) {
  const pages = authState.selectedPages.filter(p => p.id !== pageId);
  setAuthState('selectedPages', pages);
  if (pages.length === 0) logout();
}
