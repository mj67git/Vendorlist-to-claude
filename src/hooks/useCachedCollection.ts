import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch, isLocalMode } from '../services/authFetch';
import { can, type Permission } from '../utils/permissions';
import type { User } from '../types';

/**
 * One collection of server records, with its browser cache.
 *
 * The three collections this application holds — sources, materials, business
 * partners — each had their own hand-written copy of the same four concerns,
 * and the copies had already drifted. This is that shape written once:
 *
 *   1. **The cache is a cache.** PostgreSQL is the only source of truth
 *      (project rule 1); `localStorage` exists so a reload has something to
 *      draw while the fetch is in flight, and so a dropped connection shows the
 *      last known state instead of an empty page. It is never authoritative.
 *   2. **Reading is a permission.** Without the gate a refused read came back
 *      403, the catch blamed the network for a deliberate policy decision, and
 *      the cache kept showing the list the account had just lost. When the
 *      permission is absent the collection is emptied — including its cache.
 *   3. **A failed fetch keeps the cache**, because stale-but-labelled beats
 *      blank. A *refused* fetch does not, because that is not a failure.
 *   4. **`reload()` is how a caller asks for the truth again.** The write path
 *      calls it when the server refuses a change: the optimistic update and the
 *      cache are both showing something the database rejected, and re-reading
 *      is the only honest way back.
 *
 * Deliberately not a general-purpose query library. There is no request
 * deduplication, no background refetch and no stale-while-revalidate, because
 * nothing here needs them and every one of them would be another behaviour to
 * reason about in a regulated system.
 */
export interface CachedCollection<T> {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  /** True while the first fetch of this session is in flight. */
  loading: boolean;
  /** Set when the fetch failed and the list on screen came from the cache. */
  error: string | null;
  /** Re-read from the server and replace what is on screen. */
  reload: () => Promise<void>;
}

export interface CachedCollectionOptions<T> {
  /** localStorage key. */
  cacheKey: string;
  url: string;
  /** The permission that gates reading. Absent means everyone signed in may. */
  permission?: Permission;
  /** Who is asking; nothing is fetched until somebody is signed in. */
  user: User | null;
  /** Applied to every record on the way in, from the server and from the cache. */
  normalize?: (raw: any) => T;
  /**
   * Whether an empty array from the cache counts as a cache.
   *
   * For most collections it does not: an empty array is what a normal session
   * writes before its first fetch answers, and honouring it would leave local
   * demo mode — which has no backend to fill it — permanently empty.
   */
  trustEmptyCache?: boolean;
  /** Message to show when the fetch fails and the cache is what is on screen. */
  offlineMessage?: string;
}

function readCache<T>(key: string, normalize?: (raw: any) => T, trustEmpty = false): T[] {
  try {
    const saved = localStorage.getItem(key);
    const parsed = saved ? JSON.parse(saved) : null;
    if (!Array.isArray(parsed)) return [];
    if (!parsed.length && !trustEmpty) return [];
    return normalize ? parsed.map(normalize) : (parsed as T[]);
  } catch {
    return [];
  }
}

export function useCachedCollection<T>(options: CachedCollectionOptions<T>): CachedCollection<T> {
  const { cacheKey, url, permission, user, normalize, trustEmptyCache, offlineMessage } = options;

  const [items, setItems] = useState<T[]>(() => readCache<T>(cacheKey, normalize, trustEmptyCache));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read through a ref so `reload` stays stable: it is handed to write handlers
  // that would otherwise be rebuilt on every keystroke elsewhere in the tree.
  const normalizeRef = useRef(normalize);
  normalizeRef.current = normalize;

  useEffect(() => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(items));
    } catch (err) {
      // A full quota is not worth losing the session over; the data is on the
      // server and the next reload simply starts without a cache.
      console.error(`Failed to cache ${cacheKey}:`, err);
    }
  }, [cacheKey, items]);

  const fetchNow = useCallback(async () => {
    if (!user) return;

    // Reading is a permission, and being refused is not an error.
    if (permission && !can(user, permission)) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Local demo mode answers every read with a synthetic 503 so the cache
    // stands in for the database; there is nothing to fetch.
    if (isLocalMode()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch(url);
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const fn = normalizeRef.current;
        setItems(fn ? data.map(fn) : (data as T[]));
      }
      setError(null);
    } catch (err) {
      console.error(`Failed to load ${url}; showing the cached copy.`, err);
      setError(offlineMessage ?? 'ارتباط با سرور برقرار نشد؛ آخرین دادهٔ ذخیره‌شده نمایش داده می‌شود.');
    } finally {
      setLoading(false);
    }
  }, [url, permission, user, offlineMessage]);

  useEffect(() => {
    void fetchNow();
  }, [fetchNow]);

  return { items, setItems, loading, error, reload: fetchNow };
}
