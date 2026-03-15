import type { UserInfo, PageInfo } from '../types/auth';

const STORAGE_KEY = 'fb_auth_v2';

const PAGE_COLORS = [
  '#3390ec', '#e53935', '#43a047',
  '#fb8c00', '#8e24aa', '#00897b',
  '#d81b60', '#546e7a',
];

function getPageColor(pageId: string): string {
  let hash = 0;
  for (let i = 0; i < pageId.length; i++) {
    hash = pageId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PAGE_COLORS[Math.abs(hash) % PAGE_COLORS.length];
}

export const FbAuthService = {
  async validateUserToken(userToken: string): Promise<{ ok: true; user: UserInfo } | { ok: false; error: string }> {
    try {
      const res = await fetch(
        `http://localhost:3001/api/auth/me?userToken=${encodeURIComponent(userToken)}`
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        return { ok: false, error: data.error || 'Token không hợp lệ' };
      }
      return {
        ok: true,
        user: {
          id: data.id,
          name: data.name,
          avatarUrl: data.picture?.data?.url,
        },
      };
    } catch (e) {
      return { ok: false, error: 'Không kết nối được server. Kiểm tra server đang chạy.' };
    }
  },

  async getAvailablePages(userToken: string): Promise<PageInfo[]> {
    try {
      const res = await fetch(
        `http://localhost:3001/api/auth/pages?userToken=${encodeURIComponent(userToken)}`
      );
      const data = await res.json();
      if (!res.ok || data.error) return [];
      return (data.pages || []).map((p: PageInfo) => ({
        ...p,
        color: getPageColor(p.id),
      }));
    } catch { return []; }
  },

  saveAuth(userToken: string, userInfo: UserInfo, selectedPages: PageInfo[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      userToken, userInfo, selectedPages, savedAt: Date.now(),
    }));
  },

  loadAuth(): { userToken: string; userInfo: UserInfo; selectedPages: PageInfo[] } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Token hết hạn sau 60 ngày
      if (Date.now() - data.savedAt > 60 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      // Thêm màu nếu thiếu
      if (data.selectedPages) {
        data.selectedPages = data.selectedPages.map((p: PageInfo) => ({
          ...p,
          color: p.color || getPageColor(p.id),
        }));
      }
      return data;
    } catch { return null; }
  },

  clearAuth() {
    localStorage.removeItem(STORAGE_KEY);
    // Xóa format cũ nếu có
    localStorage.removeItem('fb_page_token');
    localStorage.removeItem('fb_page_info');
    localStorage.removeItem('fb_pages');
  },
};

// Legacy exports để không break code cũ còn tham chiếu
export function clearToken(): void { FbAuthService.clearAuth(); }
export function loadSavedToken() { return null; }
