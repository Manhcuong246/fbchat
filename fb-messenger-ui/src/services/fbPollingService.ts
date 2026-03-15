import { CacheService } from './cacheService';
import { fetchConversations } from './syncService';
import type { PageInfo } from '../types/auth';

const RATE_LIMITED_KEY = 'rate_limited_until';
const POLL_INTERVAL = 30000;
const BACKEND = 'http://localhost:3001';

interface PollResult {
  changes: string[];
  total: number;
}

export function startPolling(
  pages: PageInfo[],
  onNewMessage: (conversationId: string, updatedTime?: string) => void,
  onNewConversation: () => void
): () => void {
  const rateLimitedUntil = Number(localStorage.getItem(RATE_LIMITED_KEY) || 0);
  if (Date.now() < rateLimitedUntil) {
    console.warn('[Poll] Still rate limited, skip polling');
    return () => {};
  }

  // Lưu updated_time của từng conversation để detect thay đổi
  const lastUpdatedMaps: Record<string, Record<string, string>> = {};
  const initialized: Record<string, boolean> = {};
  pages.forEach((p) => {
    lastUpdatedMaps[p.id] = {};
    initialized[p.id] = false;
  });

  let consecutiveErrors = 0;
  let currentInterval = POLL_INTERVAL;
  let timeoutId: ReturnType<typeof setTimeout>;
  let stopped = false;

  const pollPage = async (page: PageInfo) => {
    // Gọi qua backend proxy — không gọi Facebook trực tiếp
    const url = `${BACKEND}/api/conversations/poll?token=${encodeURIComponent(page.accessToken)}&pageId=${page.id}`;
    const res = await fetch(url);

    if (res.status === 429) {
      console.warn('[Poll] Rate limited! Stopping for 1 hour.');
      localStorage.setItem(RATE_LIMITED_KEY, String(Date.now() + 60 * 60 * 1000));
      stopped = true;
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as PollResult;
    if (!data.changes) return;

    if (!initialized[page.id]) {
      initialized[page.id] = true;
      return;
    }

    if (data.changes.length > 0) {
      // Invalidate cache messages cho các conv thay đổi
      data.changes.forEach((convId) => {
        CacheService.invalidate(`msgs_${convId}`);
        onNewMessage(convId);
      });
      // Nếu tổng conv thay đổi (conv mới) → reload list
      if (data.total > Object.keys(lastUpdatedMaps[page.id]).length) {
        CacheService.invalidatePrefix(`convs_${page.id}`);
        onNewConversation();
      }
    }
  };

  const poll = async () => {
    if (stopped) return;
    try {
      await Promise.allSettled(pages.map((page) => pollPage(page)));
      consecutiveErrors = 0;
      currentInterval = POLL_INTERVAL;
    } catch {
      consecutiveErrors++;
      currentInterval = Math.min(5000 * Math.pow(2, consecutiveErrors), 60000);
    }
    if (!stopped) schedule();
  };

  const handleVisibility = () => {
    if (document.hidden) {
      clearTimeout(timeoutId);
      currentInterval = 60000;
      schedule();
    } else {
      currentInterval = POLL_INTERVAL;
      poll();
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);

  const schedule = () => {
    timeoutId = setTimeout(poll, currentInterval);
  };

  poll();

  return () => {
    stopped = true;
    clearTimeout(timeoutId);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}

/** Fallback khi Socket.io không kết nối được — poll mỗi page, nếu có thay đổi thì refresh list. */
export function startPollingFallback(pages: PageInfo[]): () => void {
  console.log('[POLL] Starting fallback polling (Socket.io unavailable)');
  const timers: ReturnType<typeof setTimeout>[] = [];

  pages.forEach((page) => {
    const poll = async () => {
      try {
        const res = await fetch(
          `${BACKEND}/api/poll/${page.id}?token=${encodeURIComponent(page.accessToken)}`
        );
        if (res.ok) {
          const data = (await res.json()) as { hasChanges?: boolean };
          if (data.hasChanges) await fetchConversations(page.id);
        }
      } catch {}
      timers.push(setTimeout(poll, 30000));
    };
    timers.push(setTimeout(poll, 5000));
  });

  return () => timers.forEach(clearTimeout);
}
