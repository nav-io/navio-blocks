import { currentNetwork } from "./context.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/** Namespace a cache key by the in-flight request's network. */
function nsKey(key: string): string {
  return `${currentNetwork()}:${key}`;
}

/**
 * Simple in-memory cache with TTL. Keys are namespaced per network so mainnet
 * and testnet never share an entry within the single API process.
 * Returns cached value if fresh, otherwise calls fn() and caches the result.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => T | Promise<T>): Promise<T> {
  const now = Date.now();
  const fullKey = nsKey(key);
  const entry = store.get(fullKey) as CacheEntry<T> | undefined;
  if (entry && entry.expiresAt > now) {
    return entry.value;
  }
  const value = await fn();
  store.set(fullKey, { value, expiresAt: now + ttlMs });
  return value;
}

/**
 * Invalidate a specific cache key or all keys matching a prefix, scoped to the
 * current network.
 */
export function invalidate(keyOrPrefix: string): void {
  const fullKey = nsKey(keyOrPrefix);
  if (store.has(fullKey)) {
    store.delete(fullKey);
    return;
  }
  for (const k of store.keys()) {
    if (k.startsWith(fullKey)) store.delete(k);
  }
}
