interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Simple in-memory cache with TTL.
 * Returns cached value if fresh, otherwise calls fn() and caches the result.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => T | Promise<T>): Promise<T> {
  const now = Date.now();
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expiresAt > now) {
    return entry.value;
  }
  const value = await fn();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/**
 * Invalidate a specific cache key or all keys matching a prefix.
 */
export function invalidate(keyOrPrefix: string): void {
  if (store.has(keyOrPrefix)) {
    store.delete(keyOrPrefix);
    return;
  }
  for (const k of store.keys()) {
    if (k.startsWith(keyOrPrefix)) store.delete(k);
  }
}
