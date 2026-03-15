const cache = new Map<string, { data: unknown; timestamp: number; ttl: number }>();

export const CacheService = {
  set(key: string, data: unknown, ttlSeconds: number) {
    cache.set(key, { data, timestamp: Date.now(), ttl: ttlSeconds * 1000 });
  },

  get<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      cache.delete(key);
      return null;
    }
    return entry.data as T;
  },

  invalidate(key: string) {
    cache.delete(key);
  },

  invalidatePrefix(prefix: string) {
    cache.forEach((_, key) => {
      if (key.startsWith(prefix)) cache.delete(key);
    });
  },

  persist(key: string) {
    const entry = cache.get(key);
    if (entry) localStorage.setItem(`cache_${key}`, JSON.stringify(entry));
  },

  loadPersisted(key: string) {
    const raw = localStorage.getItem(`cache_${key}`);
    if (!raw) return;
    try {
      const entry = JSON.parse(raw) as { data: unknown; timestamp: number; ttl: number };
      if (Date.now() - entry.timestamp < entry.ttl) {
        cache.set(key, entry);
      }
    } catch {
      // ignore
    }
  },
};
