import localforage from 'localforage';

let store: ReturnType<typeof localforage.createInstance> | null = null;

function getStore() {
  if (typeof window === 'undefined') return null;
  if (!store) {
    store = localforage.createInstance({
      name: 'openapi-agent',
      storeName: 'spec_cache',
      description: 'Cached spec data for fast initial load',
    });
  }
  return store;
}

interface CacheEntry<T> { data: T; expiry: number; }

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const s = getStore();
    if (!s) return null;
    const item = await s.getItem<CacheEntry<T>>(key);
    if (!item) return null;
    if (Date.now() > item.expiry) { s.removeItem(key).catch(() => {}); return null; }
    return item.data;
  } catch { return null; }
}

export async function cacheSet<T>(key: string, data: T, ttlMs = 300_000): Promise<void> {
  try {
    const s = getStore();
    if (!s) return;
    await s.setItem(key, { data, expiry: Date.now() + ttlMs });
  } catch { /**/ }
}

export async function cacheInvalidateSpec(): Promise<void> {
  try {
    const s = getStore();
    if (!s) return;
    const keys = await s.keys();
    await Promise.all(keys.filter(k => k.startsWith('spec_')).map(k => s.removeItem(k)));
  } catch { /**/ }
}
