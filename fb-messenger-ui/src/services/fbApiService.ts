import { CacheService } from './cacheService';

const inflight = new Map<string, Promise<unknown>>();

const requestLog: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 150;

function checkRateLimit(): boolean {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  while (requestLog.length && requestLog[0]! < oneMinuteAgo) requestLog.shift();
  return requestLog.length < MAX_REQUESTS_PER_MINUTE;
}

export async function fbFetch<T>(
  url: string,
  cacheKey: string,
  ttlSeconds: number
): Promise<T | null> {
  const cached = CacheService.get<T>(cacheKey);
  if (cached != null) return cached;

  if (inflight.has(cacheKey)) return inflight.get(cacheKey) as Promise<T | null>;

  if (!checkRateLimit()) {
    console.warn('[fbApi] Rate limit reached, returning null');
    return null;
  }

  const promise = (async (): Promise<T | null> => {
    try {
      requestLog.push(Date.now());
      const res = await fetch(url);
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const err = (await res.json()) as { error?: { message?: string } };
          errMsg = err.error?.message ?? errMsg;
        } catch {
          // ignore
        }
        console.error(`[fbApi] ${cacheKey}:`, errMsg);
        return null;
      }
      const data = (await res.json()) as T;
      CacheService.set(cacheKey, data, ttlSeconds);
      return data;
    } catch (e) {
      console.error('[fbApi] Fetch error:', e);
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}
