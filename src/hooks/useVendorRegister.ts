import { useEffect, useRef, useState } from 'react';
import type { User, Vendor } from '../types';
import { INITIAL_VENDORS_DB } from '../db_foreign_only';
import { authFetch, isLocalMode } from '../services/authFetch';
import { fetchAllVendors } from '../services/vendorPages';
import { isAllowedVendor, normalizeAndCleanVendor } from '../utils/vendorNormalize';
import { setCalculationWeights } from '../utils/vendorUtils';
import { can } from '../utils/permissions';
import type { ViewState } from '../utils/navStack';

/** One entry of `GET /api/vendors/changes` — an id and a timestamp, never the
 *  record itself (project rule 11a). */
interface VendorChange {
  id: string;
  updatedAt?: string;
}

/**
 * The register on screen, and everything that keeps it honest.
 *
 * Three jobs that only make sense together: the first read at sign-in (paged,
 * painted as it lands), the offline cache that makes a reload cheap, and the
 * half-minute poll that lets a second operator see the first one's work
 * without pressing reload (rule 11a). They share the bookkeeping that tells
 * somebody else's change from this session's own — `ownWritesRef`,
 * `knownTotalRef`, `syncCursorRef` — which is exactly why they were impossible
 * to read separately while spread across three regions of `App.tsx`.
 *
 * The two refs it is handed belong to the navigation model: the poll must not
 * refetch under a dirty form, and it refreshes the record the user is standing
 * on. Nothing else about the behaviour changed in the move.
 */
export interface VendorRegisterDeps {
  currentUser: User | null;
  /**
   * Called with a record the poll refreshed while the user was standing on it,
   * so the page they are reading shows the new copy (the same thing the full
   * re-read does through `resyncRef`).
   */
  onVendorRefreshed?: (vendor: Vendor) => void;
  /** True while an open form has unsaved changes: the poll then offers rather
   *  than replaces. */
  navGuardRef: React.MutableRefObject<(() => boolean) | null>;
  /** The live navigation stack, so a refresh can focus the record on screen. */
  historyRef: React.MutableRefObject<ViewState[]>;
}

export function useVendorRegister({ currentUser, navGuardRef, historyRef, onVendorRefreshed }: VendorRegisterDeps) {
  const [vendors, setVendors] = useState<Vendor[]>(() => {
    const CLEANED_VENDORS_DB = INITIAL_VENDORS_DB.filter(isAllowedVendor).map(normalizeAndCleanVendor);
    try {
      const saved = localStorage.getItem('app_db');
      if (saved) {
        let parsed = JSON.parse(saved);
        parsed = parsed.filter(isAllowedVendor).map(normalizeAndCleanVendor);
        
        if (parsed && parsed.length > 0) {
          return parsed;
        }
      }
      return CLEANED_VENDORS_DB;
    } catch {
      return CLEANED_VENDORS_DB;
    }
  });
  
  
  
  // Offline cache only — PostgreSQL is the source of truth, so losing this is a
  // degraded experience, never data loss. Two things matter here:
  //
  //  - The per-record history is dropped. Logs, analysis results and the
  //    per-question raw scores are roughly two thirds of a vendor's JSON and
  //    are never read from the cache (the detail page always refetches), so
  //    caching them just consumed the browser's ~5MB budget for nothing. The
  //    arrays are kept as empty arrays rather than removed, so a cached record
  //    still has the shape every component expects.
  //  - Writing is guarded. localStorage measures in UTF-16, so a list that is
  //    3MB over the wire needs ~6MB of quota; past that setItem throws
  //    QuotaExceededError, and an uncaught throw in an effect takes the whole
  //    page down. On failure the stale cache is dropped and the app carries on
  //    against the server.
  useEffect(() => {
    try {
      const slim = vendors.map(v => ({ ...v, activityLogs: [], analysisRecords: [], rawScores: undefined }));
      localStorage.setItem('app_db', JSON.stringify(slim));
    } catch (err) {
      console.warn('Vendor cache exceeded the browser storage quota; continuing without it.', err);
      try { localStorage.removeItem('app_db'); } catch { /* nothing left to do */ }
    }
  }, [vendors]);
  
  
  useEffect(() => {
    // Both endpoints below are auth-gated, so this must wait for a signed-in
    // user: on the login screen a 401 would make authFetch clear the session
    // and reload, which reloads straight back into this effect.
    if (!currentUser) return;
  
    // A run that has been superseded — the account changed, or the component
    // went away mid-load — stops writing to state instead of racing the run
    // that replaced it.
    let cancelled = false;
  
    // First fetch server calculation weights config dynamically to achieve high regulatory resilience
    authFetch('/api/config/evaluation')
      .then(res => res.json())
      .then(config => {
        if (config && config.weights) {
          setCalculationWeights(config.weights);
          console.log("[DynamicRules] Loaded evaluation weights from backend config server:", config.weights);
        }
      })
      .catch(err => console.error("Error fetching dynamic configuration weights:", err))
      .finally(() => {
        // Reading is a permission now. Without it the request would come back
        // 403 and the catch below would blame the network ("اتصال برقرار نشد")
        // for a deliberate policy decision — and the localStorage cache would
        // keep showing the list the account just lost.
        if (!can(currentUser, 'vendor.read')) {
          setVendors([]);
          setLoadError(null);
          return;
        }
        setIsSyncing(true);
        // Paged, and painted as the pages land. The whole set is still needed —
        // every aggregate in the application is computed over it — but nothing
        // is gained by holding the first 200 sources back until the last one
        // has been serialized.
        // Each run accumulates into its own array and publishes that array —
        // it never appends to whatever is already on screen. Appending looked
        // equivalent and was not: React runs this effect twice on mount in
        // development, and two concurrent runs each appending their pages put
        // every source in the list twice. Publishing a run's own accumulation
        // is idempotent, so a second run can only ever redraw the same list.
        const loaded: Vendor[] = [];
        fetchAllVendors<Vendor>({
          fetchPage: async (page, limit) => {
            const res = await authFetch(`/api/vendors?page=${page}&limit=${limit}`);
            if (!res.ok) throw new Error('API response failed');
            return res.json();
          },
          onPage: (rows) => {
            loaded.push(...rows.filter(isAllowedVendor).map(normalizeAndCleanVendor));
            if (!cancelled) setVendors([...loaded]);
          },
        })
          .then(() => { if (!cancelled) setLoadError(null); })
          .catch(err => {
            if (isLocalMode()) { setLoadError(null); return; }
            console.error("Failed to load vendors from Cloud SQL. Falling back to local storage.", err);
            // A break part-way through paging is worse than a failure at the
            // start: what is on screen came from the server, so it looks
            // trustworthy, but it is a prefix of the register and every total,
            // count and chart computed from it is wrong. Say so explicitly
            // rather than reusing the offline wording.
            if (cancelled) return;
            setLoadError(loaded.length > 0
              ? `فهرست سورس‌ها ناقص بارگذاری شد (${loaded.length.toLocaleString('fa-IR')} مورد). آمار و نمودارها کامل نیستند — صفحه را دوباره بارگذاری کنید.`
              : 'اتصال به سرور برقرار نشد؛ اطلاعات نمایش‌داده‌شده از نسخهٔ محلی است.');
          })
          .finally(() => {
            if (!cancelled) setIsSyncing(false);
          });
      });
  
    return () => { cancelled = true; };
  }, [currentUser]);
  
  /**
   * How many changes other people made while a form on this screen was dirty.
   * Zero means there is nothing to offer; the bar under the header shows the
   * rest. See the background-sync effect below.
   */
  const [remoteChangeCount, setRemoteChangeCount] = useState(0);
  /**
   * Moves each time the register is replaced from the server.
   *
   * The archive and the directory keep their own copy, read through the route
   * that guards them, so they would otherwise sit on a snapshot while the
   * background poll refreshed everybody else's (rule 11a: the data is replaced
   * silently and the page never jumps).
   */
  const [dataRevision, setDataRevision] = useState(0);
  /** The server's clock at the last poll — the `since` of the next one. */
  const syncCursorRef = useRef<string | null>(null);
  /** How many sources the server had at the last poll, which is how a deletion is noticed. */
  const knownTotalRef = useRef<number | null>(null);
  /** Sources this session wrote since the last poll, so we are not told about our own work. */
  const ownWritesRef = useRef<Set<string>>(new Set());
  /** Set below, next to the function itself — the effect above runs before it is defined. */
  const resyncRef = useRef<((focusVendorId?: string) => Promise<void>) | null>(null);
  const [isSyncing, setIsSyncing] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // In local/demo mode the backend is intentionally absent — never show the
  // "connection failed" banner (the mount fetch runs before demo login is set).
  useEffect(() => { if (isLocalMode()) setLoadError(null); }, [currentUser]);
  
  
  /**
   * Fetch the named records and write them over the copies on screen.
   *
   * Returns false when the answer cannot be trusted to be complete — the
   * request failed, or the server returned fewer rows than were asked for,
   * which is what a row this account may no longer read looks like. The caller
   * then falls back to re-reading the list, where that filtering is applied to
   * everything at once.
   */
  const patchChangedVendors = async (ids: string[], focusId?: string): Promise<boolean> => {
    if (ids.length === 0) return true;
    try {
      const res = await authFetch(`/api/vendors?ids=${encodeURIComponent(ids.join(','))}`);
      if (!res.ok) return false;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length !== ids.length) return false;
      const fresh = rows.filter(isAllowedVendor).map(normalizeAndCleanVendor) as Vendor[];
      if (fresh.length === 0) return false;
      const byId = new Map(fresh.map(v => [v.id, v]));
      setVendors(prev => {
        const merged = prev.map(v => byId.get(v.id) ?? v);
        // Somebody else's *new* source arrives as a changed id this session has
        // never seen; it belongs at the top, the way a locally created one does.
        const added = fresh.filter(v => !prev.some(p => p.id === v.id));
        return added.length > 0 ? [...added, ...merged] : merged;
      });
      setDataRevision(n => n + 1);
      const focused = focusId ? byId.get(focusId) : null;
      if (focused) onVendorRefreshed?.(focused);
      return true;
    } catch {
      return false;
    }
  };

  /*
   * Reached through a ref, like `resyncRef` beside it: the poll's effect must
   * not be torn down and rebuilt on every render, which is what naming a
   * freshly created function in its dependency list would do — and rebuilding
   * it restarts the thirty-second interval, so a busy screen would poll far
   * more often than intended, or never.
   */
  const patchRef = useRef(patchChangedVendors);
  patchRef.current = patchChangedVendors;

  /**
   * Background sync — how a second operator sees the first one's work.
   *
   * The register is fetched once at sign-in and, before this, re-read only
   * after a refused write, so two people working at the same time each saw the
   * snapshot they arrived with until somebody pressed reload. Every half minute
   * this asks the server the cheap question (`GET /api/vendors/changes`: ids,
   * timestamps and a count) and acts on the answer.
   *
   * Two rules govern what it does with it, and they are the point of the
   * design:
   *
   *   1. **An edit in progress is never thrown away.** When the unsaved-changes
   *      guard says a form is dirty, nothing is refetched: a bar appears
   *      offering the update, and the operator takes it when they are ready.
   *      Refreshing under a half-typed evaluation would lose real work.
   *   2. **The page never jumps.** A silent refetch replaces the data behind
   *      the current view — including the record open on screen, refreshed in
   *      place through the history stack — and navigates nowhere.
   *
   * Our own writes are filtered out by id: they come back as changes like any
   * other, and without this the operator who just saved would be told their own
   * record changed. The set is cleared each poll, so somebody else's later
   * change to the same record is still seen.
   *
   * `since` is always the server's clock, never the browser's — two machines
   * disagree, and a browser running fast would ask for a window that has not
   * happened yet and miss every write inside it.
   */
  useEffect(() => {
    if (!currentUser || isLocalMode() || !can(currentUser, 'vendor.read')) return;
  
    let stopped = false;
    const poll = async () => {
      if (stopped || document.hidden) return;
      try {
        const since = syncCursorRef.current;
        const res = await authFetch(`/api/vendors/changes${since ? `?since=${encodeURIComponent(since)}` : ''}`);
        if (!res.ok || stopped) return;
        const data = await res.json();
        const firstPoll = syncCursorRef.current === null;
        syncCursorRef.current = typeof data.serverTime === 'string' ? data.serverTime : syncCursorRef.current;
  
        const previousTotal = knownTotalRef.current;
        knownTotalRef.current = typeof data.total === 'number' ? data.total : previousTotal;
  
        // The first poll only establishes the cursor. Without this, everything
        // written before the session started would count as "new".
        if (firstPoll) { ownWritesRef.current.clear(); return; }
  
        const mine = ownWritesRef.current;
        const changed = (Array.isArray(data.changed) ? (data.changed as VendorChange[]) : [])
          .filter(c => c && typeof c.id === 'string' && !mine.has(c.id));
        ownWritesRef.current = new Set();
  
        // A deletion leaves no timestamp behind, so the count is what reveals
        // it — and a creation by someone else moves both.
        const countMoved = previousTotal !== null && typeof data.total === 'number' && data.total !== previousTotal;
        if (changed.length === 0 && !countMoved) return;
  
        if (navGuardRef.current?.()) {
          setRemoteChangeCount(n => n + Math.max(changed.length, countMoved ? 1 : 0));
          return;
        }
        const stack = historyRef.current;
        const focusId = stack[stack.length - 1]?.selectedVendor?.id;

        /*
         * Read back only what moved.
         *
         * The poll already knows which ids changed — that is the whole content
         * of `/api/vendors/changes` — and it used to spend them on a complete
         * re-read of the register: about nine megabytes on ten thousand
         * sources, every thirty seconds for as long as somebody else kept
         * saving. The rows are patched in by id instead.
         *
         * A moved *count* is the exception and still re-reads everything: a
         * deleted row leaves no timestamp behind, so there is no id to ask
         * for, and nothing short of the list reveals which one went.
         */
        if (!countMoved && changed.length > 0) {
          const patched = await patchRef.current(changed.map(c => c.id), focusId);
          if (patched) return;
        }
        await resyncRef.current?.(focusId);
      } catch {
        // A poll that fails changes nothing on screen: the cursor is untouched,
        // so the next one asks for the same window again.
      }
    };
  
    const timer = window.setInterval(poll, 30000);
    // A tab that was in the background missed every tick; ask once on return
    // rather than waiting out another interval.
    const onVisible = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    void poll();
  
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // The two refs come from `useAppNavigation` and never change identity, so
    // naming them here costs nothing and keeps the dependency list honest —
    // the lint rule cannot know a ref handed back by another hook is stable.
  }, [currentUser, historyRef, navGuardRef]);

  return {
    vendors, setVendors,
    isSyncing, loadError, setLoadError,
    remoteChangeCount, setRemoteChangeCount,
    dataRevision, setDataRevision,
    ownWritesRef, knownTotalRef, resyncRef,
  };
}
