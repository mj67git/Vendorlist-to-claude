import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AlertTriangle, X, CheckCircle, ShieldAlert, Loader2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { INITIAL_VENDORS_DB } from './db_foreign_only';
import { Category, Vendor, User, Material, BusinessPartner } from './types';
import { categoryLabels } from './constants/categories';

/**
 * Pages that are not the page you land on.
 *
 * Each of these is a whole module — the audit trail with its filters and diff
 * view, the user administration screen, the partner repository — and a session
 * may well never open one. Loading them with the application meant every user
 * downloaded every module before seeing the dashboard.
 *
 * They are fetched when navigated to instead, behind the Suspense boundary in
 * `renderContent`. The views that ARE the landing surface — the dashboard, a
 * category list, a source's detail page and its form — stay in the main bundle
 * on purpose: splitting the common path only trades one wait for another.
 */
const SupplierAuditView = React.lazy(() => import('./components/views/SupplierAuditView').then(m => ({ default: m.SupplierAuditView })));
const ArchiveView = React.lazy(() => import('./components/views/ArchiveView').then(m => ({ default: m.ArchiveView })));
const AuditTrailView = React.lazy(() => import('./components/AuditTrailView').then(m => ({ default: m.AuditTrailView })));
const UsersView = React.lazy(() => import('./components/UsersView').then(m => ({ default: m.UsersView })));
const MaterialRepositoryView = React.lazy(() => import('./components/MaterialRepositoryView').then(m => ({ default: m.MaterialRepositoryView })));
const BusinessPartnerRepositoryView = React.lazy(() => import('./components/BusinessPartnerRepositoryView').then(m => ({ default: m.BusinessPartnerRepositoryView })));
const WorklistView = React.lazy(() => import('./components/views/WorklistView').then(m => ({ default: m.WorklistView })));
/*
 * The source page joins them, for the library it draws with rather than for
 * its own size: it is the other eager importer of `recharts`, which is the
 * largest thing in the bundle and was therefore downloaded by everyone who
 * opened the dashboard, whether or not they ever opened a source.
 */
const VendorDetail = React.lazy(() => import('./components/vendor/VendorDetail').then(m => ({ default: m.VendorDetail })));

/** What a page looks like while its code is on the way. */
function PageLoading() {
  return (
    <div className="w-full py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="w-8 h-8 rounded-full border-2 border-border border-t-primary animate-spin" aria-hidden />
      <p className="text-xs">در حال بارگذاری…</p>
    </div>
  );
}
import { CategoryView } from './components/views/CategoryView';
import { HomeView } from './components/views/HomeView';
import { VendorForm } from './components/vendor/VendorForm';
import { LoginView } from './components/LoginView';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { setCalculationWeights, checkLicenseExpiry } from './utils/vendorUtils';
import { encodeRoute, decodeRoute, routeKey, buildStackFromRoute, type RouteState, type TaskKey } from './utils/navRoutes';
import { reconcileSupplierEvaluation } from './utils/sopEvaluation';
import { can, categoryPermission, effectivePermissions, VIEW_PERMISSIONS, type Permission } from './utils/permissions'
import { useGatedVendorList } from './hooks/useGatedVendorList';
import { formatRemaining, sessionRemainingMs } from './utils/session';
import { CommandPalette } from './components/CommandPalette';
import { FormModal } from './components/FormModal';
import { useTheme } from './hooks/useTheme';
import { useToast } from './hooks/useToast';
import { CategoryDenied, PermissionDenied } from './components/AccessDenied';
import { AppHeader } from './components/app/AppHeader';
import { AppSidebar } from './components/app/AppSidebar';
import { authFetch, clearAuthenticationSession, isLocalMode } from './services/authFetch';
import { fetchAllVendors } from './services/vendorPages';
import { isAllowedVendor, normalizeAndCleanVendor } from './utils/vendorNormalize';
import { useCachedCollection } from './hooks/useCachedCollection';
import { createVendorWrites } from './state/vendorWrites';
import { createDomainWrites } from './state/domainWrites';
import {
  capHistory, hydrateVendor, popForm, popView, pushForm, pushVendor,
  pushView, refreshVendorEverywhere, type ViewState,
} from './utils/navStack';
import { readLocalAudit } from './services/localAudit';
import { Button } from './components/ui/button';

/**
 * One row of `GET /api/auth/my-activity`, as the user menu reads it.
 *
 * Only the three fields the menu prints; the endpoint returns a full audit row
 * and the rest is deliberately not restated here, where it would go stale.
 */
export interface MyActivityEntry {
  id: string;
  description?: string;
  action?: string;
}

/**
 * One entry of `GET /api/vendors/changes` — an id and a timestamp, never the
 * record itself (project rule 11a).
 */
interface VendorChange {
  id: string;
  updatedAt?: string;
}

/**
 * What is kept of the selected source when the stack is written to
 * localStorage: enough to name the record in a breadcrumb, and no more. The
 * full record is re-read from the register by id.
 */
interface VendorNavigationSnapshot {
  id: string;
  name?: string;
  material?: string;
  materialEn?: string;
}

/**
 * The stack as it is stored, which is not the stack as it is used.
 *
 * The distinction was made with `as any` — the persisted entry carries four
 * fields where `ViewState` declares a whole `Vendor`. Saying so in a type
 * costs nothing and stops the cast from hiding a real change to either shape.
 */
type PersistedViewState = Omit<ViewState, 'selectedVendor'> & {
  selectedVendor: VendorNavigationSnapshot | null;
};

/** The page container every view is laid out in. */
const CONTENT_WIDTH = 'max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8';


export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('app_currentUser');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });



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


  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('app_currentUser', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('app_currentUser');
      localStorage.removeItem('app_viewHistory');
    }
  }, [currentUser]);

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

  // Re-check the restored account against the server once per load. currentUser
  // is rehydrated from localStorage, and every role gate in the UI reads it, so
  // without this a user whose role was changed — or whose account was closed —
  // keeps their old access until some other call happens to return 401.
  // Deliberately runs on mount only: it verifies what was restored, and must not
  // re-fire when the value it writes back changes.
  const revalidatedRef = useRef(false);
  useEffect(() => {
    if (!currentUser || revalidatedRef.current || isLocalMode()) return;
    revalidatedRef.current = true;

    authFetch('/api/auth/me')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        const fresh = data?.user;
        if (!fresh) return;
        setCurrentUser(prev => {
          if (!prev) return prev;
          const changed =
            prev.role !== fresh.role ||
            prev.name !== fresh.name ||
            (prev.mustChangePassword ?? false) !== (fresh.mustChangePassword ?? false);
          return changed ? { ...prev, ...fresh } : prev;
        });
      })
      .catch(() => {
        // Offline or unreachable: authFetch already signs the user out on a
        // 401/403, so anything else here is a transport problem, not a verdict
        // on the account. Keep the cached session rather than locking them out.
      });
  }, [currentUser]);

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

  const materialsCollection = useCachedCollection<Material>({
    cacheKey: 'app_materials',
    url: '/api/materials',
    permission: 'material.read',
    user: currentUser,
  });
  const { items: materials, setItems: setMaterials } = materialsCollection;

  /**
   * The partner repository.
   *
   * `reconcileSupplierEvaluation` runs on every record on the way in, from the
   * server and from the cache alike: a stored SOP score must not outlive the
   * documents it was computed from, and the evaluation is re-derived rather
   * than trusted (project rule 13).
   *
   * The bundled `INITIAL_BUSINESS_PARTNERS_DB` is demo data and only stands in
   * for the database in local demo mode. With a real backend it used to be the
   * fallback whenever the cache was empty, which meant a fresh browser showed
   * invented partners — with grades and SOP results — as if the server had sent
   * them.
   */
  const partnersCollection = useCachedCollection<BusinessPartner>({
    cacheKey: 'app_business_partners',
    url: '/api/business-partners',
    permission: 'partner.read',
    user: currentUser,
    normalize: reconcileSupplierEvaluation,
  });
  const { items: businessPartners, setItems: setBusinessPartners } = partnersCollection;
  const partnersLoading = partnersCollection.loading;

  // A route carries only a vendor *id*; the full record is re-hydrated from `vendors`
  // (see `selectedVendor` below), which may still be loading on a deep link.
  const routeToViewState = (r: RouteState): ViewState => ({
    view: r.view as ViewState['view'],
    categoryId: (r.categoryId as Category | null) ?? null,
    selectedVendor: r.vendorId ? ({ id: r.vendorId } as Vendor) : null,
    expandedMaterial: r.expandedMaterial ?? null,
    formMode: r.formMode ?? null,
    taskKey: r.taskKey ?? null,
  });

  const viewStateToRoute = (s: ViewState): RouteState => ({
    view: s.view,
    categoryId: s.categoryId ?? null,
    vendorId: s.selectedVendor?.id ?? null,
    expandedMaterial: s.expandedMaterial ?? null,
    formMode: s.formMode ?? null,
    taskKey: s.taskKey ?? null,
  });

  const [viewHistory, setViewHistory] = useState<ViewState[]>(() => {
    // The URL wins on load: it is what makes a link shareable and a refresh
    // faithful. localStorage is only the fallback for a bare '/' entry.
    try {
      const raw = window.location.hash;
      const hasRoute = !!raw && raw !== '#' && raw !== '#/';
      if (hasRoute) {
        const fromUrl = decodeRoute(raw);
        // A malformed link starts at home rather than silently resurrecting
        // whatever location this browser happened to visit last.
        return fromUrl
          ? buildStackFromRoute(fromUrl).map(routeToViewState)
          : [{ view: 'home', categoryId: null, selectedVendor: null }];
      }
    } catch { /* fall through to the cached stack */ }
    try {
      const saved = localStorage.getItem('app_viewHistory');
      return saved ? capHistory(JSON.parse(saved)) : [{ view: 'home', categoryId: null, selectedVendor: null }];
    } catch {
      return [{ view: 'home', categoryId: null, selectedVendor: null }];
    }
  });

  useEffect(() => {
    try {
      // Persist only a light identity snapshot of the selected vendor — the full
      // record is re-hydrated from `vendors` by id on read, so storing the whole
      // object (risk/analysis/activity arrays) would bloat localStorage.
      const slim: PersistedViewState[] = viewHistory.map(s => ({
        ...s,
        selectedVendor: s.selectedVendor
          ? {
              id: s.selectedVendor.id,
              name: s.selectedVendor.name,
              material: s.selectedVendor.material,
              materialEn: s.selectedVendor.materialEn,
            }
          : null,
      }));
      localStorage.setItem('app_viewHistory', JSON.stringify(slim));
    } catch (err) {
      console.error("Failed to save view history to localStorage:", err);
    }
  }, [viewHistory]);

  const currentViewState = viewHistory[viewHistory.length - 1] || { view: 'home', categoryId: null, selectedVendor: null };
  const view = currentViewState.view;
  const categoryId = currentViewState.categoryId;
  const formMode = currentViewState.formMode ?? null;
  // A vendor reached through a shared link is only an id until `vendors` arrives, so
  // distinguish "still loading" from "this link points at a source that no
  // longer exists" instead of rendering a detail page full of blanks.
  const pendingVendor = currentViewState.selectedVendor;
  const resolvedVendor = pendingVendor ? vendors.find(v => v.id === pendingVendor.id) ?? null : null;
  const isVendorStub = !!pendingVendor && !pendingVendor.name;
  const selectedVendor = pendingVendor
    ? (resolvedVendor ?? (isVendorStub ? null : pendingVendor))
    : null;
  const vendorLinkPending = !!pendingVendor && !resolvedVendor && isVendorStub;

  // Once the dataset arrives, replace the id-only stub on the stack with the
  // real record so the breadcrumb shows the source name instead of a placeholder.
  useEffect(() => {
    if (!isVendorStub || !resolvedVendor) return;
    setViewHistory(prev => hydrateVendor(prev, resolvedVendor));
  }, [isVendorStub, resolvedVendor]);

  // Expanded material is scoped to the current view entry (persists across
  // reloads via viewHistory, and is restored automatically on back-navigation).
  const expandedMaterial = currentViewState.expandedMaterial ?? null;
  const setExpandedMaterial = (mat: string | null) => {
    setViewHistory(prev => {
      if (!prev.length) return prev;
      const nh = [...prev];
      nh[nh.length - 1] = { ...nh[nh.length - 1], expandedMaterial: mat };
      return nh;
    });
  };
  // Reset the scroll position whenever the rendered view changes, so the user
  // never lands mid-page on a freshly opened screen. (A material group that
  // needs to be revealed scrolls itself into view shortly afterwards.)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const viewKey = `${view}|${categoryId ?? ''}|${currentViewState.selectedVendor?.id ?? ''}|${formMode ?? ''}`;
  useEffect(() => {
    const reset = () => scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    reset();
    // Run again after paint: a freshly mounted view can autofocus an input (or
    // finish its enter transition) and nudge the container back down.
    const raf = requestAnimationFrame(() => requestAnimationFrame(reset));
    return () => cancelAnimationFrame(raf);
  }, [viewKey]);

  // --- Unsaved-changes guard -------------------------------------------------
  // Detail screens register a predicate here; any navigation away is deferred
  // behind a confirmation dialog while it returns true. This prevents silent
  // loss of an open edit form (a real data-integrity risk under GxP).
  const navGuardRef = useRef<(() => boolean) | null>(null);
  /**
   * How many source saves are still waiting for the server.
   *
   * The unsaved-changes guard stays armed until the answer arrives, deliberately
   * (rule 8a), so a user who presses save and then leaves gets a dialog that
   * says their work will be lost — while the save is in fact in flight and about
   * to succeed. The count lets that dialog tell the truth instead.
   */
  const [savesInFlight, setSavesInFlight] = useState(0);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  // Read from callbacks that fire after a save, where the rendered closure
  // would hold whatever `pendingNav` was when the form was drawn.
  const pendingNavRef = useRef<(() => void) | null>(null);
  pendingNavRef.current = pendingNav;
  const registerNavGuard = React.useCallback((fn: (() => boolean) | null) => {
    navGuardRef.current = fn;
  }, []);

  // The guard above covers navigation *inside* the app. Closing the tab or
  // pressing F5 goes around it entirely, so the same signal is handed to the
  // browser's own prompt — the last way an open form could be lost in silence.
  // The wording of that prompt belongs to the browser and cannot be set; only
  // whether it appears is ours.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!navGuardRef.current?.()) return;
      e.preventDefault();
      // Legacy browsers key off the return value rather than preventDefault.
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // --- Hash routing / browser history ---------------------------------------
  // The URL hash is the shareable source of truth for the current location, and
  // each in-app push creates a real browser history entry — so Back, Forward
  // and the browser's history menu all behave natively.
  // NOTE: these hooks must stay above the early returns below so that hook
  // order stays stable across the login / change-password screens.
  const historyRef = useRef(viewHistory);
  historyRef.current = viewHistory;
  // Set while we are applying a URL change, so the sync effect below does not
  // push a duplicate entry for a location the browser already navigated to.
  const applyingUrlRef = useRef(false);
  const lastHashRef = useRef<string | null>(null);
  // How many browser history entries this session created. A deep link opened
  // directly into a detail page has none, so Back must unwind the stack itself
  // rather than sending the user off the site.
  const pushedEntriesRef = useRef(0);
  /*
   * The next stack change replaces where we are rather than going deeper, so
   * the URL must be written with `replaceState`.
   *
   * Two moves leave a page behind instead of stacking on it: a saved
   * registration, where the record takes the form's place, and a saved edit,
   * which pops the form. The app stack handled both correctly, but the URL
   * effect below pushed a browser entry either way — so the browser's own
   * history still held `#/category/<cat>/new`, and one Back from the record
   * just saved landed the user on an empty «سورس جدید» form. That entry names
   * a page the app had already finished with, so `popstate` could not find it
   * on the stack and adopted it as a new location.
   */
  const replaceUrlRef = useRef(false);
  const canPopBrowserRef = { get current() { return pushedEntriesRef.current > 0; } };

  useEffect(() => {
    const top = viewHistory[viewHistory.length - 1];
    if (!top) return;
    const hash = encodeRoute(viewStateToRoute(top));
    if (hash === lastHashRef.current) return;

    const isFirst = lastHashRef.current === null;
    lastHashRef.current = hash;
    if (applyingUrlRef.current) return;   // came *from* the URL; nothing to write

    try {
      // The very first render adopts the current URL rather than adding to the
      // browser stack; later pushes are real entries so Back/Forward work.
      if (isFirst || replaceUrlRef.current) {
        window.history.replaceState(null, '', hash);
      } else {
        window.history.pushState(null, '', hash);
        pushedEntriesRef.current += 1;
      }
    } catch { /* history is unavailable (e.g. sandboxed); URL sync is optional */ }
    finally { replaceUrlRef.current = false; }
  }, [viewHistory]);

  useEffect(() => {
    const onPopState = () => {
      const target = decodeRoute(window.location.hash);
      const stack = historyRef.current;
      const currentHash = encodeRoute(viewStateToRoute(stack[stack.length - 1]));

      // An unparseable URL (hand-edited link) must not blank the app.
      if (!target) {
        applyingUrlRef.current = true;
        try { window.history.replaceState(null, '', currentHash); } finally { applyingUrlRef.current = false; }
        return;
      }

      // Respect the unsaved-changes guard: undo the browser's move and ask.
      if (navGuardRef.current?.()) {
        try { window.history.pushState(null, '', currentHash); } catch { /* no-op */ }
        setPendingNav(() => () => {
          navGuardRef.current = null;
          window.history.back();
        });
        return;
      }

      applyingUrlRef.current = true;
      pushedEntriesRef.current = Math.max(0, pushedEntriesRef.current - 1);
      lastHashRef.current = encodeRoute(target);
      setViewHistory(prev => {
        // Backwards move: the URL matches somewhere already on the stack.
        const key = routeKey(target);
        const idx = prev.map(s => routeKey(viewStateToRoute(s))).lastIndexOf(key);
        if (idx >= 0) {
          const next = prev.slice(0, idx + 1);
          // Carry the material expansion from the URL so a shared category link
          // (and Back into one) opens the same group.
          if (target.expandedMaterial !== undefined) {
            next[next.length - 1] = { ...next[next.length - 1], expandedMaterial: target.expandedMaterial };
          }
          return next;
        }
        // Forward, or a location we have never rendered: adopt it.
        return capHistory(buildStackFromRoute(target).map(routeToViewState));
      });
      // Release on the next tick, once the sync effect above has run.
      setTimeout(() => { applyingUrlRef.current = false; }, 0);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('app_sidebar_collapsed') === 'true'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('app_sidebar_collapsed', String(sidebarCollapsed)); } catch { /* ignore */ } }, [sidebarCollapsed]);
  // Global ⌘K / Ctrl+K to open the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setShowCommandPalette(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /**
   * The toast lives in `useToast` now.
   *
   * It was three pieces of state, a timer ref and a function here — plus
   * sixteen call sites that set the message with a bare `setTimeout`, cleared
   * no timer and set no kind. Everything goes through `notify` now, and the
   * hook owns the timer, including cancelling it when the tree goes away.
   */
  const { toast, notify, dismiss: dismissToast } = useToast();

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
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  /**
   * Escape closes the header popovers.
   *
   * Both could only be dismissed by clicking the invisible scrim behind them —
   * every other layer in the application (the modals, the command palette)
   * closes on Escape, and a keyboard user had no way out of these two at all.
   */
  useEffect(() => {
    if (!showUserMenu && !showNotificationPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowUserMenu(false);
      setShowNotificationPanel(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showUserMenu, showNotificationPanel]);

  // Session facts for the user menu. The remaining time is recomputed each time
  // the menu opens rather than ticking, since it is a coarse label.
  /**
   * The last few things this account did, for the user menu.
   *
   * `null` means "not asked yet" and an empty array means "asked, nothing to
   * show" — the menu prints a different line for each, so the two are not
   * interchangeable.
   */
  const [myActivity, setMyActivity] = useState<MyActivityEntry[] | null>(null);
  const [sessionLeftLabel, setSessionLeftLabel] = useState<string | null>(null);
  const [sessionExpiringSoon, setSessionExpiringSoon] = useState(false);
  const myPermissionCount = effectivePermissions(currentUser).length;
  const myPermissionsCustom = currentUser?.permissionsCustom === true;

  useEffect(() => {
    if (!showUserMenu || !currentUser) return;

    const remaining = sessionRemainingMs();
    setSessionLeftLabel(formatRemaining(remaining));
    setSessionExpiringSoon(remaining !== null && remaining < 24 * 60 * 60 * 1000);

    if (isLocalMode()) { setMyActivity([]); return; }
    let cancelled = false;
    authFetch('/api/auth/my-activity?limit=4')
      .then(res => (res.ok ? res.json() : null))
      .then((j: { data?: unknown }) => {
        if (cancelled) return;
        // The endpoint is trusted, but the shape is still checked here: the
        // menu keys its list on `id` and would render nothing useful without.
        const rows = Array.isArray(j?.data) ? (j.data as MyActivityEntry[]) : [];
        setMyActivity(rows.filter(row => row && typeof row.id === 'string'));
      })
      .catch(() => { if (!cancelled) setMyActivity([]); });
    return () => { cancelled = true; };
  }, [showUserMenu, currentUser]);
  const { isDark, toggleTheme } = useTheme();

  // The two read-only views whose permission the server answers on entry. Kept
  // here with the other top-level hooks, above the login early-return, so the
  // hook order cannot change between renders (rule 10).
  // The archive and the directory read their own rows through the route that
  // guards them, rather than borrowing the shared store: what they draw is then
  // the product of a request the server was free to refuse, not of a check made
  // in the browser (rule 14). `dataRevision` moves whenever the register is
  // replaced elsewhere, so a background sync reaches this copy too.
  const gatedView = view === 'archive' || view === 'supplier-audit' ? view : null;
  const gated = useGatedVendorList(
    gatedView, !!currentUser && !isLocalMode(), currentUser?.username ?? null, dataRevision,
  );
  const viewAccess = gated.access;
  const roleInitials = (r?: string) => r === 'admin' ? 'AD' : r === 'qa' ? 'QA' : r === 'commercial' ? 'CO' : r === 'planning' ? 'PL' : r === 'finance' ? 'FI' : 'US';
  const roleTitle = (r?: string) => r === 'admin' ? 'مدیریت ارشد سیستم' : r === 'qa' ? 'واحد تضمین کیفیت QA' : r === 'commercial' ? 'واحد بازرگانی و خرید' : r === 'planning' ? 'برنامه‌ریزی و انبار' : r === 'finance' ? 'واحد مالی و حسابداری' : 'کاربر سیستم';
  const handleLogout = async () => {
    // Tell the server first, so the LOGOUT record actually reaches the audit
    // trail: logging out purely client-side left the log with sign-ins and no
    // matching sign-outs, which breaks its completeness under ALCOA+. The local
    // session is cleared either way — a failed request must never trap the user
    // in a signed-in state.
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* offline, expired token, or local mode — clear the session regardless */
    }
    clearAuthenticationSession();
    setCurrentUser(null);
  };

  const expiringVendors = useMemo(() => {
    return vendors
      .filter(v => !!v.ircExpiryDate && v.ircExpiryDate.trim() !== '' && v.ircExpiryDate.trim().toLowerCase() !== 'n/a')
      .map(v => ({
        vendor: v,
        check: checkLicenseExpiry(v.ircExpiryDate)
      }))
      .filter(item => item.check.status === 'expiring_soon' || item.check.status === 'expired')
      .sort((a, b) => (a.check.daysLeft || 0) - (b.check.daysLeft || 0));
  }, [vendors]);

  // Critical audit events (local mode reads the client store; harmless 0 otherwise).
  const criticalAuditCount = useMemo(() => {
    if (!isLocalMode()) return 0;
    try { return readLocalAudit().filter(record => record.severity === 'Critical').length; } catch { return 0; }
  }, [vendors, businessPartners, materials]);

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
        await resyncRef.current?.(stack[stack.length - 1]?.selectedVendor?.id);
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
  }, [currentUser]);

  if (!currentUser) {
    return <LoginView onLogin={setCurrentUser} />;
  }

  if (currentUser && currentUser.mustChangePassword) {
    return (
      <ChangePasswordModal
        currentUser={currentUser}
        isForceChange={true}
        onPasswordChanged={(updatedUser) => {
          setCurrentUser(updatedUser);
        }}
        onLogout={() => {
          localStorage.removeItem('app_jwt_token');
          localStorage.removeItem('app_currentUser');
          localStorage.removeItem('app_viewHistory');
          setCurrentUser(null);
        }}
      />
    );
  }

  const runGuarded = (action: () => void) => {
    if (navGuardRef.current?.()) {
      setPendingNav(() => action);
      return;
    }
    action();
  };

  const navigate = (newView: ViewState['view'], newCat: Category | null = null, taskKey: TaskKey | null = null) => {
    runGuarded(() => {
      setViewHistory(prev => pushView(prev, newView, newCat, taskKey));
      setSidebarOpen(false);
    });
  };

  const handleSelectVendor = (vendor: Vendor | null) => {
    if (vendor) {
      runGuarded(() => {
        setViewHistory(prev => pushVendor(prev, vendor));
      });
    } else {
      goBack();
    }
  };

  // Back and breadcrumb jumps delegate to the browser so that its own Back /
  // Forward buttons stay in step with the in-app stack; `popstate` above is the
  // single place that unwinds it. Only when there is no browser entry to pop
  // (a deep link opened straight into a detail page) do we unwind directly.
  const goBack = () => {
    if (viewHistory.length <= 1) return;
    runGuarded(() => {
      if (canPopBrowserRef.current) window.history.back();
      else setViewHistory(popView);
    });
  };

  // The source form is a page of its own: pushing it onto the stack gives it a
  // URL, a breadcrumb and a working Back button for free, and keeps its own
  // "new partner" dialog from becoming a modal inside a modal.
  const openSourceForm = (mode: 'create' | 'edit', cat?: Category | null) => {
    runGuarded(() => {
      setViewHistory(prev => pushForm(prev, mode, cat));
      setSidebarOpen(false);
    });
  };

  // Leaving the form page after a successful save must land somewhere definite,
  // so it pops the form entry from the stack rather than asking the browser to
  // go "back" — the entry behind it is not guaranteed to be the list.
  const closeSourceForm = () => {
    // The form page is finished, not somewhere to come back to.
    replaceUrlRef.current = true;
    setViewHistory(popForm);
  };

  /*
   * `goToHistoryIndex` is gone with the stack-derived breadcrumb. The trail is
   * a path now, not a visit log, so a crumb names a location rather than a
   * depth — `goToCrumb` navigates to it and lets `navigate` decide whether that
   * unwinds the stack or pushes onto it.
   */

  const getViewStateLabel = (state: ViewState) => {
    if (state.formMode === 'create') return 'سورس جدید';
    if (state.formMode === 'edit') return 'ویرایش سورس';
    if (state.selectedVendor) {
      return state.selectedVendor.name || 'جزییات سورس';
    }
    if (state.view === 'home') return 'صفحه اصلی';
    if (state.view === 'archive') return 'آرشیو کامل';
    if (state.view === 'supplier-audit') return 'بررسی یکپارچه تامین‌کننده';
    if (state.view === 'materials') return 'مخزن مواد اولیه';
    if (state.view === 'audit-trail') return 'ردیابی تغییرات';
    if (state.view === 'business-partners') return 'مخزن شرکای تجاری';
    if (state.view === 'users') return 'مدیریت کاربران';
    if (state.view === 'tasks') return 'کارتابل اقدامات';
    if (state.view === 'category' && state.categoryId) {
      return categoryLabels[state.categoryId]?.fa || 'دسته‌بندی';
    }
    return '';
  };

  /**
   * The breadcrumb trail, derived from the address rather than from the visit
   * history.
   *
   * These are two different things and the header used to print one while
   * calling it the other. `viewHistory` is the order pages were visited, so
   * clicking through four modules produced «صفحه اصلی › خرید خارجی › مخزن مواد
   * اولیه › مخزن شرکای تجاری» — a claim that the partner repository sits inside
   * the foreign-purchase category. The modules are siblings; nothing is inside
   * anything. Worse, the same page got two different trails depending on how it
   * was reached: a fresh link to `#/materials` showed two crumbs, clicking there
   * from another module showed three.
   *
   * `buildStackFromRoute` already models the real shape — home, then the
   * module, then the record, then its edit page — and it is what a deep link
   * and a forward navigation already build. Reading the trail from there makes
   * the path a path, at most four levels deep, and identical however the reader
   * arrived. The back button keeps its own meaning (the previous page visited)
   * and its own label, which is history and stays history.
   */
  const breadcrumbTrail = ((): Array<{ key: string; label: string; route: RouteState }> => {
    const here = viewStateToRoute(currentViewState);
    return buildStackFromRoute(here).map(route => {
      const asState = routeToViewState(route);
      // The route carries only a source id; the name lives on the record. Use
      // the one being shown when it matches, otherwise look it up, otherwise
      // fall back to the generic label rather than printing an id.
      const named = route.vendorId
        ? (currentViewState.selectedVendor?.id === route.vendorId
            ? currentViewState.selectedVendor
            : vendors.find(v => v.id === route.vendorId) || null)
        : null;
      return {
        key: routeKey(route),
        label: getViewStateLabel(named ? { ...asState, selectedVendor: named } : asState),
        route,
      };
    }).filter(crumb => !!crumb.label);
    // Not a `useMemo`: this component early-returns for the login screen, so a
    // hook here would be called conditionally (rule 10). The work is a walk over
    // at most four route entries.
  })();

  /**
   * Go to a crumb.
   *
   * `navigate` unwinds the stack when the destination is already on it and
   * pushes when it is not, which is exactly right here: the trail is a path,
   * and a path entry is somewhere the reader is entitled to be regardless of
   * how the history happens to look.
   */
  const goToCrumb = (route: RouteState) => {
    if (route.vendorId) {
      const record = currentViewState.selectedVendor?.id === route.vendorId
        ? currentViewState.selectedVendor
        : vendors.find(v => v.id === route.vendorId) || null;
      if (record) handleSelectVendor(record);
      return;
    }
    navigate(route.view as ViewState['view'], (route.categoryId as Category | null) ?? null, route.taskKey ?? null);
  };


  /**
   * Refresh the saved copy of a source wherever the stack is showing it.
   *
   * The rule and the reason live in `refreshVendorEverywhere`; this is the
   * state wiring around it.
   */
  const updateCurrentVendorInHistory = (vendor: Vendor | null) => {
    if (!vendor) return;
    setViewHistory(prev => refreshVendorEverywhere(prev, vendor));
  };

  /**
   * Everything that writes a source, in `state/vendorWrites.ts`.
   *
   * It is handed the register and the poll's bookkeeping rather than owning
   * them: `App` still holds the list on screen, and the background sync reads
   * the same two refs to tell somebody else's change from this session's own.
   */
  const {
    handleDownloadBackup,
    handleUpdateVendor,
    resyncVendorsFromServer,
    handleDeleteVendor,
    handleAddVendor,
  } = createVendorWrites({
    vendors, setVendors, currentUser, notify,
    updateCurrentVendorInHistory,
    selectVendor: handleSelectVendor,
    setSavesInFlight, setRemoteChangeCount, setDataRevision,
    ownWritesRef, knownTotalRef, resyncRef,
  });

  /**
   * Material and partner writes, in `state/domainWrites.ts`.
   */
  const {
    handleAddMaterial,
    handleEditMaterial,
    handleDeleteMaterial,
    handleAddBusinessPartner,
    handleEditBusinessPartner,
    handleDeleteBusinessPartner,
  } = createDomainWrites({
    materials, setMaterials, businessPartners, setBusinessPartners, currentUser, notify,
    reloadMaterials: materialsCollection.reload,
    reloadPartners: partnersCollection.reload,
  });

  // Views Content
  const renderContent = () => {
    let content;
    let keyName = '';

    // Every page built from the source list shows the same refusal, so it is
    // written once here rather than repeated at each branch.
    const DENY_SOURCES = <PermissionDenied reason="sources" onHome={() => navigate('home')} />;
    // Held back until the server answers. Drawing the page first and replacing
    // it with a refusal a moment later would show it to somebody who may not
    // open it — briefly, but the data would have been on screen.
    const CHECKING_ACCESS = (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <p className="text-xs font-semibold">در حال بررسی سطح دسترسی…</p>
      </div>
    );
    // A read that failed for a reason that is not a refusal. Saying "no access"
    // here would blame the administrator for a network fault; saying nothing
    // would draw an empty archive that looks like an empty register.
    const LOAD_FAILED = (
      <div className="p-8 max-w-xl mx-auto my-12 bg-card border border-border rounded-2xl text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-base font-black text-foreground">اطلاعات این نما خوانده نشد</h2>
        <p className="text-xs text-muted-foreground leading-relaxed font-medium">{gated.error}</p>
        <Button onClick={() => setDataRevision(n => n + 1)} className="text-xs font-bold">تلاش دوباره</Button>
      </div>
    );
    const DENY_ARCHIVE = <PermissionDenied reason="archive" onHome={() => navigate('home')} />;
    const DENY_DIRECTORY = <PermissionDenied reason="supplier-audit" onHome={() => navigate('home')} />;

    if (formMode) {
      // The source form as a full page: it is the longest form in the app and
      // opens dialogs of its own, so it gets the content area rather than an
      // overlay.
      const editing = formMode === 'edit' ? selectedVendor ?? undefined : undefined;
      keyName = `source-form-${formMode}-${editing?.id ?? categoryId ?? 'new'}`;
      // The form is a route, so hiding the button that opens it is not enough:
      // `#/category/foreign/new` is a link someone can be sent or can keep in
      // their history. Refusing here means an account without the permission
      // meets the refusal before filling the form in, rather than after — the
      // server has always refused the save itself (rule 14).
      const formPermission: Permission = formMode === 'edit' ? 'vendor.edit' : 'vendor.create';
      if (!can(currentUser, formPermission)) {
        keyName = `source-form-denied-${formMode}`;
        content = <PermissionDenied reason={formMode === 'edit' ? 'source-edit' : 'source-create'} onHome={() => navigate('home')} />;
      } else {
      content = (
        <VendorForm
          vendors={vendors}
          materials={materials}
          onAddMaterial={handleAddMaterial}
          categoryId={(editing?.category as Category) || (categoryId as Category) || 'domestic'}
          existingVendor={editing}
          onClose={goBack}
          /* Where the two footer buttons part company.
             They share one save; only what happens afterwards differs. A
             registration lands on the new source's own page, because that is
             where the work continues — department scores, risk assessment, the
             rest of the evaluation. «ذخیره و ثبت بعدی» never gets here: the
             form keeps itself and empties in place. An edit returns where it
             came from, which for a form opened off a record is that record.
             (This is why rule 8a now reads "a registration lands on its record":
             the batch button is what keeps bulk entry painless.) */
          onSaved={(saved) => {
            // This runs after the server answers, which can be after the user
            // has moved on. Registration goes to the new record because the
            // work continues there (rule 8a) — but only if the form is still
            // the page they are on. Jumping somebody who has already opened the
            // home page is the same interruption this callback exists to avoid
            // on every other save.
            const stack = historyRef.current;
            const stillOnForm = !!stack[stack.length - 1]?.formMode;
            if (!stillOnForm) return;
            // They pressed something while the save was in flight and the guard
            // stopped them with a dialog. The save has now landed, so the thing
            // they asked for is what happens — not a jump to the new record,
            // which would answer a question they did not ask.
            const waiting = pendingNavRef.current;
            if (waiting) {
              navGuardRef.current = null;
              setPendingNav(null);
              waiting();
              return;
            }
            if (saved && !editing) {
              // The record takes the form's place in the stack, so it takes its
              // place in the browser's history too — Back from here belongs to
              // whatever the user was doing before they opened the form.
              replaceUrlRef.current = true;
              handleSelectVendor(saved);
            } else {
              closeSourceForm();
            }
          }}
          onSave={(v, msg) => (editing ? handleUpdateVendor(v, msg) : handleAddVendor(v))}
          currentUser={currentUser}
          partners={businessPartners}
          onAddPartner={handleAddBusinessPartner}
          registerNavGuard={registerNavGuard}
        />
      );
      }
    } else if (vendorLinkPending) {
      // Deep link into a source: wait for the dataset, then report honestly if
      // the id is not in it.
      const stillLoading = isSyncing || vendors.length === 0;
      keyName = `vendor-pending-${pendingVendor!.id}`;
      content = stillLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <p className="text-xs font-semibold">در حال بازیابی اطلاعات سورس…</p>
        </div>
      ) : (
        <div className="p-8 max-w-xl mx-auto my-12 bg-card border border-border rounded-2xl text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-black text-foreground">سورس مورد نظر یافت نشد</h2>
          <p className="text-xs text-muted-foreground leading-relaxed font-medium">
            لینکی که باز کرده‌اید به سورسی با شناسهٔ <span className="font-mono text-foreground">{pendingVendor!.id}</span> اشاره می‌کند که دیگر در سامانه وجود ندارد (احتمالاً حذف شده است).
          </p>
          <Button onClick={() => navigate('home')} className="text-xs font-bold">
            بازگشت به صفحه اصلی
          </Button>
        </div>
      );
    } else if (selectedVendor) {
      keyName = `vendor-${selectedVendor.id}`;
      content = <VendorDetail vendors={vendors} vendor={selectedVendor} onBack={goBack} onSave={handleUpdateVendor} onDelete={handleDeleteVendor} currentUser={currentUser} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} registerNavGuard={registerNavGuard} onEditVendor={() => openSourceForm('edit')} />;
    } else {
      /*
       * One entry per page, instead of a chain of ten `else if` branches.
       *
       * The chain was 200 lines and every branch repeated the same three
       * decisions in its own words: which key the transition animates on,
       * which permission opens the page, and what to draw when it does not.
       * Written as a table those decisions line up and can be read down a
       * column — and a page added without a permission is now visibly a page
       * added without a permission.
       *
       * The permission is `VIEW_PERMISSIONS`, the same table the sidebar, the
       * command palette and the server read (rule 14). Nothing here is a
       * second opinion about who may see what.
       */
      const DASHBOARD = (
        <HomeView vendors={vendors} onNavigate={navigate} onSelectVendor={handleSelectVendor} onAddVendor={handleAddVendor} currentUser={currentUser} onDownloadBackup={handleDownloadBackup} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} onOpenSourceForm={() => openSourceForm('create')} />
      );

      /**
       * The two views the server answers for.
       *
       * Both read their rows from `GET /api/vendors?view=…`, so the client
       * check is the UX half of a real answer: `denied` is the server's, and
       * `checking` holds the page back until it arrives rather than drawing it
       * and snatching it away (rule 14).
       */
      const serverGated = (denial: React.ReactNode, page: React.ReactNode) =>
        viewAccess === 'denied' ? denial
        : gated.error ? LOAD_FAILED
        : viewAccess === 'checking' ? CHECKING_ACCESS
        : page;

      const taskKey = (currentViewState.taskKey || 'eval') as TaskKey;

      const routes: Record<Exclude<ViewState['view'], 'category'>, { key: string; permission: Permission | null; denied: React.ReactNode; render: () => React.ReactNode }> = {
        home: {
          key: 'home',
          permission: null,
          denied: null,
          render: () => DASHBOARD,
        },
        archive: {
          key: 'archive',
          permission: VIEW_PERMISSIONS.archive,
          denied: DENY_ARCHIVE,
          render: () => serverGated(DENY_ARCHIVE, (
            <ArchiveView vendors={gated.rows} isLoading={gated.loading && gated.rows.length === 0} currentUser={currentUser} partners={businessPartners} materials={materials} onSelectVendor={handleSelectVendor} />
          )),
        },
        'supplier-audit': {
          key: 'supplier-audit',
          permission: VIEW_PERMISSIONS['supplier-audit'],
          denied: DENY_DIRECTORY,
          render: () => serverGated(DENY_DIRECTORY, (
            <SupplierAuditView vendors={gated.rows} isLoading={gated.loading && gated.rows.length === 0} onSelectVendor={handleSelectVendor} currentUser={currentUser} partners={businessPartners} materials={materials} onNavigate={navigate} />
          )),
        },
        tasks: {
          // The backlog is built from the source register, so it is gated on
          // reading sources rather than on a page permission of its own.
          key: `tasks-${taskKey}`,
          permission: 'vendor.read',
          denied: DENY_SOURCES,
          render: () => (
            <WorklistView
              taskKey={taskKey}
              vendors={vendors}
              partners={businessPartners}
              currentUser={currentUser}
              onSelectVendor={handleSelectVendor}
              onNavigate={navigate}
              onSwitchTask={k => navigate('tasks', null, k)}
            />
          ),
        },
        materials: {
          key: 'materials',
          permission: VIEW_PERMISSIONS.materials,
          denied: <PermissionDenied reason="materials" onHome={() => navigate('home')} />,
          render: () => (
            <MaterialRepositoryView
              materials={materials}
              onAddMaterial={handleAddMaterial}
              onEditMaterial={handleEditMaterial}
              onDeleteMaterial={handleDeleteMaterial}
              currentUser={currentUser}
              vendors={vendors}
              isLoading={isSyncing && materials.length === 0}
            />
          ),
        },
        'business-partners': {
          key: 'business-partners',
          permission: VIEW_PERMISSIONS['business-partners'],
          denied: <PermissionDenied reason="business-partners" onHome={() => navigate('home')} />,
          render: () => (
            <BusinessPartnerRepositoryView
              partners={businessPartners}
              onAddPartner={handleAddBusinessPartner}
              onEditPartner={handleEditBusinessPartner}
              onDeletePartner={handleDeleteBusinessPartner}
              currentUser={currentUser}
              vendors={vendors}
              // Not `&& length === 0`: with no cache the list falls back to the
              // bundled INITIAL_BUSINESS_PARTNERS_DB seed, so it is never empty
              // and the skeleton could never appear — the seed was being shown
              // as if it were the server's data while the real fetch was still
              // in flight.
              isLoading={partnersLoading}
            />
          ),
        },
        'audit-trail': {
          key: 'audit-trail',
          permission: VIEW_PERMISSIONS['audit-trail'],
          denied: <PermissionDenied reason="audit-trail" onHome={() => navigate('home')} />,
          render: () => <AuditTrailView currentUser={currentUser} />,
        },
        users: {
          // Opening the module is `users.read`: the list is what the page is,
          // and `GET /api/users` asks for exactly that. What an account can
          // then do inside it is decided button by button, by the permissions
          // the other user endpoints enforce.
          key: 'users',
          permission: VIEW_PERMISSIONS.users,
          denied: <PermissionDenied reason="users" onHome={() => navigate('home')} />,
          render: () => <UsersView currentUser={currentUser} />,
        },
      };

      if (view === 'category' && categoryId) {
        keyName = `category-${categoryId}`;
        content = !can(currentUser, categoryPermission(categoryId)) ? (
          categoryId === 'sample' || categoryId === 'blacklist'
            ? <CategoryDenied categoryId={categoryId} onHome={() => navigate('home')} />
            : DENY_SOURCES
        ) : <CategoryView vendors={vendors} isLoading={isSyncing && vendors.length === 0} categoryId={categoryId} onSelectVendor={handleSelectVendor} currentUser={currentUser} expandedMaterial={expandedMaterial} onToggleMaterial={setExpandedMaterial} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} />;
      } else {
        const route = routes[view as Exclude<ViewState['view'], 'category'>];
        if (!route) {
          // An address that decoded to no page at all. The dashboard is the
          // one page every signed-in account can open.
          keyName = 'home-fallback';
          content = DASHBOARD;
        } else if (route.permission && !can(currentUser, route.permission)) {
          keyName = `${route.key}-denied`;
          content = route.denied;
        } else {
          keyName = route.key;
          content = route.render();
        }
      }
    }

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={keyName}
          initial={{ opacity: 0, y: 10, filter: 'blur(2px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(2px)' }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="w-full h-full"
        >
          {/* The split-out pages arrive here. The fallback is deliberately
              quiet and roughly page-shaped: on a fast internal network it is
              one frame, and a spinner that flashes for one frame reads as a
              glitch rather than as progress. */}
          <React.Suspense fallback={<PageLoading />}>
            {content}
          </React.Suspense>
        </motion.div>
      </AnimatePresence>
    );
  };

  return (
    <>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        /* Custom scrollbar for webkit (theme-aware) */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: var(--muted); }
        ::-webkit-scrollbar-thumb { background: var(--border-hover-color); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--muted-foreground); }
      `}</style>

      <div className="min-h-screen bg-background text-foreground flex overflow-hidden print:overflow-visible print:bg-white print:text-black print:block">
        
        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div 
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-20 md:hidden fade-in-fast" 
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* LEFT PANEL: Fixed Sidebar */}
        <AppSidebar
          currentUser={currentUser}
          vendors={vendors}
          materials={materials}
          businessPartners={businessPartners}
          view={view}
          categoryId={categoryId}
          selectedVendor={selectedVendor}
          navigate={navigate}
          criticalAuditCount={criticalAuditCount}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          setShowCommandPalette={setShowCommandPalette}
        />

        {/* RIGHT PANEL: Main Content Area */}
        <main className={`flex-1 ${sidebarCollapsed ? 'md:pr-[76px]' : 'md:pr-[272px]'} flex flex-col h-screen overflow-hidden transition-all duration-300 print:h-auto print:overflow-visible print:pr-0 print:block`}>
          <AppHeader
            currentUser={currentUser}
            vendors={vendors}
            expiringVendors={expiringVendors}
            criticalAuditCount={criticalAuditCount}
            breadcrumbTrail={breadcrumbTrail}
            goToCrumb={goToCrumb}
            getViewStateLabel={getViewStateLabel}
            selectVendor={handleSelectVendor}
            currentViewState={currentViewState}
            viewHistory={viewHistory}
            goBack={goBack}
            navigate={navigate}
            onOpenSidebar={() => setSidebarOpen(true)}
            isDark={isDark}
            toggleTheme={toggleTheme}
            showNotificationPanel={showNotificationPanel}
            setShowNotificationPanel={setShowNotificationPanel}
            showUserMenu={showUserMenu}
            setShowUserMenu={setShowUserMenu}
            setShowChangePasswordModal={setShowChangePasswordModal}
            myActivity={myActivity}
            sessionLeftLabel={sessionLeftLabel}
            sessionExpiringSoon={sessionExpiringSoon}
            myPermissionCount={myPermissionCount}
            myPermissionsCustom={myPermissionsCustom}
            roleInitials={roleInitials}
            roleTitle={roleTitle}
            handleLogout={handleLogout}
            handleDownloadBackup={handleDownloadBackup}
          />

          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto w-full print:overflow-visible">
            {/* One width for the whole app.
                This used to be a two-view exception list: only the materials
                repository and the audit trail got 1600px and everything else was
                capped at max-w-5xl (1024px), which threw away 624px — 38% of the
                usable area — on a 1920px screen, on pages whose tables have seven
                columns. A shared constant also means a new view is right by
                default instead of waiting for someone to remember the list. */}
            <div className={CONTENT_WIDTH}>
              {renderContent()}
            </div>
          </div>

        </main>

        {/* Unsaved-changes confirmation before leaving an open edit form */}
        <FormModal
          open={!!pendingNav}
          onClose={() => setPendingNav(null)}
          size="sm"
          role="alertdialog"
          className="p-6"
          ariaLabel={savesInFlight > 0 ? 'ذخیره در حال انجام' : 'تغییرات ذخیره‌نشده'}
        >
              {/* Two different situations reach this dialog, and they used to
                  get the same sentence. The guard stays armed until the server
                  answers (rule 8a), so pressing save and then leaving showed
                  «اطلاعات از بین می‌روند» about a save that was already on its
                  way and about to succeed — a warning that was not true. */}
              <div className="flex items-start gap-3.5">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  savesInFlight > 0
                    ? 'bg-primary/10 text-primary'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                }`}>
                  {savesInFlight > 0
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <ShieldAlert className="w-5 h-5" />}
                </div>
                <div className="text-right">
                  <h3 className="text-sm font-black text-foreground mb-1.5">
                    {savesInFlight > 0 ? 'در حال ذخیره' : 'تغییرات ذخیره‌نشده'}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                    {savesInFlight > 0
                      ? 'ذخیرهٔ این فرم هنوز تمام نشده است. چند لحظه صبر کنید تا پاسخ سرور برسد؛ اگر همین حالا خارج شوید ذخیره ادامه پیدا می‌کند، ولی نتیجه‌اش را روی این صفحه نمی‌بینید.'
                      : 'فرمی باز است و اطلاعات واردشده هنوز ذخیره نشده‌اند. اگر از این صفحه خارج شوید، این اطلاعات از بین می‌روند.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-start gap-2.5 mt-6">
                {/* The safe answer leads and carries the primary style: this
                    dialog interrupts someone who was mid-task, and the reflex
                    click should keep their work, not discard it. Same order and
                    wording as the confirmation inside FormModal. */}
                <Button
                  autoFocus
                  onClick={() => setPendingNav(null)}
                  className="text-xs font-bold"
                >
                  {savesInFlight > 0 ? 'ماندن تا پایان ذخیره' : 'بازگشت به فرم'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => { const go = pendingNav; setPendingNav(null); navGuardRef.current = null; go?.(); }}
                  className="border border-border text-xs font-bold"
                >
                  {savesInFlight > 0 ? 'خروج از صفحه' : 'خروج بدون ذخیره'}
                </Button>
              </div>
        </FormModal>

        {/* Global command palette (⌘K) */}
        <CommandPalette
          open={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          vendors={vendors}
          materials={materials}
          partners={businessPartners}
          onSelectVendor={handleSelectVendor}
          onNavigate={navigate}
          currentUser={currentUser}
        />

        {/* Top sync progress bar (non-blocking; shown while syncing with the server) */}
        {isSyncing && (
          <div className="fixed top-0 inset-x-0 z-[60] h-0.5 overflow-hidden bg-[var(--primary)]/15" role="progressbar" aria-label="در حال همگام‌سازی">
            <div className="h-full w-1/3 bg-[var(--primary)] rounded-full animate-[syncSlide_1.1s_ease-in-out_infinite]" />
          </div>
        )}

        {/* Data load error banner (server unreachable) */}
        {loadError && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] fade-in flex items-center gap-2 max-w-[92vw] bg-[var(--card)] border border-[var(--warning-main)]/40 text-[var(--card-foreground)] px-4 py-2.5 rounded-xl shadow-lg">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--warning-main)]" />
            <span className="font-medium text-xs font-sans text-right">{loadError}</span>
            <button onClick={() => setLoadError(null)} className="mr-1 text-[var(--muted-foreground)] hover:text-[var(--card-foreground)]" aria-label="بستن">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Somebody else changed the register while a form here was dirty.

            An offer, not an action: refreshing under a half-finished
            evaluation would throw away real work, so the operator decides when
            to take it. Once no form is dirty the background sync goes back to
            refreshing silently and this never appears. */}
        {remoteChangeCount > 0 && (
          <div
            role="status"
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] fade-in flex items-center gap-3 max-w-[92vw] bg-card border border-primary/40 text-card-foreground px-4 py-2.5 rounded-xl shadow-lg"
          >
            <RefreshCw className="w-4 h-4 shrink-0 text-primary" />
            <span className="font-medium text-xs font-sans text-right">
              {remoteChangeCount.toLocaleString('fa-IR')} تغییر تازه توسط کاربران دیگر ثبت شده است.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-2xs font-bold shrink-0"
              onClick={() => { const stack = historyRef.current; void resyncVendorsFromServer(stack[stack.length - 1]?.selectedVendor?.id); }}
            >
              نمایش تغییرات
            </Button>
            <button onClick={() => setRemoteChangeCount(0)} className="text-muted-foreground hover:text-card-foreground" aria-label="بستن">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Global Toast (theme-aware; error vs. success styling) */}
        {toast && (() => {
          const isError = toast.kind === 'error';
          return (
            <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 fade-in flex items-center gap-2 bg-[var(--card)] text-[var(--card-foreground)] border px-4 py-2.5 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.14)] ${isError ? 'border-[var(--danger-main)]/45' : 'border-[var(--border)]'}`}>
              {isError
                ? <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--danger-main)]" />
                : <CheckCircle className="w-4 h-4 shrink-0 text-emerald-500" />}
              <span className="font-medium text-xs font-sans text-right">{toast.message}</span>
              {toast.action && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const run = toast.action!.run;
                    dismissToast();
                    run();
                  }}
                  className="shrink-0 mr-1 h-7 px-2.5 text-2xs font-bold"
                >
                  {toast.action.label}
                </Button>
              )}
            </div>
          );
        })()}

        {/* Change Password Modal */}
        {showChangePasswordModal && (
          <ChangePasswordModal
            currentUser={currentUser}
            onClose={() => setShowChangePasswordModal(false)}
            onPasswordChanged={(updatedUser) => {
              setCurrentUser(updatedUser);
              notify("کلمه عبور با موفقیت تغییر یافت");
            }}
          />
        )}

      </div>
    </>
  );
}


// --- View: Home ---
