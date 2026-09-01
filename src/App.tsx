import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Home, Archive, AlertTriangle, ChevronLeft, ChevronRight, Search, Menu, X, Shield, Info, Building2, CheckCircle, Handshake, Hash, ShieldAlert, Download, ChevronDown, Database, History, Bell, Calendar, Sun, Moon, UserCog } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { INITIAL_VENDORS_DB } from './db_foreign_only';
import { INITIAL_BUSINESS_PARTNERS_DB } from './db_business_partners';
import { Category, Scores, Vendor, User, Material, BusinessPartner } from './types';
// @ts-ignore
import temadLogo from './assets/logo.png';
import { categoryLabels } from './constants/categories';
import { SupplierAuditView } from './components/views/SupplierAuditView';
import { VendorDetail } from './components/vendor/VendorDetail';
import { ArchiveView } from './components/views/ArchiveView';
import { CategoryView } from './components/views/CategoryView';
import { HomeView } from './components/views/HomeView';
import { VendorForm } from './components/vendor/VendorForm';
import { LoginView } from './components/LoginView';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { setCalculationWeights, checkLicenseExpiry } from './utils/vendorUtils';
import { encodeRoute, decodeRoute, routeKey, buildStackFromRoute, type RouteState, type TaskKey } from './utils/navRoutes';
import { isVendorRejected, isInBlacklistCategory, applyDerivedState } from './utils/vendorState';
import { reconcileSupplierEvaluation } from './utils/sopEvaluation';
import { AuditTrailView } from './components/AuditTrailView';
import { UsersView } from './components/UsersView';
import { can, effectivePermissions } from './utils/permissions';
import { formatDateTime, formatRemaining, sessionRemainingMs } from './utils/session';
import { MaterialRepositoryView } from './components/MaterialRepositoryView';
import { BusinessPartnerRepositoryView } from './components/BusinessPartnerRepositoryView';
import { AppSidebarButton as SidebarButton } from './components/AppSidebarButton';
import { CommandPalette } from './components/CommandPalette';
import { WorklistView } from './components/views/WorklistView';
import { EntityName } from './components/EntityName';
import { FormModal } from './components/FormModal';
import { useTheme } from './design-system/ThemeSwitcher';
import { authFetch, clearAuthenticationSession, isLocalMode } from './services/authFetch';
import { appendLocalAudit, readLocalAudit } from './services/localAudit';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Avatar, AvatarFallback } from './components/ui/avatar';

/**
 * The header clock's date, read the way a date is spoken in Persian: day,
 * month, year, then the weekday.
 *
 * `toLocaleDateString` with all four parts returns "۱۴۰۵ شهریور ۴, چهارشنبه" —
 * year first and the weekday stranded behind a comma. The parts are requested
 * separately and assembled instead, which also avoids stripping punctuation out
 * of a formatted string afterwards.
 */
/** The page container every view is laid out in. */
const CONTENT_WIDTH = 'max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8';

function formatSystemDate(d: Date): string {
  const day = d.toLocaleDateString('fa-IR', { day: 'numeric' });
  const month = d.toLocaleDateString('fa-IR', { month: 'long' });
  const year = d.toLocaleDateString('fa-IR', { year: 'numeric' });
  const weekday = d.toLocaleDateString('fa-IR', { weekday: 'long' });
  return `${day} ${month} ${year} · ${weekday}`;
}

/**
 * Everything the header clock shows, built in one place.
 *
 * The Gregorian date rides along because the people using this correspond with
 * suppliers abroad, where a Persian date means nothing. ISO order rather than a
 * localized form so it cannot be misread as day-first or month-first.
 */
function buildSystemTime(d: Date) {
  return {
    faDate: formatSystemDate(d),
    time: d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
    isoDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  };
}

/**
 * What a module shows to someone who may not read it.
 *
 * Reading became a permission, so "the page is empty" and "you are not allowed
 * to see this" had to stop looking alike: an empty repository and a revoked one
 * rendered the same blank table, and the failed request read as a network error.
 */
const AccessDenied: React.FC<{ title: string; detail: string; onHome: () => void }> = ({ title, detail, onHome }) => (
  <div className="max-w-xl mx-auto my-12 p-8 bg-card border border-border rounded-2xl text-center space-y-4 shadow-xs" dir="rtl">
    <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300 flex items-center justify-center mx-auto">
      <ShieldAlert className="w-6 h-6" />
    </div>
    <h2 className="text-base font-black text-foreground">{title}</h2>
    <p className="text-xs text-muted-foreground leading-relaxed font-medium">{detail}</p>
    <p className="text-[11px] text-muted-foreground">
      برای دریافت دسترسی با مدیر سیستم تماس بگیرید؛ سطح دسترسی هر کاربر در «مدیریت کاربران» تنظیم می‌شود.
    </p>
    <button
      onClick={onHome}
      className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer"
    >
      بازگشت به صفحه اصلی
    </button>
  </div>
);

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('app_currentUser');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [systemTime, setSystemTime] = useState(() => buildSystemTime(new Date()));

  // The clock used to tick every second, and since it lives on App every tick
  // re-rendered the whole tree — sixty times a minute to move a digit nobody
  // reads in a supplier-evaluation system. It now updates once a minute, and
  // each tick is scheduled to land on the next minute boundary rather than a
  // flat 60s later, so the displayed minute never lags behind the real one.
  useEffect(() => {
    let timer: number;
    const tick = () => {
      const d = new Date();
      setSystemTime(buildSystemTime(d));
      const msToNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
      timer = window.setTimeout(tick, msToNextMinute);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);

  const normalizeAndCleanVendor = (v: any): Vendor => {
    if (v.isSample) {
      // Rejection (and its removal) is derived from the QC records, so a deleted
      // Reject result clears the blacklist stamp instead of latching it.
      return applyDerivedState(v) as Vendor;
    }

    const isInitialVendor = typeof v.id === 'string' && v.id.startsWith('vF');
    const hasBeenEvaluatedByUser = (v.rawScores && Object.keys(v.rawScores).length > 0) || (v.scores && (v.scores.commercial > 0 || v.scores.qa > 0));

    if (isInitialVendor && !hasBeenEvaluatedByUser && !v.scores) {
      const isRejected = isVendorRejected(v);
      v.scores = null;
      v.rawScores = null;
      v.status = isRejected ? 'rejected' : 'new';
      v.grade = isRejected ? 'rejected' : 'new';
    }

    if (v.scores && v.scores.qc !== undefined) {
       v.scores.planning = v.scores.qc;
       delete v.scores.qc;
    }

    // `applyDerivedState` owns the rejection stamp and the score-derived grade.
    return applyDerivedState(v) as Vendor;
  };

  const [db, setDb] = useState<Vendor[]>(() => {
    const isAllowedVendor = (v: any) => {
      if (!v || !v.id) return false;
      if (typeof v.id === 'string' && v.id.startsWith('vF')) {
        const numPart = parseInt(v.id.substring(2), 10);
        if (!isNaN(numPart) && numPart > 128) return false;
      }
      return true;
    };
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

  const [showResetConfirm, setShowResetConfirm] = useState(false);

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
      const slim = db.map(v => ({ ...v, activityLogs: [], analysisRecords: [], rawScores: undefined }));
      localStorage.setItem('app_db', JSON.stringify(slim));
    } catch (err) {
      console.warn('Vendor cache exceeded the browser storage quota; continuing without it.', err);
      try { localStorage.removeItem('app_db'); } catch { /* nothing left to do */ }
    }
  }, [db]);

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

    const isAllowedVendor = (v: any) => {
      if (!v || !v.id) return false;
      if (typeof v.id === 'string' && v.id.startsWith('vF')) {
        const numPart = parseInt(v.id.substring(2), 10);
        if (!isNaN(numPart) && numPart > 128) return false;
      }
      return true;
    };

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
          setDb([]);
          setLoadError(null);
          return;
        }
        setIsSyncing(true);
        authFetch('/api/vendors')
          .then(res => {
            if (!res.ok) throw new Error('API response failed');
            return res.json();
          })
          .then((data: Vendor[]) => {
            if (Array.isArray(data) && data.length > 0) {
              const filtered = data.filter(isAllowedVendor).map(normalizeAndCleanVendor);
              setDb(filtered);
            }
            setLoadError(null);
          })
          .catch(err => {
            if (isLocalMode()) { setLoadError(null); return; }
            console.error("Failed to load vendors from Cloud SQL. Falling back to local storage.", err);
            setLoadError('اتصال به سرور برقرار نشد؛ اطلاعات نمایش‌داده‌شده از نسخهٔ محلی است.');
          })
          .finally(() => {
            setIsSyncing(false);
          });
      });
  }, [currentUser]);

  const [materials, setMaterials] = useState<Material[]>(() => {
    try {
      const saved = localStorage.getItem('app_materials');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('app_materials', JSON.stringify(materials));
    } catch (err) {
      console.error("Failed to save materials to localStorage:", err);
    }
  }, [materials]);

  // Load the material catalogue from the backend (PostgreSQL) once authenticated.
  useEffect(() => {
    if (!currentUser) return;
    if (!can(currentUser, 'material.read')) { setMaterials([]); return; }
    authFetch('/api/materials')
      .then(res => (res.ok ? res.json() : null))
      .then((data: Material[] | null) => { if (Array.isArray(data)) setMaterials(data); })
      .catch(err => console.error("Failed to load materials from backend. Using local cache.", err));
  }, [currentUser]);

  const [businessPartners, setBusinessPartners] = useState<BusinessPartner[]>(() => {
    /**
     * The bundled partner list is demo data, so it only stands in for the
     * database in local demo mode.
     *
     * With a real backend it used to be the fallback whenever the browser cache
     * was empty, which meant a fresh browser showed invented partners — with
     * grades and SOP results — as if they came from the server, and the list was
     * never empty so the loading skeleton could not appear either. PostgreSQL is
     * the single source of truth (project rule 1); an empty list until the fetch
     * answers is the honest state. (The server still seeds these same partners
     * into an empty database on first startup — that path writes real rows.)
     */
    try {
      const saved = localStorage.getItem('app_business_partners');
      const cached = saved ? JSON.parse(saved) : null;
      // An empty cached array is not a cache: it is what normal mode writes
      // before its first fetch answers, and honouring it would leave local demo
      // mode — which has no backend to fill it — permanently empty.
      if (Array.isArray(cached) && cached.length > 0) return cached.map(reconcileSupplierEvaluation);
      return isLocalMode() ? INITIAL_BUSINESS_PARTNERS_DB.map(reconcileSupplierEvaluation) : [];
    } catch {
      return isLocalMode() ? INITIAL_BUSINESS_PARTNERS_DB : [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('app_business_partners', JSON.stringify(businessPartners));
    } catch (err) {
      console.error("Failed to save business partners to localStorage:", err);
    }
  }, [businessPartners]);

  // Load business partners from the backend (PostgreSQL) as the source of truth.
  // Guarded on an authenticated user: /api/business-partners requires auth, and
  // an unauthenticated call would trigger authFetch's 401 session reload.
  useEffect(() => {
    if (!currentUser) return;
    if (!can(currentUser, 'partner.read')) { setBusinessPartners([]); setPartnersLoading(false); return; }
    // Its own flag: `isSyncing` tracks the vendors fetch, so borrowing it would
    // have the partner table stop showing skeletons while its own request is
    // still in flight.
    setPartnersLoading(true);
    authFetch('/api/business-partners')
      .then(res => {
        if (!res.ok) throw new Error('API response failed');
        return res.json();
      })
      .then((data: BusinessPartner[]) => {
        if (Array.isArray(data)) {
          // Re-derive each stored SOP evaluation from its documents so a stale
          // score/grade cannot outlive the documents it was computed from.
          setBusinessPartners(data.map(reconcileSupplierEvaluation));
        }
      })
      .catch(err => {
        console.error("Failed to load business partners from backend. Using local cache.", err);
      })
      .finally(() => setPartnersLoading(false));
  }, [currentUser]);

  type ViewState = {
    view: 'home' | 'category' | 'archive' | 'supplier-audit' | 'audit-trail' | 'materials' | 'business-partners' | 'users' | 'tasks';
    categoryId: Category | null;
    selectedVendor: Vendor | null;
    /** Which backlog the worklist page is showing. */
    taskKey?: TaskKey | null;
    expandedMaterial?: string | null;
    /** The source form is a page, not an overlay — this is which page. */
    formMode?: 'create' | 'edit' | null;
  };

  // Cap the navigation stack so a long session cannot grow it without bound.
  const MAX_VIEW_HISTORY = 25;
  const capHistory = (h: ViewState[]) => (h.length > MAX_VIEW_HISTORY ? h.slice(h.length - MAX_VIEW_HISTORY) : h);

  // A route carries only a vendor *id*; the full record is re-hydrated from `db`
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
      // record is re-hydrated from `db` by id on read, so storing the whole
      // object (risk/analysis/activity arrays) would bloat localStorage.
      const slim = viewHistory.map(s => ({
        ...s,
        selectedVendor: s.selectedVendor
          ? ({ id: s.selectedVendor.id, name: s.selectedVendor.name, material: s.selectedVendor.material, materialEn: s.selectedVendor.materialEn } as any)
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
  // A vendor reached through a shared link is only an id until `db` arrives, so
  // distinguish "still loading" from "this link points at a source that no
  // longer exists" instead of rendering a detail page full of blanks.
  const pendingVendor = currentViewState.selectedVendor;
  const resolvedVendor = pendingVendor ? db.find(v => v.id === pendingVendor.id) ?? null : null;
  const isVendorStub = !!pendingVendor && !pendingVendor.name;
  const selectedVendor = pendingVendor
    ? (resolvedVendor ?? (isVendorStub ? null : pendingVendor))
    : null;
  const vendorLinkPending = !!pendingVendor && !resolvedVendor && isVendorStub;

  // Once the dataset arrives, replace the id-only stub on the stack with the
  // real record so the breadcrumb shows the source name instead of a placeholder.
  useEffect(() => {
    if (!isVendorStub || !resolvedVendor) return;
    setViewHistory(prev => {
      const last = prev[prev.length - 1];
      if (!last?.selectedVendor || last.selectedVendor.id !== resolvedVendor.id || last.selectedVendor.name) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...last, selectedVendor: resolvedVendor, expandedMaterial: last.expandedMaterial ?? resolvedVendor.materialEn ?? null };
      return next;
    });
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
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
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
      if (isFirst) {
        window.history.replaceState(null, '', hash);
      } else {
        window.history.pushState(null, '', hash);
        pushedEntriesRef.current += 1;
      }
    } catch { /* history is unavailable (e.g. sandboxed); URL sync is optional */ }
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
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  /**
   * Whether the toast is reporting a failure.
   *
   * The toast used to infer this from a keyword regex over the message, which
   * is a guess: "عدم دسترسی: … اجازهٔ انجام این عملیات را نمی‌دهد" matched none
   * of the words, so a refused save was announced with a green check. Callers
   * that know say so; the regex stays as the fallback for the rest.
   */
  const [toastKind, setToastKind] = useState<'success' | 'error' | null>(null);
  /**
   * An optional button on the toast.
   *
   * Saving no longer moves the user somewhere else, so the way to reach the
   * record just created is offered rather than imposed: whoever wants the new
   * source's page clicks once, and whoever is entering a stack of records from
   * an old file is left where they are. Without this the rule "saving never
   * changes the page" would simply cost that first person a navigation.
   */
  const [toastAction, setToastAction] = useState<{ label: string; run: () => void } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  /** Show a toast and, when the caller knows, say which kind it is. */
  const notify = (
    message: string,
    kind: 'success' | 'error' = 'success',
    ms = kind === 'error' ? 6000 : 3000,
    action?: { label: string; run: () => void } | null,
  ) => {
    // A toast carrying a button stays long enough to be pressed; the previous
    // timer is cleared so a second toast cannot dismiss the first one early.
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToastKind(kind);
    setToastMsg(message);
    setToastAction(action ?? null);
    const life = action ? Math.max(ms, 7000) : ms;
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
      setToastKind(null);
      setToastAction(null);
    }, life);
  };
  const [isSyncing, setIsSyncing] = useState(true);
  /** True while the business-partner list is being fetched. */
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // In local/demo mode the backend is intentionally absent — never show the
  // "connection failed" banner (the mount fetch runs before demo login is set).
  useEffect(() => { if (isLocalMode()) setLoadError(null); }, [currentUser]);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Session facts for the user menu. The remaining time is recomputed each time
  // the menu opens rather than ticking, since it is a coarse label.
  const [myActivity, setMyActivity] = useState<any[] | null>(null);
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
      .then(j => { if (!cancelled) setMyActivity(Array.isArray(j?.data) ? j.data : []); })
      .catch(() => { if (!cancelled) setMyActivity([]); });
    return () => { cancelled = true; };
  }, [showUserMenu, currentUser]);
  const { isDark, toggleTheme } = useTheme();
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
    return db
      .filter(v => !!v.ircExpiryDate && v.ircExpiryDate.trim() !== '' && v.ircExpiryDate.trim().toLowerCase() !== 'n/a')
      .map(v => ({
        vendor: v,
        check: checkLicenseExpiry(v.ircExpiryDate)
      }))
      .filter(item => item.check.status === 'expiring_soon' || item.check.status === 'expired')
      .sort((a, b) => (a.check.daysLeft || 0) - (b.check.daysLeft || 0));
  }, [db]);

  // Critical audit events (local mode reads the client store; harmless 0 otherwise).
  const criticalAuditCount = useMemo(() => {
    if (!isLocalMode()) return 0;
    try { return readLocalAudit().filter((l: any) => l.severity === 'Critical').length; } catch { return 0; }
  }, [db, businessPartners, materials]);

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
      setViewHistory(prev => {
        if (newView === 'home') {
          return [{ view: 'home', categoryId: null, selectedVendor: null }];
        }
        // Top-level navigation behaves like switching tabs, not drilling down:
        // if this destination is already on the stack, unwind back to it instead
        // of pushing a duplicate (which previously made "back" re-enter a source
        // detail the user had deliberately left).
        const existing = prev.map((s, i) => ({ s, i }))
          .filter(({ s }) => s.view === newView && s.categoryId === newCat
            && (s.taskKey ?? null) === taskKey && s.selectedVendor === null)
          .pop();
        if (existing) {
          return prev.slice(0, existing.i + 1);
        }
        return capHistory([...prev, { view: newView, categoryId: newCat, selectedVendor: null, taskKey }]);
      });
      setSidebarOpen(false);
    });
  };

  const handleSelectVendor = (vendor: Vendor | null) => {
    if (vendor) {
      runGuarded(() => {
        setViewHistory(prev => {
          const last = prev[prev.length - 1];
          if (last && last.selectedVendor?.id === vendor.id && !last.formMode) {
            return prev;
          }
          // Mark the material as expanded on the underlying list entry so that
          // returning (goBack) restores the same expanded material, then push
          // the vendor-detail entry on top (carrying the same marker).
          // A detail page is never a form page, so drop formMode — otherwise
          // saving a new source (which lands on its record) would inherit
          // 'create' and render the form again.
          const base = { ...last, formMode: null, selectedVendor: null, expandedMaterial: vendor.materialEn || last?.expandedMaterial || null };
          // Arriving from the form page means that page is finished: the record
          // replaces it, so Back goes to the list rather than back into the form.
          const head = last?.formMode ? prev.slice(0, -1) : [...prev.slice(0, -1), base];
          return capHistory([...head, { ...base, selectedVendor: vendor }]);
        });
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
      else setViewHistory(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
    });
  };

  // The source form is a page of its own: pushing it onto the stack gives it a
  // URL, a breadcrumb and a working Back button for free, and keeps its own
  // "new partner" dialog from becoming a modal inside a modal.
  const openSourceForm = (mode: 'create' | 'edit', cat?: Category | null) => {
    runGuarded(() => {
      setViewHistory(prev => {
        const last = prev[prev.length - 1];
        if (last?.formMode === mode) return prev;
        const base = mode === 'edit'
          ? last
          : { ...last, view: 'category' as const, categoryId: cat ?? last?.categoryId ?? 'domestic', selectedVendor: null };
        return capHistory([...prev, { ...base, formMode: mode }]);
      });
      setSidebarOpen(false);
    });
  };

  // Leaving the form page after a successful save must land somewhere definite,
  // so it pops the form entry from the stack rather than asking the browser to
  // go "back" — the entry behind it is not guaranteed to be the list.
  const closeSourceForm = () => {
    setViewHistory(prev => (prev[prev.length - 1]?.formMode ? prev.slice(0, -1) : prev));
  };

  // Jump directly to a given depth of the navigation stack (breadcrumb click).
  const goToHistoryIndex = (index: number) => {
    const steps = viewHistory.length - 1 - index;
    if (index < 0 || steps <= 0) return;
    runGuarded(() => {
      if (canPopBrowserRef.current) window.history.go(-steps);
      else setViewHistory(prev => prev.slice(0, index + 1));
    });
  };

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

  const updateCurrentVendorInHistory = (vendor: Vendor | null) => {
    setViewHistory(prev => {
      const newHistory = [...prev];
      if (newHistory.length > 0) {
        newHistory[newHistory.length - 1] = { ...newHistory[newHistory.length - 1], selectedVendor: vendor };
      }
      return newHistory;
    });
  };

  const handleDownloadBackup = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      
      const dateStr = new Date().toLocaleDateString('fa-IR').replace(/\//g, '-');
      downloadAnchor.setAttribute("download", `vendor-scores-backup-${dateStr}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      
      setToastMsg('بانک اطلاعاتی لوکال با موفقیت دانلود شد!');
      setTimeout(() => setToastMsg(null), 3000);
    } catch (err) {
      console.error("Failed to download backup JSON:", err);
      setToastMsg('خطا در پشتیبان‌گیری از اطلاعات.');
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  const handleUpdateVendor = (updatedVendor: Vendor, msg?: string | null) => {
    const normalized = normalizeAndCleanVendor(updatedVendor);
    const original = db.find(v => v.id === normalized.id);

    setDb(db.map(v => v.id === normalized.id ? normalized : v));
    updateCurrentVendorInHistory(normalized);
    if (msg !== null) {
      setToastMsg(msg || 'تغییرات با موفقیت ذخیره شد!');
      setTimeout(() => setToastMsg(null), 3000);
    }

    if (isLocalMode()) {
      const isSource = !!(normalized.isSample || normalized.category === 'sample');
      const wasRejected = original ? isVendorRejected(original) : false;
      const nowRejected = isVendorRejected(normalized);
      const rejected = nowRejected && !wasRejected;
      const restored = wasRejected && !nowRejected;
      appendLocalAudit({
        user: currentUser?.name, role: currentUser?.role,
        module: isSource ? 'Source Management' : 'Supplier Management',
        action: original ? 'Update' : 'Create',
        entityType: isSource ? 'Source' : 'Supplier',
        entityName: normalized.material || normalized.name || 'سورس',
        severity: rejected || restored ? 'Critical' : original ? 'Warning' : 'Info',
        description: `${original ? 'ویرایش' : 'ثبت'} "${normalized.name || normalized.material}"${rejected ? ' — انتقال به لیست سیاه' : restored ? ' — خروج از لیست سیاه (علت رد برطرف شد)' : ''}`,
        before: original || null, after: normalized,
        reason: (normalized as any).reasonForChange || 'به‌روزرسانی رکورد',
      });
    }

    if (!original) {
      // Fallback to traditional monolithic POST if there is no previous record found to diff safely
      authFetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized)
      }).catch(err => {
        console.error("Failed to sync updated vendor to DB:", err);
      });
      return;
    }

    // Determine fine-grained delta adjustments for API Splitting
    const contactChanged = original.contactInfo !== normalized.contactInfo || original.lastAudit !== normalized.lastAudit || original.ircExpiryDate !== normalized.ircExpiryDate;
    const scoresChanged = JSON.stringify(original.scores) !== JSON.stringify(normalized.scores) || 
                          JSON.stringify(original.rawScores) !== JSON.stringify(normalized.rawScores) || 
                          JSON.stringify(original.rejectionReasons) !== JSON.stringify(normalized.rejectionReasons);
    const logsChanged = JSON.stringify(original.activityLogs) !== JSON.stringify(normalized.activityLogs);
    const analysisChanged = JSON.stringify(original.analysisRecords) !== JSON.stringify(normalized.analysisRecords);
    const riskChanged = JSON.stringify(original.riskAssessment) !== JSON.stringify(normalized.riskAssessment);
    
    const profileChanged = original.material !== normalized.material ||
                           original.materialEn !== normalized.materialEn ||
                           original.cas !== normalized.cas ||
                           original.irc !== normalized.irc ||
                           original.ircExpiryDate !== normalized.ircExpiryDate ||
                           original.name !== normalized.name ||
                           original.nameEn !== normalized.nameEn ||
                           original.country !== normalized.country ||
                           original.grade !== normalized.grade ||
                           original.status !== normalized.status ||
                           original.isSample !== normalized.isSample ||
                           original.initialSampleStatus !== normalized.initialSampleStatus;

    // Dispatch precision requests based on modified data blocks.
    // These MUST run one after another: every endpoint does a full
    // read-modify-write of the vendor, so two in flight at once means the
    // slower one writes back its stale copy of the other's data — which is how
    // a deleted lab result used to reappear after a reload.
    const syncQueue: Array<() => Promise<unknown>> = [];

    if (profileChanged) {
      syncQueue.push(() => authFetch(`/api/vendors/${normalized.id}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          material: normalized.material,
          materialEn: normalized.materialEn,
          cas: normalized.cas,
          irc: normalized.irc,
          ircExpiryDate: normalized.ircExpiryDate,
          name: normalized.name,
          nameEn: normalized.nameEn,
          country: normalized.country,
          grade: normalized.grade,
          status: normalized.status,
          isSample: normalized.isSample,
          initialSampleStatus: normalized.initialSampleStatus,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Profile sync failed:", err)));
    }

    if (contactChanged) {
      syncQueue.push(() => authFetch(`/api/vendors/${normalized.id}/contact`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactInfo: normalized.contactInfo,
          lastAudit: normalized.lastAudit,
          ircExpiryDate: normalized.ircExpiryDate,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Contact sync failed:", err)));
    }

    if (scoresChanged) {
      syncQueue.push(() => authFetch(`/api/vendors/${normalized.id}/scores`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scores: normalized.scores,
          rawScores: normalized.rawScores,
          rejectionReasons: normalized.rejectionReasons,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Scores sync failed:", err)));
    }

    if (analysisChanged) {
      syncQueue.push(() => authFetch(`/api/vendors/${normalized.id}/analysis`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisRecords: normalized.analysisRecords,
          activityLogs: normalized.activityLogs,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Analysis sync failed:", err)));
    } else if (logsChanged) {
      syncQueue.push(() => authFetch(`/api/vendors/${normalized.id}/logs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityLogs: normalized.activityLogs,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Logs sync failed:", err)));
    }

    if (riskChanged) {
      syncQueue.push(() => authFetch(`/api/vendors/${normalized.id}/risk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          riskAssessment: normalized.riskAssessment,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Risk sync failed:", err)));
    }

    void (async () => {
      for (const send of syncQueue) {
        await send();
      }
    })();
  };

  const handleDeleteVendor = (vendorId: string, reasonForChange?: string) => {
    const removed = db.find(v => v.id === vendorId);
    setDb(db.filter(v => v.id !== vendorId));
    handleSelectVendor(null);
    setToastMsg('سورس با موفقیت حذف شد!');
    setTimeout(() => setToastMsg(null), 3000);
    if (isLocalMode()) {
      const isSource = !!(removed?.isSample || removed?.category === 'sample');
      appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: isSource ? 'Source Management' : 'Supplier Management', action: 'Delete', entityType: isSource ? 'Source' : 'Supplier', entityName: removed?.material || removed?.name || 'سورس', severity: 'Critical', description: `حذف "${removed?.name || removed?.material || vendorId}"`, before: removed || null, after: null, reason: reasonForChange || 'حذف رکورد' });
    }
    authFetch(`/api/vendors/${vendorId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reasonForChange })
    }).catch(err => {
      console.error("Failed to sync vendor deletion to DB:", err);
    });
  };

  /**
   * Register a new source.
   *
   * Saving deliberately does not move the user: this used to end by opening the
   * new record's page, which suits someone registering one source in order to
   * score it straight away, and works against someone transcribing a stack of
   * them from an old file — every save landed them on a page they had to leave
   * again. The record is offered on the toast instead, so reaching it is one
   * click for whoever wants it and none for whoever does not.
   */
  const handleAddVendor = (newVendor: Vendor) => {
    const normalized = normalizeAndCleanVendor(newVendor);
    setDb([normalized, ...db]);
    notify(
      `سورس «${normalized.name || normalized.material || 'جدید'}» ثبت شد.`,
      'success',
      3000,
      { label: 'مشاهده و امتیازدهی', run: () => handleSelectVendor(normalized) },
    );
    if (isLocalMode()) {
      const isSource = !!(normalized.isSample || normalized.category === 'sample');
      appendLocalAudit({
        user: currentUser?.name, role: currentUser?.role,
        module: isSource ? 'Source Management' : 'Supplier Management',
        action: 'Create', entityType: isSource ? 'Source' : 'Supplier',
        entityName: normalized.material || normalized.name || 'سورس', severity: 'Info',
        description: `ثبت سورس جدید "${normalized.name || normalized.material}"`,
        before: null, after: normalized, reason: 'ثبت سورس جدید',
      });
    }
    authFetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized)
    }).catch(err => {
      console.error("Failed to sync new vendor to DB:", err);
    });
  };

  // Material changes are persisted and audited server-side (module "مدیریت مواد"),
  // so the client only does an optimistic update and syncs to the API.
  const handleAddMaterial = (newMaterial: Material) => {
    setMaterials([newMaterial, ...materials]);
    setToastMsg('ماده اولیه جدید با موفقیت اضافه شد!');
    setTimeout(() => setToastMsg(null), 3000);
    if (isLocalMode()) appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'مدیریت مواد', action: 'Create', entityType: 'Material', entityName: (newMaterial as any).nameFa || (newMaterial as any).name || 'ماده', severity: 'Info', description: `ثبت مادهٔ اولیهٔ جدید "${(newMaterial as any).nameFa || (newMaterial as any).name || ''}"`, before: null, after: newMaterial, reason: 'ثبت ماده جدید' });
    authFetch('/api/materials', { method: 'POST', body: JSON.stringify(newMaterial) })
      .then(async res => { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'خطا در ثبت ماده'); })
      .catch(err => {
        setMaterials(prev => prev.filter(m => m.id !== newMaterial.id));
        setToastMsg(err.message || 'ثبت ماده در سرور ناموفق بود.');
        setTimeout(() => setToastMsg(null), 5000);
      });
  };

  const handleEditMaterial = (updatedMaterial: Material, customAction?: string) => {
    const oldMaterial = materials.find(m => m.id === updatedMaterial.id);
    setMaterials(materials.map(m => m.id === updatedMaterial.id ? updatedMaterial : m));
    setToastMsg('اطلاعات ماده اولیه با موفقیت به‌روزرسانی شد!');
    setTimeout(() => setToastMsg(null), 3000);
    if (isLocalMode()) appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'مدیریت مواد', action: 'Update', entityType: 'Material', entityName: (updatedMaterial as any).nameFa || (updatedMaterial as any).name || 'ماده', severity: 'Warning', description: customAction || `ویرایش مادهٔ اولیه "${(updatedMaterial as any).nameFa || (updatedMaterial as any).name || ''}"`, before: oldMaterial || null, after: updatedMaterial, reason: 'ویرایش ماده' });
    authFetch(`/api/materials/${updatedMaterial.id}`, { method: 'PATCH', body: JSON.stringify(updatedMaterial) })
      .then(async res => { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'خطا در ویرایش ماده'); })
      .catch(err => {
        if (oldMaterial) setMaterials(prev => prev.map(m => m.id === updatedMaterial.id ? oldMaterial : m));
        setToastMsg(err.message || 'ویرایش ماده در سرور ناموفق بود.');
        setTimeout(() => setToastMsg(null), 5000);
      });
  };

  const handleDeleteMaterial = async (id: string) => {
    const snapshot = materials;
    const removed = materials.find(m => m.id === id);
    setMaterials(materials.filter(m => m.id !== id));
    if (isLocalMode()) {
      appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'مدیریت مواد', action: 'Delete', entityType: 'Material', entityName: (removed as any)?.nameFa || (removed as any)?.name || 'ماده', severity: 'Critical', description: `حذف مادهٔ اولیه "${(removed as any)?.nameFa || (removed as any)?.name || ''}"`, before: removed || null, after: null, reason: 'حذف ماده' });
      setToastMsg('ماده اولیه با موفقیت حذف شد!');
      setTimeout(() => setToastMsg(null), 3000);
      return;
    }
    try {
      const response = await authFetch(`/api/materials/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'خطا در حذف');
      }
      setToastMsg('ماده اولیه با موفقیت حذف شد!');
      setTimeout(() => setToastMsg(null), 3000);
    } catch (err: any) {
      setMaterials(snapshot);
      setToastMsg(err.message || 'حذف ماده در سرور ناموفق بود.');
      setTimeout(() => setToastMsg(null), 5000);
    }
  };

  // Business-partner changes are audited server-side (authoritative, in the
  // Business Partner Repository module), so the client no longer posts its own
  // audit records — that would double-log every change.

  /**
   * Why a rejected save must be surfaced, not logged.
   *
   * Both handlers used to end in `.catch(err => console.error(...))` and never
   * looked at `res.ok`. A 403 (no permission), a 400 (validation) or a 413 (an
   * evaluation whose attached documents exceed the body limit) therefore left
   * the user with a green "saved successfully" toast, the change alive in
   * memory, and nothing on the server — until the next reload silently took it
   * away. For a supplier evaluation in a GxP system that is the worst possible
   * failure mode, so a rejected write now rolls the optimistic update back and
   * says what happened.
   */
  const describePartnerFailure = async (res: Response, fallback: string) => {
    const body = await res.json().catch(() => ({} as any));
    if (body?.error) return body.error as string;
    if (res.status === 413) return 'حجم مدارک پیوست بیش از حد مجاز سرور است. فایل‌های کوچک‌تری بارگذاری کنید.';
    if (res.status === 403) return 'دسترسی لازم برای این تغییر را ندارید.';
    return fallback;
  };

  const handleAddBusinessPartner = (newPartner: BusinessPartner) => {
    const snapshot = businessPartners;
    setBusinessPartners([newPartner, ...businessPartners]);
    if (isLocalMode()) appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'Business Partner Repository', action: 'Create', entityType: 'BusinessPartner', entityName: newPartner.name, severity: 'Info', description: `ثبت شریک تجاری جدید "${newPartner.name}" (${newPartner.type})`, before: null, after: newPartner, reason: 'ثبت شریک تجاری' });
    if (isLocalMode()) {
      setToastMsg(`شریک تجاری "${newPartner.name}" با موفقیت اضافه شد!`);
      setTimeout(() => setToastMsg(null), 3000);
      return;
    }
    authFetch('/api/business-partners', {
      method: 'POST',
      body: JSON.stringify(newPartner)
    })
      .then(async res => {
        if (!res.ok) throw new Error(await describePartnerFailure(res, 'ثبت شریک تجاری در سرور ناموفق بود.'));
        notify(`شریک تجاری "${newPartner.name}" با موفقیت اضافه شد!`);
      })
      .catch(err => {
        setBusinessPartners(snapshot);
        notify(err.message || 'ثبت شریک تجاری در سرور ناموفق بود.', 'error');
      });
  };

  const handleEditBusinessPartner = (updatedPartner: BusinessPartner) => {
    const snapshot = businessPartners;
    const oldPartner = businessPartners.find(p => p.id === updatedPartner.id);
    setBusinessPartners(businessPartners.map(p => p.id === updatedPartner.id ? updatedPartner : p));
    if (isLocalMode()) appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'Business Partner Repository', action: 'Update', entityType: 'BusinessPartner', entityName: updatedPartner.name, severity: 'Warning', description: `ویرایش شریک تجاری "${updatedPartner.name}"`, before: oldPartner || null, after: updatedPartner, reason: 'ویرایش شریک تجاری' });
    if (isLocalMode()) {
      setToastMsg(`اطلاعات شریک تجاری "${updatedPartner.name}" با موفقیت به‌روزرسانی شد!`);
      setTimeout(() => setToastMsg(null), 3000);
      return;
    }
    authFetch(`/api/business-partners/${updatedPartner.id}`, {
      method: 'PUT',
      body: JSON.stringify(updatedPartner)
    })
      .then(async res => {
        if (!res.ok) throw new Error(await describePartnerFailure(res, 'ذخیرهٔ تغییرات شریک تجاری در سرور ناموفق بود.'));
        notify(`اطلاعات شریک تجاری "${updatedPartner.name}" با موفقیت به‌روزرسانی شد!`);
      })
      .catch(err => {
        setBusinessPartners(snapshot);
        notify(err.message || 'ذخیرهٔ تغییرات شریک تجاری در سرور ناموفق بود.', 'error');
      });
  };

  const handleDeleteBusinessPartner = (id: string) => {
    const partner = businessPartners.find(p => p.id === id);
    if (!partner) return;

    // The server enforces referential integrity and audits both the blocked
    // attempt and the successful delete; revert optimistically on rejection.
    const snapshot = businessPartners;
    setBusinessPartners(businessPartners.filter(p => p.id !== id));
    if (isLocalMode()) {
      appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'Business Partner Repository', action: 'Delete', entityType: 'BusinessPartner', entityName: partner.name, severity: 'Critical', description: `حذف شریک تجاری "${partner.name}"`, before: partner, after: null, reason: 'حذف شریک تجاری' });
      setToastMsg('شریک تجاری با موفقیت حذف شد!');
      setTimeout(() => setToastMsg(null), 3000);
      return;
    }
    authFetch(`/api/business-partners/${id}`, { method: 'DELETE' })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'حذف شریک تجاری در سرور ناموفق بود.');
        }
        setToastMsg('شریک تجاری با موفقیت حذف شد!');
        setTimeout(() => setToastMsg(null), 3000);
      })
      .catch(err => {
        setBusinessPartners(snapshot);
        notify(err.message || 'حذف شریک تجاری در سرور ناموفق بود.', 'error');
      });
  };

  // Views Content
  const renderContent = () => {
    let content;
    let keyName = '';

    // Every page built from the source list shows the same refusal, so it is
    // written once here rather than repeated at each branch.
    const DENY_SOURCES = (
      <AccessDenied
        title="عدم دسترسی به اطلاعات سورس‌ها"
        detail="حساب کاربری شما مجوز مشاهدهٔ سورس‌ها و تأمین‌کنندگان را ندارد."
        onHome={() => navigate('home')}
      />
    );

    if (formMode) {
      // The source form as a full page: it is the longest form in the app and
      // opens dialogs of its own, so it gets the content area rather than an
      // overlay.
      const editing = formMode === 'edit' ? selectedVendor ?? undefined : undefined;
      keyName = `source-form-${formMode}-${editing?.id ?? categoryId ?? 'new'}`;
      content = (
        <VendorForm
          db={db}
          materials={materials}
          onAddMaterial={handleAddMaterial}
          categoryId={(editing?.category as Category) || (categoryId as Category) || 'domestic'}
          existingVendor={editing}
          onClose={goBack}
          onSaved={closeSourceForm}
          onSave={(v, msg) => { editing ? handleUpdateVendor(v, msg) : handleAddVendor(v); }}
          currentUser={currentUser}
          partners={businessPartners}
          onAddPartner={handleAddBusinessPartner}
          registerNavGuard={registerNavGuard}
        />
      );
    } else if (vendorLinkPending) {
      // Deep link into a source: wait for the dataset, then report honestly if
      // the id is not in it.
      const stillLoading = isSyncing || db.length === 0;
      keyName = `vendor-pending-${pendingVendor!.id}`;
      content = stillLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground" dir="rtl">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <p className="text-xs font-semibold">در حال بازیابی اطلاعات سورس…</p>
        </div>
      ) : (
        <div className="p-8 max-w-xl mx-auto my-12 bg-card border border-border rounded-2xl text-center space-y-4 shadow-sm" dir="rtl">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-black text-foreground">سورس مورد نظر یافت نشد</h2>
          <p className="text-xs text-muted-foreground leading-relaxed font-medium">
            لینکی که باز کرده‌اید به سورسی با شناسهٔ <span className="font-mono text-foreground">{pendingVendor!.id}</span> اشاره می‌کند که دیگر در سامانه وجود ندارد (احتمالاً حذف شده است).
          </p>
          <button
            onClick={() => navigate('home')}
            className="px-4 py-2 bg-primary hover:opacity-90 text-white rounded-xl text-xs font-bold transition-opacity cursor-pointer"
          >
            بازگشت به صفحه اصلی
          </button>
        </div>
      );
    } else if (selectedVendor) {
      keyName = `vendor-${selectedVendor.id}`;
      content = <VendorDetail db={db} vendor={selectedVendor} onBack={goBack} onSave={handleUpdateVendor} onDelete={handleDeleteVendor} currentUser={currentUser} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} registerNavGuard={registerNavGuard} onEditVendor={() => openSourceForm('edit')} />;
    } else if (view === 'home') {
      keyName = 'home';
      content = <HomeView db={db} onNavigate={navigate} onSelectVendor={handleSelectVendor} onAddVendor={handleAddVendor} currentUser={currentUser} onDownloadBackup={handleDownloadBackup} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} onOpenSourceForm={() => openSourceForm('create')} />;
    } else if (view === 'archive') {
      // The archive is a view over the source data, so it follows `vendor.read`
      // — the permission the endpoint behind it enforces. (It used to check a
      // separate `archive.read`, which no endpoint enforced; that name was
      // retired rather than renamed — see LEGACY_PERMISSIONS.)
      keyName = 'archive';
      content = !can(currentUser, 'vendor.read') ? DENY_SOURCES : (
        <ArchiveView db={db} currentUser={currentUser} partners={businessPartners} materials={materials} />
      );
    } else if (view === 'tasks') {
      const taskKey = (currentViewState.taskKey || 'eval') as TaskKey;
      keyName = `tasks-${taskKey}`;
      content = !can(currentUser, 'vendor.read') ? DENY_SOURCES : (
        <WorklistView
          taskKey={taskKey}
          db={db}
          partners={businessPartners}
          currentUser={currentUser}
          onSelectVendor={handleSelectVendor}
          onNavigate={v => navigate(v as any)}
          onSwitchTask={k => navigate('tasks', null, k)}
        />
      );
    } else if (view === 'supplier-audit') {
      keyName = 'supplier-audit';
      content = !can(currentUser, 'vendor.read') ? DENY_SOURCES : <SupplierAuditView db={db} onSelectVendor={handleSelectVendor} currentUser={currentUser} partners={businessPartners} materials={materials} onNavigate={v => navigate(v as any)} />;
    } else if (view === 'materials') {
      keyName = 'materials';
      content = !can(currentUser, 'material.read') ? (
        <AccessDenied
          title="عدم دسترسی به مخزن مواد اولیه"
          detail="حساب کاربری شما مجوز مشاهدهٔ مخزن مواد اولیه را ندارد."
          onHome={() => navigate('home')}
        />
      ) : (
        <MaterialRepositoryView 
          materials={materials}
          onAddMaterial={handleAddMaterial}
          onEditMaterial={handleEditMaterial}
          onDeleteMaterial={handleDeleteMaterial}
          currentUser={currentUser}
          db={db}
          isLoading={isSyncing && materials.length === 0}
        />
      );
    } else if (view === 'business-partners') {
      keyName = 'business-partners';
      content = !can(currentUser, 'partner.read') ? (
        <AccessDenied
          title="عدم دسترسی به مخزن شرکای تجاری"
          detail="حساب کاربری شما مجوز مشاهدهٔ شرکای تجاری و ارزیابی فروشندگان را ندارد."
          onHome={() => navigate('home')}
        />
      ) : (
        <BusinessPartnerRepositoryView
          partners={businessPartners}
          onAddPartner={handleAddBusinessPartner}
          onEditPartner={handleEditBusinessPartner}
          onDeletePartner={handleDeleteBusinessPartner}
          currentUser={currentUser}
          db={db}
          // Not `&& length === 0`: with no cache the list falls back to the
          // bundled INITIAL_BUSINESS_PARTNERS_DB seed, so it is never empty and
          // the skeleton could never appear — the seed was being shown as if it
          // were the server's data while the real fetch was still in flight.
          isLoading={partnersLoading}
        />
      );
    } else if (view === 'audit-trail') {

      if (can(currentUser, 'audit.read')) {
        keyName = 'audit-trail';
        content = <AuditTrailView />;
      } else {
        keyName = 'audit-denied';
        content = (
          <div className="p-8 max-w-xl mx-auto my-12 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-4 shadow-sm" style={{ direction: 'rtl' }}>
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h2 className="text-base font-black text-rose-900">عدم دسترسی به ماژول Audit Trail</h2>
            <p className="text-xs text-rose-700 leading-relaxed font-medium">
              مشاهده ردیابی تغییرات، لاگ‌های امنیتی و فعالیت‌های کاربران طبق سیاست‌های امنیتی و GMP تنها در انحصار مدیران ارشد سیستم (Administrator) می‌باشد.
            </p>
            <button
              onClick={() => navigate('home')}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              بازگشت به صفحه اصلی
            </button>
          </div>
        );
      }
    } else if (view === 'users') {
      if (can(currentUser, 'users.manage')) {
        keyName = 'users';
        content = <UsersView currentUser={currentUser} />;
      } else {
        keyName = 'users-denied';
        content = (
          <AccessDenied
            title="عدم دسترسی به مدیریت کاربران"
            detail="تعریف و تغییر دسترسی پرسنل تنها در اختیار دارندگان مجوز «مدیریت کاربران» است."
            onHome={() => navigate('home')}
          />
        );
      }
    } else if (view === 'category' && categoryId) {
      keyName = `category-${categoryId}`;
      content = !can(currentUser, 'vendor.read') ? DENY_SOURCES : <CategoryView db={db} isLoading={isSyncing && db.length === 0} categoryId={categoryId} onSelectVendor={handleSelectVendor} currentUser={currentUser} expandedMaterial={expandedMaterial} onToggleMaterial={setExpandedMaterial} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} />;
    } else {
      keyName = 'home-fallback';
      content = <HomeView db={db} onNavigate={navigate} onSelectVendor={handleSelectVendor} onAddVendor={handleAddVendor} currentUser={currentUser} onDownloadBackup={handleDownloadBackup} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} onOpenSourceForm={() => openSourceForm('create')} />;
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
          {content}
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

      <div dir="rtl" className="min-h-screen bg-background text-foreground flex overflow-hidden print:overflow-visible print:bg-white print:text-black print:block">
        
        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div 
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-20 md:hidden fade-in-fast" 
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* LEFT PANEL: Fixed Sidebar */}
        <aside className={`
          fixed top-0 bottom-0 right-0 z-30 w-[272px] ${sidebarCollapsed ? 'md:w-[76px]' : 'md:w-[272px]'} bg-card/95 backdrop-blur-md border-l border-border/80
          transform transition-all duration-300 ease-in-out md:translate-x-0 slide-in print:hidden
          ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'}
          flex flex-col shadow-xs
        `}>
          {/* BRAND BLOCK — the Persian name is the name of the system; the
              English one is a subtitle. It used to be the other way round: a
              three-line English headline at 14px above a 10px Persian line in
              a mono face, in an application whose entire interface is Persian. */}
          <div className={`py-3.5 border-b border-border/80 flex items-center ${sidebarCollapsed ? 'md:justify-center md:px-2 px-5 justify-between' : 'px-5 justify-between'}`}>
            <div className="flex items-center gap-3 min-w-0">
              {/* Dark navy mark on a dark card is all but invisible, so it gets
                  a light plate in dark mode — same fix as the login screen. */}
              <span className="flex items-center justify-center shrink-0 dark:bg-white dark:rounded-lg dark:p-1">
                <img src={temadLogo} alt="تماد" className="h-10 w-auto object-contain" />
              </span>
              <div className={`flex-col justify-center text-right min-w-0 ${sidebarCollapsed ? 'flex md:hidden' : 'flex'}`}>
                <span className="font-extrabold text-foreground text-sm leading-tight tracking-tight">سامانهٔ ارزیابی تامین‌کنندگان</span>
                <span className="text-muted-foreground text-[10px] mt-0.5 tracking-tight truncate" dir="ltr">VLSE</span>
              </div>
            </div>
            <button
              className="md:hidden text-muted-foreground hover:text-foreground p-1 rounded-lg"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </button>
            {/* Desktop collapse toggle */}
            <button
              className={`hidden md:flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent border border-border transition-all ${sidebarCollapsed ? 'md:hidden' : ''}`}
              onClick={() => setSidebarCollapsed(true)}
              title="جمع کردن نوار کناری"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Collapsed: search + expand controls */}
          {sidebarCollapsed && (
            <div className="hidden md:flex flex-col items-center gap-1.5 py-2 border-b border-border/80">
              <button onClick={() => setShowCommandPalette(true)} title="جستجو (⌘K)" className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent border border-border">
                <Search className="w-4 h-4" />
              </button>
              <button onClick={() => setSidebarCollapsed(false)} title="باز کردن نوار کناری" className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent border border-border">
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Expanded: quick search launcher */}
          {!sidebarCollapsed && (
            <div className="px-3 pt-3">
              <button
                onClick={() => setShowCommandPalette(true)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-border bg-muted/40 hover:bg-accent text-muted-foreground transition-colors text-xs"
              >
                <span className="flex items-center gap-2"><Search className="w-3.5 h-3.5" /> جستجوی سریع...</span>
                <kbd className="font-mono text-[10px] bg-background border border-border rounded px-1.5 py-0.5">⌘K</kbd>
              </button>
            </div>
          )}

          <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
            <SidebarButton collapsed={sidebarCollapsed}
              icon={Home} label="صفحه اصلی" 
              variant="home"
              active={view === 'home' && !selectedVendor} 
              onClick={() => navigate('home')} 
            />

            {can(currentUser, 'vendor.read') && (
            <div className={`pt-3 pb-1 px-3 text-[11px] font-bold text-muted-foreground/80 flex items-center ${sidebarCollapsed ? 'md:hidden' : ''}`}>
              <span>دسته‌بندی‌ها</span>
            </div>
            )}
            {can(currentUser, 'vendor.read') && (Object.entries(categoryLabels) as [Category, any][]).map(([id, meta]) => {
              const count = db.filter(v =>
                id === 'sample' ? (v.category === 'sample' || v.isSample) :
                id === 'blacklist' ? isInBlacklistCategory(v) :
                (v.category === id && v.status !== 'rejected' && v.grade !== 'rejected')
              ).length;
              return (
                <SidebarButton collapsed={sidebarCollapsed}
                  key={id}
                  variant={id}
                  badge={count}
                  icon={meta.icon} label={meta.fa}
                  active={view === 'category' && categoryId === id} 
                  onClick={() => navigate('category', id)} 
                />
              );
            })}

            <div className={`pt-3 pb-1 px-3 text-[11px] font-bold text-muted-foreground/80 flex items-center ${sidebarCollapsed ? 'md:hidden' : ''}`}>
              <span>مدیریت پایگاه داده</span>
            </div>
            {can(currentUser, 'partner.read') && (
              <SidebarButton collapsed={sidebarCollapsed}
                icon={Building2} label="مخزن شرکای تجاری"
                badge={businessPartners?.length || 0}
                variant="business-partners"
                active={view === 'business-partners'}
                onClick={() => navigate('business-partners')}
              />
            )}
            {can(currentUser, 'material.read') && (
              <SidebarButton collapsed={sidebarCollapsed}
                icon={Database} label="مخزن مواد اولیه"
                badge={materials?.length || 0}
                variant="materials"
                active={view === 'materials'}
                onClick={() => navigate('materials')}
              />
            )}

            <div className={`pt-3 pb-1 px-3 text-[11px] font-bold text-muted-foreground/80 flex items-center ${sidebarCollapsed ? 'md:hidden' : ''}`}>
              <span>کیفیت و نظارت</span>
            </div>
            {/* Each entry is gated by the permission its page and endpoints
                actually check, not by `role === 'admin'`. A raw role test here
                diverged from the pages themselves: someone holding the
                `users.manage` exception was allowed by the page but never saw
                the link, and the archive was hidden from everyone but admins even
                though nothing restricted it (rule 14: one policy table, both
                sides). */}
            {can(currentUser, 'vendor.read') && (
              <SidebarButton collapsed={sidebarCollapsed}
                icon={Archive} label="آرشیو کامل داده‌ها"
                badge={db.length}
                variant="archive"
                active={view === 'archive'}
                onClick={() => navigate('archive')}
              />
            )}
            {can(currentUser, 'audit.read') && (
              <SidebarButton collapsed={sidebarCollapsed}
                icon={History} label="ردیابی تغییرات"
                alert={criticalAuditCount}
                variant="audit-trail"
                active={view === 'audit-trail'}
                onClick={() => navigate('audit-trail')}
              />
            )}
            {can(currentUser, 'users.manage') && (
              <SidebarButton collapsed={sidebarCollapsed}
                icon={UserCog} label="مدیریت کاربران"
                variant="audit-trail"
                active={view === 'users'}
                onClick={() => navigate('users')}
              />
            )}
            {can(currentUser, 'vendor.read') && (
              <SidebarButton collapsed={sidebarCollapsed}
                icon={Handshake} label="بررسی یکپارچه تامین‌کننده"
                variant="supplier-audit"
                active={view === 'supplier-audit'}
                onClick={() => navigate('supplier-audit')}
              />
            )}
          </nav>

        </aside>

        {/* RIGHT PANEL: Main Content Area */}
        <main className={`flex-1 ${sidebarCollapsed ? 'md:pr-[76px]' : 'md:pr-[272px]'} flex flex-col h-screen overflow-hidden transition-all duration-300 print:h-auto print:overflow-visible print:pr-0 print:block`}>
          
          {/* Sticky Topbar */}
          <header className="sticky top-0 z-10 bg-card/90 backdrop-blur-md border-b border-border/80 px-5 py-3 flex items-center justify-between shrink-0 print:hidden shadow-xs">
            <div className="flex items-center gap-3 sm:gap-4">
              <button 
                className="md:hidden p-2 rounded-xl text-muted-foreground bg-transparent hover:bg-accent hover:text-foreground transition-colors focus:outline-none"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="w-5 h-5" />
              </button>

              {/* Navigation History & Back Handler */}
              <div className="flex items-center gap-2.5 min-w-0">
                {viewHistory.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goBack}
                    className="h-8 gap-1.5 text-xs font-bold text-foreground bg-background hover:bg-accent border-border shrink-0"
                    title={`برگشت به ${getViewStateLabel(viewHistory[viewHistory.length - 2]) || 'مرحله قبل'}`}
                  >
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>برگشت</span>
                  </Button>
                )}

                {/* Breadcrumb trail — shows the full path and allows jumping
                    directly to any earlier level. */}
                {viewHistory.length > 1 && (
                  <nav aria-label="مسیر ناوبری" className="hidden lg:flex items-center gap-1 min-w-0 text-xs">
                    {viewHistory.map((state, idx) => {
                      const label = getViewStateLabel(state);
                      if (!label) return null;
                      const isLast = idx === viewHistory.length - 1;
                      return (
                        <React.Fragment key={idx}>
                          {idx > 0 && <ChevronLeft className="w-3 h-3 text-muted-foreground/50 shrink-0" />}
                          {isLast ? (
                            <EntityName name={label} lines={1} aria-current="page" className="font-bold text-foreground max-w-[180px]" />
                          ) : (
                            <button
                              onClick={() => goToHistoryIndex(idx)}
                              className="font-semibold text-muted-foreground hover:text-primary hover:underline truncate max-w-[130px] transition-colors cursor-pointer"
                              title={`رفتن به ${label}`}
                            >
                              {label}
                            </button>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </nav>
                )}
              </div>

            </div>
            
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Dark / light theme toggle */}
              <button
                onClick={toggleTheme}
                className="relative p-2 rounded-xl border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-all active:scale-95 cursor-pointer"
                title={isDark ? 'روشن کردن حالت روز' : 'فعال‌کردن حالت شب'}
                aria-label="تغییر حالت روز/شب"
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {/* Notification Center for License Expiry */}
              <div className="relative">
                <button
                  onClick={() => setShowNotificationPanel(!showNotificationPanel)}
                  className={`relative p-2 rounded-xl border transition-all active:scale-95 cursor-pointer flex items-center justify-center ${
                    expiringVendors.length > 0
                      ? 'bg-amber-50 hover:bg-amber-100/80 border-amber-300 text-amber-800 dark:bg-amber-950/40 dark:border-amber-700/50 dark:text-amber-300 shadow-xs'
                      : 'bg-background hover:bg-accent border-border text-muted-foreground'
                  }`}
                  title={expiringVendors.length > 0 ? `${expiringVendors.length} مورد هشدار انقضای مجوز` : 'مرکز اعلان‌های سیستم'}
                >
                  <Bell className="w-4 h-4" />
                  {expiringVendors.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 px-1 min-w-[18px] h-[18px] bg-rose-600 text-white text-[10px] font-bold font-mono rounded-full flex items-center justify-center shadow-xs">
                      {expiringVendors.length}
                    </span>
                  )}
                </button>

                {/* Dropdown Popover */}
                {showNotificationPanel && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setShowNotificationPanel(false)} 
                    />
                    <div className="absolute left-0 right-auto mt-2 w-[calc(100vw-2rem)] sm:w-96 max-w-sm sm:max-w-md bg-popover border border-border rounded-2xl shadow-xl z-50 overflow-hidden fade-in text-right font-sans" dir="rtl">
                      <div className="p-3.5 bg-muted/60 border-b border-border flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          <span className="font-bold text-xs text-foreground">مرکز اعلان‌های انقضای مجوز (IRC / IVC)</span>
                        </div>
                        <Badge variant="warning" className="text-[10px] font-mono font-bold">
                          {expiringVendors.length} مورد
                        </Badge>
                      </div>

                      <div className="max-h-80 overflow-y-auto divide-y divide-border p-1">
                        {expiringVendors.length === 0 ? (
                          <div className="p-6 text-center text-muted-foreground text-xs">
                            <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                            <div className="font-bold text-foreground">همه مجوزها معتبر هستند</div>
                            <div className="text-[11px] mt-1 text-muted-foreground">هیچ مجوزی در آستانه انقضا (کمتر از ۲ ماه) قرار ندارد.</div>
                          </div>
                        ) : (
                          expiringVendors.map(({ vendor, check }) => (
                            <div
                              key={vendor.id}
                              onClick={() => {
                                handleSelectVendor(vendor);
                                setShowNotificationPanel(false);
                              }}
                              className="p-3 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 cursor-pointer transition-colors rounded-xl space-y-1.5 group"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-bold text-xs text-foreground group-hover:text-amber-800 dark:group-hover:text-amber-300 truncate">
                                  {vendor.material || vendor.name}
                                </div>
                                {check.status === 'expired' ? (
                                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                    منقضی
                                  </Badge>
                                ) : (
                                  <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                                    {check.daysLeft} روز مانده
                                  </Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                تامین‌کننده: {vendor.name} {vendor.irc ? `(IRC: ${vendor.irc})` : ''}
                              </div>
                              <div className="text-[11px] text-muted-foreground flex items-center justify-between pt-1">
                                <span>تاریخ انقضا: <strong className="font-mono text-foreground">{vendor.ircExpiryDate}</strong></span>
                                <span className="text-primary font-bold text-[10px] group-hover:underline">مشاهده سورس ←</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* `users.manage` is the policy table's name for "administers the
                  system", so this is the same audience as the old
                  `role === 'admin'` test — but read from the one table both the
                  UI and the server use, and it follows a per-user exception
                  instead of ignoring it (rule 14).

                  Note this gate is a deliberate house rule, not a security
                  boundary: the file is built in the browser from `db`, which
                  `GET /api/vendors` already serves to every signed-in user. A
                  server permission cannot be added for it without inventing one
                  no endpoint enforces — the mistake `archive.read` was deleted
                  for. */}
              {can(currentUser, 'users.manage') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadBackup}
                  className="h-8 gap-1.5 text-xs font-bold text-foreground bg-background hover:bg-accent border-border shadow-2xs"
                  title="دانلود پشتیبان کامل پایگاه‌داده (JSON)"
                >
                  <Download className="w-3.5 h-3.5 text-primary" />
                  <span className="hidden md:inline">پشتیبان‌گیری</span>
                </Button>
              )}

              {/* Live clock, in the top-left beside the account box. */}
              <div className="hidden sm:flex items-center gap-2.5 px-3 py-1 bg-muted/60 border border-border/80 rounded-xl text-xs font-sans" dir="rtl">
                <span className="font-semibold text-foreground whitespace-nowrap">{systemTime.faDate}</span>
                <span className="text-border">|</span>
                <span className="font-mono font-bold text-primary tracking-wider leading-none" dir="ltr">{systemTime.time}</span>
                <span className="text-border">|</span>
                <span className="font-mono text-[10px] text-muted-foreground leading-none" dir="ltr" title="تاریخ میلادی، برای مکاتبات خارجی">
                  {systemTime.isoDate}
                </span>
              </div>

              {/* This used to be a permanently green, permanently pulsing
                  "سیستم فعال" chip. A status that cannot change is not status,
                  it is decoration. The one thing here that genuinely varies is
                  whether the session is talking to the database at all, so the
                  chip now appears only when it is not. */}
              {isLocalMode() && (
                <div className="hidden lg:flex bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-full items-center gap-1.5" title="داده‌ها فقط در همین مرورگر ذخیره می‌شوند">
                  <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">حالت لوکال (بدون پایگاه‌داده)</span>
                </div>
              )}

              {/* User menu (moved from the sidebar) */}
              {currentUser && (
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(v => !v)}
                    className="flex items-center gap-2 pr-1 pl-2 py-1 rounded-xl border border-border bg-background hover:bg-accent transition-colors cursor-pointer"
                    title={currentUser.name || currentUser.username}
                  >
                    <Avatar className="h-7 w-7 border border-border">
                      <AvatarFallback className="text-[10px] font-extrabold bg-primary/10 text-primary">{roleInitials(currentUser.role)}</AvatarFallback>
                    </Avatar>
                    <span className="hidden sm:flex flex-col text-right leading-tight max-w-[120px]">
                      <span className="text-[11px] font-bold text-foreground truncate">{currentUser.name || currentUser.username}</span>
                      <span className="text-[9px] text-muted-foreground truncate">{roleTitle(currentUser.role)}</span>
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {showUserMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                      <div className="absolute left-0 right-auto mt-2 w-72 bg-popover border border-border rounded-2xl shadow-xl z-50 overflow-hidden fade-in text-right" dir="rtl">
                        <div className="p-3.5 bg-muted/50 border-b border-border flex items-center gap-2.5">
                          <Avatar className="h-9 w-9 border border-border">
                            <AvatarFallback className="text-[11px] font-extrabold bg-primary/10 text-primary">{roleInitials(currentUser.role)}</AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold text-foreground truncate">{currentUser.name || currentUser.username}</span>
                            <span className="text-[10px] font-semibold text-muted-foreground truncate">{roleTitle(currentUser.role)}</span>
                          </div>
                        </div>
                        {/* Session facts: when they were last here, how long this
                            session has left, and what they can do. */}
                        <div className="px-3.5 py-2.5 border-b border-border space-y-1.5 text-[10px] text-muted-foreground">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                              <History className="w-3 h-3" />
                              ورود قبلی
                            </span>
                            <span className="font-semibold text-foreground">
                              {formatDateTime(currentUser.previousLoginAt) || 'اولین ورود'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                              <Calendar className="w-3 h-3" />
                              اعتبار نشست
                            </span>
                            <span className={`font-semibold ${sessionExpiringSoon ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                              {sessionLeftLabel || '—'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                              <Shield className="w-3 h-3" />
                              سطح دسترسی
                            </span>
                            <span className="font-semibold text-foreground">
                              {myPermissionCount} مورد{myPermissionsCustom ? ' (سفارشی)' : ''}
                            </span>
                          </div>
                        </div>

                        {/* My recent activity, straight from the audit trail. */}
                        <div className="px-3.5 py-2.5 border-b border-border">
                          <span className="text-[10px] font-bold text-muted-foreground block mb-1.5">فعالیت اخیر من</span>
                          {myActivity === null ? (
                            <span className="text-[10px] text-muted-foreground italic">در حال بارگذاری...</span>
                          ) : myActivity.length === 0 ? (
                            <span className="text-[10px] text-muted-foreground italic">فعالیتی ثبت نشده است.</span>
                          ) : (
                            <ul className="space-y-1">
                              {myActivity.map((a: any) => (
                                <li key={a.id} className="flex items-start gap-1.5 text-[10px] leading-snug">
                                  <span className="w-1 h-1 rounded-full bg-cyan-500 mt-1.5 shrink-0" />
                                  <span className="text-muted-foreground truncate" title={a.description}>
                                    {a.description || a.action}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="p-1.5">
                          <button
                            onClick={toggleTheme}
                            className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-foreground hover:bg-accent transition-colors text-right"
                          >
                            <span className="flex items-center gap-2.5">
                              {isDark ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-500" />}
                              {isDark ? 'حالت روز (روشن)' : 'حالت شب (تیره)'}
                            </span>
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full ${isDark ? 'bg-slate-700 text-slate-200' : 'bg-muted text-muted-foreground'}`}>{isDark ? 'DARK' : 'LIGHT'}</span>
                          </button>
                          {can(currentUser, 'users.manage') && (
                            <button
                              onClick={() => { setShowUserMenu(false); navigate('users'); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-foreground hover:bg-accent transition-colors text-right"
                            >
                              <UserCog className="w-4 h-4 text-primary" />
                              مدیریت کاربران
                            </button>
                          )}
                          <button
                            onClick={() => { setShowUserMenu(false); setShowChangePasswordModal(true); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-foreground hover:bg-accent transition-colors text-right"
                          >
                            <Shield className="w-4 h-4 text-primary" />
                            تغییر کلمه عبور
                          </button>
                          <button
                            onClick={() => { setShowUserMenu(false); handleLogout(); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors text-right"
                          >
                            <X className="w-4 h-4" />
                            خروج از حساب
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </header>

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
          ariaLabel="تغییرات ذخیره‌نشده"
        >
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="text-right">
                  <h3 className="text-sm font-black text-foreground mb-1.5">تغییرات ذخیره‌نشده</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                    فرمی باز است و اطلاعات واردشده هنوز ذخیره نشده‌اند. اگر از این صفحه خارج شوید، این اطلاعات از بین می‌روند.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-start gap-2.5 mt-6">
                {/* The safe answer leads and carries the primary style: this
                    dialog interrupts someone who was mid-task, and the reflex
                    click should keep their work, not discard it. Same order and
                    wording as the confirmation inside FormModal. */}
                <button
                  autoFocus
                  onClick={() => setPendingNav(null)}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer"
                >
                  بازگشت به فرم
                </button>
                <button
                  onClick={() => { const go = pendingNav; setPendingNav(null); navGuardRef.current = null; go?.(); }}
                  className="px-4 py-2 rounded-xl bg-muted hover:bg-accent text-foreground border border-border text-xs font-bold transition-colors cursor-pointer"
                >
                  خروج بدون ذخیره
                </button>
              </div>
        </FormModal>

        {/* Global command palette (⌘K) */}
        <CommandPalette
          open={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          db={db}
          materials={materials}
          partners={businessPartners}
          onSelectVendor={handleSelectVendor}
          onNavigate={(v, cid) => navigate(v as any, cid as any)}
        />

        {/* Top sync progress bar (non-blocking; shown while syncing with the server) */}
        {isSyncing && (
          <div className="fixed top-0 inset-x-0 z-[60] h-0.5 overflow-hidden bg-[var(--primary)]/15" role="progressbar" aria-label="در حال همگام‌سازی">
            <div className="h-full w-1/3 bg-[var(--primary)] rounded-full animate-[syncSlide_1.1s_ease-in-out_infinite]" />
          </div>
        )}

        {/* Data load error banner (server unreachable) */}
        {loadError && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] fade-in flex items-center gap-2 max-w-[92vw] bg-[var(--card)] border border-[var(--warning-main)]/40 text-[var(--card-foreground)] px-4 py-2.5 rounded-xl shadow-lg" dir="rtl">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--warning-main)]" />
            <span className="font-medium text-xs font-sans text-right">{loadError}</span>
            <button onClick={() => setLoadError(null)} className="mr-1 text-[var(--muted-foreground)] hover:text-[var(--card-foreground)]" aria-label="بستن">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Global Toast (theme-aware; error vs. success styling) */}
        {toastMsg && (() => {
          const isError = toastKind ? toastKind === 'error' : /خطا|ناموفق|وجود ندارد|نمی‌تواند|نمی تواند|امکان حذف|عدم دسترسی/.test(toastMsg);
          return (
            <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 fade-in flex items-center gap-2 bg-[var(--card)] text-[var(--card-foreground)] border px-4 py-2.5 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.14)] ${isError ? 'border-[var(--danger-main)]/45' : 'border-[var(--border)]'}`}>
              {isError
                ? <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--danger-main)]" />
                : <CheckCircle className="w-4 h-4 shrink-0 text-emerald-500" />}
              <span className="font-medium text-xs font-sans text-right" dir="rtl">{toastMsg}</span>
              {toastAction && (
                <button
                  type="button"
                  onClick={() => {
                    const run = toastAction.run;
                    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
                    setToastMsg(null); setToastKind(null); setToastAction(null);
                    run();
                  }}
                  className="shrink-0 mr-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity cursor-pointer"
                >
                  {toastAction.label}
                </button>
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
              setToastMsg("کلمه عبور با موفقیت تغییر یافت");
              setTimeout(() => setToastMsg(null), 3000);
            }}
          />
        )}

      </div>
    </>
  );
}


// --- View: Home ---
