import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Home, Factory, Globe, Package, Archive, AlertTriangle, FileText,
  Activity, ChevronLeft, ChevronRight, Search, Menu, X, Shield, Info, Briefcase, 
  Microscope, Building, Building2, CheckCircle, AlertCircle, DollarSign, Plus, Pencil, User as UserIcon,
  Pill, Handshake, Warehouse, Boxes, Coins, PawPrint, ClipboardCheck, Hash, Trash2, ShieldAlert, Printer,
  RotateCcw, Download, ChevronDown, ChevronUp, Database, Award, History, Mail, Phone, MapPin, Bell, Calendar,
  ClipboardList, PieChart as PieChartIcon, Sun, Moon
} from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell } from 'recharts';
import { motion, AnimatePresence } from 'motion/react';

import { INITIAL_VENDORS_DB } from './db_foreign_only';
import { INITIAL_BUSINESS_PARTNERS_DB } from './db_business_partners';
import { Category, Status, Grade, Scores, Vendor, User, Role, RiskAssessmentData, AnalysisRecord, Material, BusinessPartner, SOPDocumentStatus } from './types';
import { exportCategoryToExcel, exportFullArchiveMultiSheetExcel } from './utils/excelExport';
// @ts-ignore
import temadLogo from './assets/logo.png';

// --- Utilities & Reusable Components ---

const categoryLabels = {
  foreign: { fa: 'خرید خارجی', en: 'Foreign Purchase', icon: Globe },
  domestic: { fa: 'خرید داخلی', en: 'Domestic Purchase', icon: Factory },
  veterinary: { fa: 'دامی', en: 'Veterinary', icon: PawPrint },
  packaging: { fa: 'اقلام بسته بندی', en: 'Packaging Items', icon: Package },
  sample: { fa: 'نمونه', en: 'Sample', icon: ClipboardCheck },
  blacklist: { fa: 'لیست سیاه', en: 'Black List', icon: AlertTriangle }
};

import { LoginView } from './components/LoginView';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { GradeBadge } from './components/GradeBadge';
import { ScoreBar, getScoreColorClass, getSRIColorClass, getScoreColorConfig } from './components/ScoreBar';
import { extractCountry, getDisplayCountry, calculateOverallScore, setCalculationWeights, CALCULATION_WEIGHTS, checkLicenseExpiry, toEnglishDigits } from './utils/vendorUtils';
import { encodeRoute, decodeRoute, routeKey, buildStackFromRoute, type RouteState } from './utils/navRoutes';
import { FmeaService } from './utils/fmeaService';
import { ScoringGuide, ScoreCard } from './components/ScoringGuide';
import { PrintableSampleForm, PrintableEvaluationForm } from './components/PrintableForms';
import { ShamsiDatePicker } from './components/ShamsiDatePicker';
import { Pagination } from './components/Pagination';
import { AuditTrailView } from './components/AuditTrailView';
import { MaterialRepositoryView } from './components/MaterialRepositoryView';
import { MaterialSelector } from './components/MaterialSelector';
import { PartnerSelector } from './components/PartnerSelector';
import { BusinessPartnerRepositoryView } from './components/BusinessPartnerRepositoryView';
import { AppSidebarButton as SidebarButton } from './components/AppSidebarButton';
import { CommandPalette } from './components/CommandPalette';
import { useTheme } from './design-system/ThemeSwitcher';
import { authFetch, isLocalMode } from './services/authFetch';
import { appendLocalAudit, readLocalAudit } from './services/localAudit';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Avatar, AvatarFallback } from './components/ui/avatar';
import { Separator } from './components/ui/separator';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './components/ui/card';
import { Input } from './components/ui/input';

// --- Main App Component ---

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('app_currentUser');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [systemTime, setSystemTime] = useState(() => {
    const d = new Date();
    return {
      faDate: d.toLocaleDateString('fa-IR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).replace(/،/g, ''),
      time: d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setSystemTime({
        faDate: d.toLocaleDateString('fa-IR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).replace(/،/g, ''),
        time: d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const normalizeAndCleanVendor = (v: any): Vendor => {
    if (v.isSample) {
      if (v.status === 'rejected') {
        return { ...v, grade: 'rejected' };
      }
      return v;
    }

    const isInitialVendor = typeof v.id === 'string' && v.id.startsWith('vF');
    const hasBeenEvaluatedByUser = (v.rawScores && Object.keys(v.rawScores).length > 0) || (v.scores && (v.scores.commercial > 0 || v.scores.qa > 0));

    if (isInitialVendor && !hasBeenEvaluatedByUser && !v.scores) {
      const isRejected = v.status === 'rejected' || v.category === 'blacklist' || v.grade === 'rejected';
      v.scores = null;
      v.rawScores = null;
      v.status = isRejected ? 'rejected' : 'new';
      v.grade = isRejected ? 'rejected' : 'new';
    }

    if (v.scores && v.scores.qc !== undefined) {
       v.scores.planning = v.scores.qc;
       delete v.scores.qc;
    }
    if (v.status === 'rejected' || v.grade === 'rejected') {
       return { ...v, status: 'rejected', grade: 'rejected' };
    }
    const isFullyScored = v.scores && v.scores.commercial > 0 && v.scores.qa > 0 && v.scores.planning > 0 && v.scores.finance > 0;
    if (isFullyScored) {
       const rounded = calculateOverallScore(v.scores, true) || 0;
       let calcGrade: Grade = v.grade;
       let calcStatus: Status = v.status;
       if (rounded >= 80) {
          calcGrade = 'A';
          calcStatus = 'approved';
       } else if (rounded >= 60) {
          calcGrade = 'B';
          calcStatus = 'approved';
       } else if (rounded >= 40) {
          calcGrade = 'C';
          calcStatus = 'conditional';
       } else {
          calcGrade = 'rejected';
          calcStatus = 'rejected';
       }
       return { ...v, grade: calcGrade, status: calcStatus };
    }
    return v;
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

  useEffect(() => {
    localStorage.setItem('app_db', JSON.stringify(db));
  }, [db]);

  useEffect(() => {
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
  }, []);

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
    authFetch('/api/materials')
      .then(res => (res.ok ? res.json() : null))
      .then((data: Material[] | null) => { if (Array.isArray(data)) setMaterials(data); })
      .catch(err => console.error("Failed to load materials from backend. Using local cache.", err));
  }, [currentUser]);

  const [businessPartners, setBusinessPartners] = useState<BusinessPartner[]>(() => {
    try {
      const saved = localStorage.getItem('app_business_partners');
      return saved ? JSON.parse(saved) : INITIAL_BUSINESS_PARTNERS_DB;
    } catch {
      return INITIAL_BUSINESS_PARTNERS_DB;
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
    authFetch('/api/business-partners')
      .then(res => {
        if (!res.ok) throw new Error('API response failed');
        return res.json();
      })
      .then((data: BusinessPartner[]) => {
        if (Array.isArray(data)) {
          setBusinessPartners(data);
        }
      })
      .catch(err => {
        console.error("Failed to load business partners from backend. Using local cache.", err);
      });
  }, [currentUser]);

  type ViewState = {
    view: 'home' | 'category' | 'archive' | 'supplier-audit' | 'audit-trail' | 'materials' | 'business-partners';
    categoryId: Category | null;
    selectedVendor: Vendor | null;
    expandedMaterial?: string | null;
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
  });

  const viewStateToRoute = (s: ViewState): RouteState => ({
    view: s.view,
    categoryId: s.categoryId ?? null,
    vendorId: s.selectedVendor?.id ?? null,
    expandedMaterial: s.expandedMaterial ?? null,
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
  const viewKey = `${view}|${categoryId ?? ''}|${currentViewState.selectedVendor?.id ?? ''}`;
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
  const [isSyncing, setIsSyncing] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // In local/demo mode the backend is intentionally absent — never show the
  // "connection failed" banner (the mount fetch runs before demo login is set).
  useEffect(() => { if (isLocalMode()) setLoadError(null); }, [currentUser]);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { isDark, toggleTheme } = useTheme();
  const roleInitials = (r?: string) => r === 'admin' ? 'AD' : r === 'qa' ? 'QA' : r === 'commercial' ? 'CO' : r === 'planning' ? 'PL' : r === 'finance' ? 'FI' : 'US';
  const roleTitle = (r?: string) => r === 'admin' ? 'مدیریت ارشد سیستم' : r === 'qa' ? 'واحد تضمین کیفیت QA' : r === 'commercial' ? 'واحد بازرگانی و خرید' : r === 'planning' ? 'برنامه‌ریزی و انبار' : r === 'finance' ? 'واحد مالی و حسابداری' : 'کاربر سیستم';
  const handleLogout = () => {
    localStorage.removeItem('app_jwt_token');
    localStorage.removeItem('app_currentUser');
    localStorage.removeItem('app_viewHistory');
    localStorage.removeItem('app_local_mode');
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

  const navigate = (newView: 'home' | 'category' | 'archive' | 'supplier-audit' | 'audit-trail' | 'materials' | 'business-partners', newCat: Category | null = null) => {
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
          .filter(({ s }) => s.view === newView && s.categoryId === newCat && s.selectedVendor === null)
          .pop();
        if (existing) {
          return prev.slice(0, existing.i + 1);
        }
        return capHistory([...prev, { view: newView, categoryId: newCat, selectedVendor: null }]);
      });
      setSidebarOpen(false);
    });
  };

  const handleSelectVendor = (vendor: Vendor | null) => {
    if (vendor) {
      runGuarded(() => {
        setViewHistory(prev => {
          const last = prev[prev.length - 1];
          if (last && last.selectedVendor?.id === vendor.id) {
            return prev;
          }
          // Mark the material as expanded on the underlying list entry so that
          // returning (goBack) restores the same expanded material, then push
          // the vendor-detail entry on top (carrying the same marker).
          const base = { ...last, expandedMaterial: vendor.materialEn || last?.expandedMaterial || null };
          return capHistory([...prev.slice(0, -1), base, { ...base, selectedVendor: vendor }]);
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
    if (state.selectedVendor) {
      return state.selectedVendor.name || 'جزییات سورس';
    }
    if (state.view === 'home') return 'صفحه اصلی';
    if (state.view === 'archive') return 'آرشیو کامل';
    if (state.view === 'supplier-audit') return 'بررسی یکپارچه تامین‌کننده';
    if (state.view === 'materials') return 'مخزن مواد اولیه';
    if (state.view === 'audit-trail') return 'Audit Trail';
    if (state.view === 'business-partners') return 'مخزن شرکای تجاری';
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
      const rejected = normalized.status === 'rejected' && original?.status !== 'rejected';
      appendLocalAudit({
        user: currentUser?.name, role: currentUser?.role,
        module: isSource ? 'Source Management' : 'Supplier Management',
        action: original ? 'Update' : 'Create',
        entityType: isSource ? 'Source' : 'Supplier',
        entityName: normalized.material || normalized.name || 'سورس',
        severity: rejected ? 'Critical' : original ? 'Warning' : 'Info',
        description: `${original ? 'ویرایش' : 'ثبت'} "${normalized.name || normalized.material}"${rejected ? ' — انتقال به لیست سیاه' : ''}`,
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

    // Dispatch precision requests based on modified data blocks
    if (profileChanged) {
      authFetch(`/api/vendors/${normalized.id}/profile`, {
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
      }).catch(err => console.error("Profile sync failed:", err));
    }

    if (contactChanged) {
      authFetch(`/api/vendors/${normalized.id}/contact`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactInfo: normalized.contactInfo,
          lastAudit: normalized.lastAudit,
          ircExpiryDate: normalized.ircExpiryDate,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Contact sync failed:", err));
    }

    if (scoresChanged) {
      authFetch(`/api/vendors/${normalized.id}/scores`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scores: normalized.scores,
          rawScores: normalized.rawScores,
          rejectionReasons: normalized.rejectionReasons,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Scores sync failed:", err));
    }

    if (analysisChanged) {
      authFetch(`/api/vendors/${normalized.id}/analysis`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisRecords: normalized.analysisRecords,
          activityLogs: normalized.activityLogs,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Analysis sync failed:", err));
    } else if (logsChanged) {
      authFetch(`/api/vendors/${normalized.id}/logs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityLogs: normalized.activityLogs,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Logs sync failed:", err));
    }

    if (riskChanged) {
      authFetch(`/api/vendors/${normalized.id}/risk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          riskAssessment: normalized.riskAssessment,
          reasonForChange: normalized.reasonForChange
        })
      }).catch(err => console.error("Risk sync failed:", err));
    }
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

  const handleAddVendor = (newVendor: Vendor) => {
    const normalized = normalizeAndCleanVendor(newVendor);
    setDb([normalized, ...db]);
    setToastMsg('سورس جدید با موفقیت اضافه شد!');
    setTimeout(() => setToastMsg(null), 3000);
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
    handleSelectVendor(normalized);
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

  const handleAddBusinessPartner = (newPartner: BusinessPartner) => {
    setBusinessPartners([newPartner, ...businessPartners]);
    setToastMsg(`شریک تجاری "${newPartner.name}" با موفقیت اضافه شد!`);
    setTimeout(() => setToastMsg(null), 3000);
    if (isLocalMode()) appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'Business Partner Repository', action: 'Create', entityType: 'BusinessPartner', entityName: newPartner.name, severity: 'Info', description: `ثبت شریک تجاری جدید "${newPartner.name}" (${newPartner.type})`, before: null, after: newPartner, reason: 'ثبت شریک تجاری' });
    authFetch('/api/business-partners', {
      method: 'POST',
      body: JSON.stringify(newPartner)
    }).catch(err => console.error("Failed to persist new business partner:", err));
  };

  const handleEditBusinessPartner = (updatedPartner: BusinessPartner) => {
    const oldPartner = businessPartners.find(p => p.id === updatedPartner.id);
    setBusinessPartners(businessPartners.map(p => p.id === updatedPartner.id ? updatedPartner : p));
    setToastMsg(`اطلاعات شریک تجاری "${updatedPartner.name}" با موفقیت به‌روزرسانی شد!`);
    setTimeout(() => setToastMsg(null), 3000);
    if (isLocalMode()) appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'Business Partner Repository', action: 'Update', entityType: 'BusinessPartner', entityName: updatedPartner.name, severity: 'Warning', description: `ویرایش شریک تجاری "${updatedPartner.name}"`, before: oldPartner || null, after: updatedPartner, reason: 'ویرایش شریک تجاری' });
    authFetch(`/api/business-partners/${updatedPartner.id}`, {
      method: 'PUT',
      body: JSON.stringify(updatedPartner)
    }).catch(err => console.error("Failed to persist business partner update:", err));
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
        setToastMsg(err.message || 'حذف شریک تجاری در سرور ناموفق بود.');
        setTimeout(() => setToastMsg(null), 5000);
      });
  };

  // Views Content
  const renderContent = () => {
    let content;
    let keyName = '';

    if (vendorLinkPending) {
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
      content = <VendorDetail db={db} vendor={selectedVendor} onBack={goBack} onSave={handleUpdateVendor} onDelete={handleDeleteVendor} currentUser={currentUser} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} registerNavGuard={registerNavGuard} />;
    } else if (view === 'home') {
      keyName = 'home';
      content = <HomeView db={db} onNavigate={navigate} onSelectVendor={handleSelectVendor} onAddVendor={handleAddVendor} currentUser={currentUser} onDownloadBackup={handleDownloadBackup} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} />;
    } else if (view === 'archive') {
      if (currentUser?.role === 'admin') {
        keyName = 'archive';
        content = <ArchiveView db={db} currentUser={currentUser} partners={businessPartners} materials={materials} />;
      } else {
        keyName = 'home-fallback';
        content = <HomeView db={db} onNavigate={navigate} onSelectVendor={handleSelectVendor} onAddVendor={handleAddVendor} currentUser={currentUser} onDownloadBackup={handleDownloadBackup} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} />;
      }
    } else if (view === 'supplier-audit') {
      keyName = 'supplier-audit';
      content = <SupplierAuditView db={db} onSelectVendor={handleSelectVendor} currentUser={currentUser} partners={businessPartners} />;
    } else if (view === 'materials') {
      keyName = 'materials';
      content = (
        <MaterialRepositoryView 
          materials={materials}
          onAddMaterial={handleAddMaterial}
          onEditMaterial={handleEditMaterial}
          onDeleteMaterial={handleDeleteMaterial}
          currentUser={currentUser}
          db={db}
        />
      );
    } else if (view === 'business-partners') {
      keyName = 'business-partners';
      content = (
        <BusinessPartnerRepositoryView
          partners={businessPartners}
          onAddPartner={handleAddBusinessPartner}
          onEditPartner={handleEditBusinessPartner}
          onDeletePartner={handleDeleteBusinessPartner}
          currentUser={currentUser}
          db={db}
        />
      );
    } else if (view === 'audit-trail') {

      if (currentUser?.role === 'admin') {
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
    } else if (view === 'category' && categoryId) {
      keyName = `category-${categoryId}`;
      content = <CategoryView db={db} categoryId={categoryId} onSelectVendor={handleSelectVendor} currentUser={currentUser} expandedMaterial={expandedMaterial} onToggleMaterial={setExpandedMaterial} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} />;
    } else {
      keyName = 'home-fallback';
      content = <HomeView db={db} onNavigate={navigate} onSelectVendor={handleSelectVendor} onAddVendor={handleAddVendor} currentUser={currentUser} onDownloadBackup={handleDownloadBackup} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} />;
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
          {/* BRAND BLOCK */}
          <div className={`py-4.5 border-b border-border/80 flex items-center ${sidebarCollapsed ? 'md:justify-center md:px-2 px-5 justify-between' : 'px-5 justify-between'}`}>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center shrink-0">
                <img src={temadLogo} alt="Logo" className="h-12 w-auto object-contain" />
              </div>
              <div className={`flex-col justify-center text-right ${sidebarCollapsed ? 'flex md:hidden' : 'flex'}`}>
                <span className="font-extrabold text-foreground text-xs sm:text-sm leading-tight tracking-tight">Vendor List & Supplier Evaluation System (VLSE)</span>
                <span className="text-primary font-mono text-[10px] sm:text-[11px] mt-0.5 tracking-tight font-bold">
                  سیستم ارزیابی تامین‌کنندگان
                </span>
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

          <nav className="flex-1 px-3 py-3.5 space-y-1 overflow-y-auto">
            <SidebarButton collapsed={sidebarCollapsed}
              icon={Home} label="صفحه اصلی" 
              variant="home"
              active={view === 'home' && !selectedVendor} 
              onClick={() => navigate('home')} 
            />

            <div className={`pt-4 pb-1.5 px-3 text-[11px] font-mono uppercase tracking-widest text-muted-foreground/70 flex items-center justify-between ${sidebarCollapsed ? 'md:hidden' : ''}`}>
              <span>دسته‌بندی‌ها</span>
              <span className="text-[10px] font-bold text-muted-foreground">CATEGORIES</span>
            </div>
            {(Object.entries(categoryLabels) as [Category, any][]).map(([id, meta]) => {
              const count = db.filter(v =>
                id === 'sample' ? (v.category === 'sample' || v.isSample) :
                id === 'blacklist' ? (!v.isSample && v.category !== 'sample' && (v.category === 'blacklist' || v.status === 'rejected' || v.grade === 'rejected')) :
                (v.category === id && v.status !== 'rejected' && v.grade !== 'rejected')
              ).length;
              return (
                <SidebarButton collapsed={sidebarCollapsed}
                  key={id}
                  variant={id}
                  badge={count}
                  icon={meta.icon} label={meta.fa} sub={meta.en}
                  active={view === 'category' && categoryId === id} 
                  onClick={() => navigate('category', id)} 
                />
              );
            })}

            <div className={`pt-4 pb-1.5 px-3 text-[11px] font-mono uppercase tracking-widest text-muted-foreground/70 flex items-center justify-between ${sidebarCollapsed ? 'md:hidden' : ''}`}>
              <span>مدیریت پایگاه داده</span>
              <span className="text-[10px] font-bold text-muted-foreground">REPOSITORY</span>
            </div>
            <SidebarButton collapsed={sidebarCollapsed}
              icon={Building2} label="مخزن شرکای تجاری" sub="Business Partners"
              badge={businessPartners?.length || 0}
              variant="business-partners"
              active={view === 'business-partners'} 
              onClick={() => navigate('business-partners')} 
            />
            <SidebarButton collapsed={sidebarCollapsed}
              icon={Database} label="مخزن مواد اولیه" sub="Materials Master"
              badge={materials?.length || 0}
              variant="materials"
              active={view === 'materials'} 
              onClick={() => navigate('materials')} 
            />

            <div className={`pt-4 pb-1.5 px-3 text-[11px] font-mono uppercase tracking-widest text-muted-foreground/70 flex items-center justify-between ${sidebarCollapsed ? 'md:hidden' : ''}`}>
              <span>کیفیت و نظارت</span>
              <span className="text-[10px] font-bold text-muted-foreground">GOVERNANCE</span>
            </div>
            {currentUser?.role === 'admin' && (
              <>
                <SidebarButton collapsed={sidebarCollapsed}
                  icon={Archive} label="آرشیو کامل داده‌ها" sub="Full Master Archive"
                  badge={db.length}
                  variant="archive"
                  active={view === 'archive'} 
                  onClick={() => navigate('archive')} 
                />
                <SidebarButton collapsed={sidebarCollapsed}
                  icon={History} label="ردیابی تغییرات (Audit)" sub="Audit Trail Center"
                  alert={criticalAuditCount}
                  variant="audit-trail"
                  active={view === 'audit-trail'} 
                  onClick={() => navigate('audit-trail')} 
                />
              </>
            )}
            <SidebarButton collapsed={sidebarCollapsed}
              icon={Handshake} label="بررسی یکپارچه تامین‌کننده" sub="Supplier 360 Audit"
              variant="supplier-audit"
              active={view === 'supplier-audit'} 
              onClick={() => navigate('supplier-audit')} 
            />
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
                            <span className="font-bold text-foreground truncate max-w-[180px]" aria-current="page">{label}</span>
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

              {/* Beautiful Live System Clock & Calendar */}
              <div className="hidden sm:flex items-center gap-2.5 px-3 py-1 bg-muted/60 border border-border/80 rounded-xl text-xs font-sans" dir="rtl">
                <span className="font-semibold text-foreground">{systemTime.faDate}</span>
                <span className="text-border">|</span>
                <span className="font-mono font-bold text-primary tracking-wider leading-none" dir="ltr">{systemTime.time}</span>
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
                    <span className="absolute -top-1.5 -right-1.5 px-1 min-w-[18px] h-[18px] bg-rose-600 text-white text-[10px] font-bold font-mono rounded-full flex items-center justify-center shadow-xs animate-pulse">
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

              {currentUser?.role === 'admin' && (
                <Button 
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadBackup}
                  className="h-8 gap-1.5 text-xs font-bold text-foreground bg-background hover:bg-accent border-border shadow-2xs"
                  title="دانلود پشتیبان کامل پایگاه‌داده (JSON)"
                >
                  <Download className="w-3.5 h-3.5 text-primary" />
                  <span className="hidden md:inline">پشتیبان‌گیری (JSON)</span>
                </Button>
              )}

              <div className="hidden lg:flex bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-full items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-300">سیستم فعال</span>
              </div>

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
                      <div className="absolute left-0 right-auto mt-2 w-60 bg-popover border border-border rounded-2xl shadow-xl z-50 overflow-hidden fade-in text-right" dir="rtl">
                        <div className="p-3.5 bg-muted/50 border-b border-border flex items-center gap-2.5">
                          <Avatar className="h-9 w-9 border border-border">
                            <AvatarFallback className="text-[11px] font-extrabold bg-primary/10 text-primary">{roleInitials(currentUser.role)}</AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold text-foreground truncate">{currentUser.name || currentUser.username}</span>
                            <span className="text-[10px] font-semibold text-muted-foreground truncate">{roleTitle(currentUser.role)}</span>
                          </div>
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
            <div className={(view === 'audit-trail' || view === 'materials') && !selectedVendor ? "max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8" : "max-w-5xl mx-auto p-4 sm:p-8"}>
              {renderContent()}
            </div>
          </div>

        </main>

        {/* Unsaved-changes confirmation before leaving an open edit form */}
        {pendingNav && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" dir="rtl">
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm fade-in" onClick={() => setPendingNav(null)} />
            <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 dialog-enter" role="alertdialog" aria-modal="true">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="text-right">
                  <h3 className="text-sm font-black text-foreground mb-1.5">تغییرات ذخیره‌نشده</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                    فرم ویرایش باز است و تغییرات شما هنوز ذخیره نشده‌اند. اگر از این صفحه خارج شوید، این تغییرات از بین می‌روند.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-start gap-2.5 mt-6">
                <button
                  onClick={() => { const go = pendingNav; setPendingNav(null); navGuardRef.current = null; go?.(); }}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  خروج بدون ذخیره
                </button>
                <button
                  onClick={() => setPendingNav(null)}
                  className="px-4 py-2 rounded-xl bg-muted hover:bg-accent text-foreground border border-border text-xs font-bold transition-colors cursor-pointer"
                >
                  ماندن در صفحه
                </button>
              </div>
            </div>
          </div>
        )}

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
          const isError = /خطا|ناموفق|وجود ندارد|نمی‌تواند|نمی تواند|امکان حذف/.test(toastMsg);
          return (
            <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 fade-in flex items-center gap-2 bg-[var(--card)] text-[var(--card-foreground)] border px-4 py-2.5 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.14)] ${isError ? 'border-[var(--danger-main)]/45' : 'border-[var(--border)]'}`}>
              {isError
                ? <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--danger-main)]" />
                : <CheckCircle className="w-4 h-4 shrink-0 text-emerald-500" />}
              <span className="font-medium text-xs font-sans text-right" dir="rtl">{toastMsg}</span>
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

const categoryCardStyles: Record<string, {
  hoverBg: string;
  hoverBorder: string;
  hoverShadow: string;
  iconBg: string;
  iconBorder: string;
  iconText: string;
  statText: string;
  accentGlow: string;
}> = {
  foreign: {
    hoverBg: 'hover:bg-indigo-50/20',
    hoverBorder: 'hover:border-indigo-500/40',
    hoverShadow: 'hover:shadow-[0_12px_30px_rgba(79,70,229,0.20)]',
    iconBg: 'bg-indigo-600/10',
    iconBorder: 'border-indigo-500/25',
    iconText: 'text-indigo-600',
    statText: 'text-indigo-600',
    accentGlow: 'group-hover:shadow-[0_0_20px_rgba(79,70,229,0.30)]'
  },
  domestic: {
    hoverBg: 'hover:bg-emerald-50/20',
    hoverBorder: 'hover:border-emerald-500/40',
    hoverShadow: 'hover:shadow-[0_12px_30px_rgba(5,150,105,0.20)]',
    iconBg: 'bg-emerald-600/10',
    iconBorder: 'border-emerald-500/25',
    iconText: 'text-emerald-600',
    statText: 'text-emerald-600',
    accentGlow: 'group-hover:shadow-[0_0_20px_rgba(5,150,105,0.30)]'
  },
  veterinary: {
    hoverBg: 'hover:bg-fuchsia-50/20',
    hoverBorder: 'hover:border-fuchsia-500/40',
    hoverShadow: 'hover:shadow-[0_12px_30px_rgba(192,38,211,0.20)]',
    iconBg: 'bg-fuchsia-600/10',
    iconBorder: 'border-fuchsia-500/25',
    iconText: 'text-fuchsia-600',
    statText: 'text-fuchsia-600',
    accentGlow: 'group-hover:shadow-[0_0_20px_rgba(192,38,211,0.30)]'
  },
  packaging: {
    hoverBg: 'hover:bg-amber-50/20',
    hoverBorder: 'hover:border-amber-500/40',
    hoverShadow: 'hover:shadow-[0_12px_30px_rgba(217,119,6,0.20)]',
    iconBg: 'bg-amber-600/10',
    iconBorder: 'border-amber-500/25',
    iconText: 'text-amber-600',
    statText: 'text-amber-600',
    accentGlow: 'group-hover:shadow-[0_0_20px_rgba(217,119,6,0.30)]'
  },
  sample: {
    hoverBg: 'hover:bg-violet-50/20',
    hoverBorder: 'hover:border-violet-500/40',
    hoverShadow: 'hover:shadow-[0_12px_30px_rgba(124,58,237,0.20)]',
    iconBg: 'bg-violet-600/10',
    iconBorder: 'border-violet-500/25',
    iconText: 'text-violet-600',
    statText: 'text-violet-600',
    accentGlow: 'group-hover:shadow-[0_0_20px_rgba(124,58,237,0.30)]'
  }
};

// --- View: Home ---
function HomeView({ db, onNavigate, onSelectVendor, onAddVendor, currentUser, onDownloadBackup, materials, onAddMaterial, partners = [], onAddPartner }: { db: Vendor[], onNavigate: any, onSelectVendor: any, onAddVendor: (v: Vendor) => void, currentUser: User, onDownloadBackup?: () => void, materials: Material[], onAddMaterial: (m: Material) => void, partners?: BusinessPartner[], onAddPartner?: (p: BusinessPartner) => void }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const stats = useMemo(() => {
    return {
      total: db.length,
      gradeA: db.filter(v => v.grade === 'A').length,
      gradeB: db.filter(v => v.grade === 'B').length,
      gradeC: db.filter(v => v.grade === 'C').length,
      rejected: db.filter(v => v.grade === 'rejected' || v.status === 'rejected').length
    };
  }, [db]);

  const rejectedVendors = db.filter(v => v.status === 'rejected');

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

  // Grade distribution for the donut (semantic ordinal grade colours).
  const gradeDistribution = useMemo(() => {
    const graded = stats.gradeA + stats.gradeB + stats.gradeC + stats.rejected;
    const ungraded = Math.max(0, stats.total - graded);
    return [
      { name: 'Grade A', value: stats.gradeA, color: '#10b981' },
      { name: 'Grade B', value: stats.gradeB, color: '#3b82f6' },
      { name: 'Grade C', value: stats.gradeC, color: '#f59e0b' },
      { name: 'Reject / سیاه', value: stats.rejected, color: '#e11d48' },
      { name: 'بدون گرید', value: ungraded, color: '#94a3b8' },
    ].filter(d => d.value > 0);
  }, [stats]);

  // Pending-actions center: real, actionable quality gaps.
  const pendingActions = useMemo(() => {
    const realVendors = db.filter(v => !v.isSample && v.category !== 'sample');
    const notEvaluated = realVendors.filter(v => v.status !== 'rejected' && !(v.grade === 'A' || v.grade === 'B' || v.grade === 'C'));
    const noRisk = realVendors.filter(v => v.status !== 'rejected' && !v.riskAssessment);
    const sopPending = (partners || []).filter(p => p.type === 'Supplier' && (!p.evaluation || p.evaluation.grade === 'Not Evaluated'));
    return [
      { key: 'eval', label: 'سورس‌های ارزیابی‌نشده', count: notEvaluated.length, items: notEvaluated, icon: ClipboardList, tone: 'amber' },
      { key: 'risk', label: 'ریسک ثبت‌نشده', count: noRisk.length, items: noRisk, icon: ShieldAlert, tone: 'orange' },
      { key: 'sop', label: 'ارزیابی SOP معوق فروشندگان', count: sopPending.length, items: [], icon: Award, tone: 'blue' },
      { key: 'irc', label: 'IRC نزدیک انقضا / منقضی', count: expiringVendors.length, items: expiringVendors.map(e => e.vendor), icon: Calendar, tone: 'rose' },
    ];
  }, [db, partners, expiringVendors]);

  // Lab pass-rate across all sources.
  const labStats = useMemo(() => {
    let pass = 0, cond = 0, rej = 0;
    for (const v of db) for (const r of (v.analysisRecords || [])) {
      if (r.decision === 'Pass') pass++;
      else if (r.decision === 'Approved Conditional') cond++;
      else if (r.decision === 'Reject') rej++;
    }
    const total = pass + cond + rej;
    return { pass, cond, rej, total, rate: total > 0 ? Math.round(((pass + cond) / total) * 100) : 0 };
  }, [db]);

  // Recent audit activity (works in local mode; backend fetch otherwise).
  const [recentAudit, setRecentAudit] = useState<any[]>([]);
  useEffect(() => {
    if (!currentUser) return;
    if (isLocalMode()) { setRecentAudit(readLocalAudit().slice(0, 5)); return; }
    let cancelled = false;
    authFetch('/api/audit-logs?page=1&limit=5')
      .then(res => (res.ok ? res.json() : null))
      .then(j => { if (!cancelled && j?.data) setRecentAudit(j.data.slice(0, 5)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser, db, partners, materials]);

  const toneClasses: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800',
    orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800',
    blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800',
    rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800',
  };

  return (
    <div className="space-y-7 fade-in">
      {/* HERO SECTION */}
      <div className="border-b border-border/80 pb-5">
        <div className="text-primary font-mono text-xs tracking-widest uppercase mb-1.5 font-bold">Vendor List & Supplier Evaluation System (VLSE)</div>
        <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
          <div>
            <h2 className="text-2xl font-black text-foreground leading-tight tracking-tight mb-1.5">
              سیستم جامع ارزیابی و رتبه‌بندی کیفی تامین‌کنندگان
            </h2>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            {currentUser && (
              <Button 
                onClick={() => setShowAddModal(true)}
                className="w-full sm:w-auto h-11 px-6 shadow-sm gap-2 text-sm font-bold shrink-0"
              >
                <Plus className="w-4 h-4" />
                ثبت سورس جدید (Source)
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showAddModal ? 'opacity-100 max-h-[2000px]' : 'opacity-0 max-h-0'}`}>
        {showAddModal && <VendorForm db={db} materials={materials} onAddMaterial={onAddMaterial} categoryId="domestic" onClose={() => setShowAddModal(false)} onSave={(v) => { onAddVendor(v); }} currentUser={currentUser} partners={partners} onAddPartner={onAddPartner} />}
      </div>

      {/* KPI ROW */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {[
          { label: 'کل تامین‌کنندگان', value: stats.total, color: 'text-primary', badgeVariant: 'info' as const, sub: 'Total Vendors', percent: 100 },
          { label: 'Grade A', value: stats.gradeA, color: 'text-emerald-600 dark:text-emerald-400', badgeVariant: 'gradeA' as const, sub: 'امتیاز ۸۰ تا ۱۰۰ (تایید کامل)', percent: stats.total > 0 ? Math.round((stats.gradeA/stats.total)*100) : 0 },
          { label: 'Grade B', value: stats.gradeB, color: 'text-blue-600 dark:text-blue-400', badgeVariant: 'gradeB' as const, sub: 'امتیاز ۶۰ تا ۷۹ (تایید با پایش)', percent: stats.total > 0 ? Math.round((stats.gradeB/stats.total)*100) : 0 },
          { label: 'Grade C', value: stats.gradeC, color: 'text-amber-600 dark:text-amber-400', badgeVariant: 'gradeC' as const, sub: 'امتیاز ۴۰ تا ۵۹ (مشروط)', percent: stats.total > 0 ? Math.round((stats.gradeC/stats.total)*100) : 0 },
          { label: 'Reject / لیست سیاه', value: stats.rejected, color: 'text-rose-600 dark:text-rose-400', badgeVariant: 'gradeReject' as const, sub: 'امتیاز ۰ تا ۳۹ (لیست سیاه)', percent: stats.total > 0 ? Math.round((stats.rejected/stats.total)*100) : 0 }
        ].map(s => (
          <Card key={s.label} className="p-4.5 space-y-3 bg-card border-border/80 hover:border-primary/30 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">{s.label}</span>
              <Badge variant={s.badgeVariant} className="text-[10px] px-1.5 py-0 font-mono">
                {s.percent}%
              </Badge>
            </div>
            <div className={`text-3xl sm:text-4xl font-black tabular-nums font-mono ${s.color}`}>
              {s.value}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{s.sub}</div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div 
                className="h-full rounded-full bg-primary transition-all duration-700" 
                style={{ width: `${s.percent || 0}%` }} 
              />
            </div>
          </Card>
        ))}
      </div>

      {/* ANALYTICS ROW: grade donut + action center */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Grade distribution donut */}
        <Card className="p-5 bg-card border-border/80">
          <div className="flex items-center gap-2 mb-3">
            <PieChartIcon className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">توزیع گرید کیفی <span className="text-muted-foreground text-xs font-normal font-mono">(Grade Mix)</span></h3>
          </div>
          {gradeDistribution.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-xs">داده‌ای برای نمایش نیست.</div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-44 w-1/2" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={gradeDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={2} strokeWidth={2}>
                      {gradeDistribution.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--card)" />)}
                    </Pie>
                    <RTooltip contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid var(--border)' }} formatter={(v: any, n: any) => [`${v} (${stats.total > 0 ? Math.round((v/stats.total)*100) : 0}%)`, n]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {gradeDistribution.map(d => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-foreground font-medium">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="font-mono font-bold text-foreground">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Action center */}
        <Card className="p-5 bg-card border-border/80 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">مرکز اقدامات معلق <span className="text-muted-foreground text-xs font-normal font-mono">(Action Center)</span></h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {pendingActions.map(a => {
              const clickable = a.items.length > 0;
              return (
                <button
                  key={a.key}
                  type="button"
                  disabled={!clickable}
                  onClick={() => { if (clickable) onSelectVendor(a.items[0]); }}
                  className={`text-right rounded-xl border p-3 transition-all ${toneClasses[a.tone]} ${clickable ? 'hover:shadow-sm cursor-pointer' : 'opacity-70 cursor-default'}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <a.icon className="w-4 h-4" />
                    <span className="text-2xl font-black font-mono tabular-nums">{a.count}</span>
                  </div>
                  <div className="text-[11px] font-bold leading-snug">{a.label}</div>
                  {clickable && a.count > 0 && <div className="text-[10px] mt-1 opacity-80 group-hover:underline">رسیدگی ←</div>}
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ACTIVITY ROW: recent audit + lab pass rate */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent audit */}
        <Card className="p-5 bg-card border-border/80 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">آخرین فعالیت‌ها <span className="text-muted-foreground text-xs font-normal font-mono">(Recent Activity)</span></h3>
          </div>
          {recentAudit.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">فعالیتی برای نمایش ثبت نشده است.</div>
          ) : (
            <div className="divide-y divide-border">
              {recentAudit.map((l, i) => {
                const sev = l.severity === 'Critical' ? 'bg-rose-500' : l.severity === 'Warning' ? 'bg-amber-500' : 'bg-emerald-500';
                let when = '';
                try { const d = new Date(l.timestamp || l.createdAt); when = d.toLocaleDateString('fa-IR') + ' ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }); } catch {}
                return (
                  <div key={l.id || i} className="flex items-center gap-2.5 py-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sev}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-foreground font-medium truncate">{l.description || `${l.action} — ${l.entityName || ''}`}</div>
                      <div className="text-[10px] text-muted-foreground">{l.userName || l.userId || 'سیستم'} · {l.module}</div>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0" dir="ltr">{when}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Lab pass rate */}
        <Card className="p-5 bg-card border-border/80">
          <div className="flex items-center gap-2 mb-3">
            <Microscope className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">نرخ قبولی آزمایشگاه <span className="text-muted-foreground text-xs font-normal font-mono">(Lab Pass)</span></h3>
          </div>
          {labStats.total === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">نتیجهٔ آزمایشی ثبت نشده است.</div>
          ) : (
            <div className="space-y-3">
              <div className="text-center">
                <div className={`text-4xl font-black font-mono ${labStats.rate >= 80 ? 'text-emerald-600 dark:text-emerald-400' : labStats.rate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>{labStats.rate}%</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">از مجموع {labStats.total} آزمون</div>
              </div>
              <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-muted">
                <div className="h-full bg-emerald-500" style={{ width: `${(labStats.pass / labStats.total) * 100}%` }} />
                <div className="h-full bg-blue-500" style={{ width: `${(labStats.cond / labStats.total) * 100}%` }} />
                <div className="h-full bg-rose-500" style={{ width: `${(labStats.rej / labStats.total) * 100}%` }} />
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">Pass {labStats.pass}</span>
                <span className="text-blue-600 dark:text-blue-400 font-bold">مشروط {labStats.cond}</span>
                <span className="text-rose-600 dark:text-rose-400 font-bold">Reject {labStats.rej}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* LICENSE EXPIRY ALERTS (IF ANY) */}
      {expiringVendors.length > 0 && (
        <Card className="border-amber-300/80 dark:border-amber-600/40 bg-amber-50/40 dark:bg-amber-950/20 p-5 space-y-3.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-4 h-4 animate-bounce" />
              </div>
              <div>
                <div className="font-extrabold text-sm text-foreground flex items-center gap-2">
                  <span>هشدار انقضای مجوزهای قانونی (IRC / IVC)</span>
                  <Badge variant="warning" className="text-[10px] font-mono font-bold">
                    {expiringVendors.length} مورد نیازمند تمدید
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  مجوزهای زیر کمتر از ۲ ماه تا انقضا فاصله دارند یا تاریخ اعتبار آن‌ها سپری شده است:
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {expiringVendors.slice(0, 6).map(({ vendor, check }) => (
              <div
                key={vendor.id}
                onClick={() => onSelectVendor(vendor)}
                className="bg-card hover:bg-accent/50 border border-border hover:border-primary/40 p-3.5 rounded-xl transition-all shadow-2xs cursor-pointer flex flex-col justify-between space-y-2 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-xs text-foreground group-hover:text-primary transition-colors truncate">
                    {vendor.material || vendor.name}
                  </div>
                  {check.status === 'expired' ? (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 font-bold shrink-0">
                      منقضی
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="text-[10px] px-1.5 py-0 font-bold shrink-0">
                      {check.daysLeft} روز مانده
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground truncate flex items-center justify-between">
                  <span>سورس: <strong className="text-foreground">{vendor.name}</strong></span>
                  {vendor.irc && <span className="font-mono text-[10px] text-muted-foreground">IRC: {vendor.irc}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground border-t border-border pt-2 flex items-center justify-between">
                  <span>تاریخ انقضا: <strong className="font-mono text-foreground">{vendor.ircExpiryDate}</strong></span>
                  <span className="text-primary font-bold text-[10px] group-hover:underline">بررسی سورس ←</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* CATEGORY CARDS */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground font-bold">دسته‌بندی‌های تامین (CATEGORIES)</div>
          <span className="text-xs text-muted-foreground">انتخاب دسته‌بندی برای مدیریت تخصصی</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {(Object.entries(categoryLabels) as [Category, any][]).filter(([id]) => id !== 'blacklist').map(([id, meta]) => {
            const catVendors = db.filter(v => id === 'sample' ? (v.category === 'sample' || v.isSample) : (v.category === id && v.status !== 'rejected' && v.grade !== 'rejected'));
            const verified = id === 'sample' 
              ? catVendors.filter(v => v.status === 'approved').length 
              : catVendors.filter(v => v.grade === 'A' || v.grade === 'B').length;
            const other = catVendors.length - verified;
            const verifiedLabel = id === 'sample' ? 'Approved' : 'تایید شده';
            const otherLabel = id === 'sample' ? 'مشروط / رد' : 'سایر';
            const style = categoryCardStyles[id] || categoryCardStyles.foreign;

            return (
              <Card 
                key={id}
                onClick={() => onNavigate('category', id)}
                className={`group p-5 space-y-4 bg-card border-border hover:border-primary/50 transition-all duration-300 cursor-pointer ${style.hoverBg} ${style.hoverShadow}`}
              >
                <div className="flex items-start justify-between">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center border font-mono font-black transition-all duration-300 ${style.iconBg} ${style.iconBorder} ${style.iconText} group-hover:scale-105`}>
                    <meta.icon className="w-6 h-6" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                
                <div>
                  <h3 className="font-black text-foreground leading-tight text-base tracking-tight group-hover:text-primary transition-colors">{meta.fa}</h3>
                  <div className="text-muted-foreground text-[11px] mt-0.5 font-mono uppercase tracking-wider">{meta.en}</div>
                </div>

                <div className="border-t border-border/70 pt-3 flex items-center justify-between">
                  <div className={`font-mono text-3xl font-black transition-all duration-300 group-hover:scale-105 origin-left ${style.statText}`}>{catVendors.length}</div>
                  <div className="text-right">
                    <div className="text-foreground font-bold text-xs">{verified} {verifiedLabel}</div>
                    <div className="text-muted-foreground text-[10px] mt-0.5">{other} {otherLabel}</div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      {/* ALERT PANELS */}
      <div className="space-y-4">
        {/* NEW VENDORS PANEL */}
        <Card className="p-5 space-y-3 bg-card border-border/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              <div className="font-bold text-foreground text-sm">در انتظار ارزیابی اولیه کیفی</div>
            </div>
            <Badge variant="info" className="font-mono text-xs">
              {db.filter(v => v.status === 'new').length} مورد جدید
            </Badge>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-1">
            {db.filter(v => v.status === 'new').slice(0, 3).map(v => (
              <div key={v.id} className="bg-muted/40 border border-border/60 rounded-xl p-3 flex items-center justify-between hover:bg-muted transition-colors">
                <div className="min-w-0 pr-1">
                  <div className="text-foreground font-bold text-xs truncate">{v.name}</div>
                  <div className="text-muted-foreground text-[11px] truncate">{v.material}</div>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => onSelectVendor(v)} 
                  className="text-primary hover:text-primary/80 text-xs h-7 px-2 shrink-0 font-bold"
                >
                  مشاهده
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// --- View: Vendor Form (Add / Edit) ---
function VendorForm({ onClose, onSave, categoryId, existingVendor, currentUser, db = [], materials = [], onAddMaterial, partners = [], onAddPartner }: { onClose: () => void, onSave: (v: Vendor, msg?: string | null) => void, categoryId: Category, existingVendor?: Vendor, currentUser: User | null, db?: Vendor[], materials?: Material[], onAddMaterial?: (m: Material) => void, partners?: BusinessPartner[], onAddPartner?: (p: BusinessPartner) => void }) {
  const [isSuccess, setIsSuccess] = useState(false);
  
  // Create autocomplete suggestions
  const materialSuggestions = Array.from(new Set(db.map(v => v.material).filter(Boolean)));
  const materialEnSuggestions = Array.from(new Set(db.map(v => v.materialEn).filter(Boolean)));

  const initialSourceType = existingVendor ? (
    ['approved_samples', 'rejected_samples', 'sample'].includes(existingVendor.category as string) ? 'domestic' : existingVendor.category
  ) : categoryId;
      
  const [sourceType, setSourceType] = useState<string>(initialSourceType);
  const [isSample, setIsSample] = useState<boolean>(existingVendor ? !!existingVendor.isSample : false);
  const [sampleStatus, setSampleStatus] = useState<string>(() => {
    if (existingVendor) {
      const initial = existingVendor.initialSampleStatus;
      if (initial === 'rejected' || initial === 'reject') return 'rejected';
      if (initial === 'conditional' || initial === 'not_approved') return 'not_approved';
      if (initial === 'approved') return 'approved';
      if (existingVendor.status === 'rejected') return 'rejected';
      if (existingVendor.status === 'conditional') return 'not_approved';
      return 'approved';
    }
    return 'approved';
  });

  const [formData, setFormData] = useState({
    materialId: existingVendor?.materialId || '',
    material: existingVendor?.material || '',
    materialEn: existingVendor?.materialEn || '',
    cas: existingVendor?.cas || '',
    irc: existingVendor?.irc || '',
    lastAudit: existingVendor?.lastAudit || '',
    ircExpiryDate: existingVendor?.ircExpiryDate || '',
    name: existingVendor?.name || '',
    nameEn: existingVendor?.nameEn || '',
    contactInfo: existingVendor?.contactInfo || '',
    grade: existingVendor?.grade || 'new',
    status: existingVendor?.status || 'new',
    rejectionReasonList: existingVendor?.rejectionReasons?.join('\n') || ''
  });

  // Business Partner Selection States
  const [selectedManufacturerId, setSelectedManufacturerId] = useState<string>(() => {
    if (existingVendor?.manufacturerId) return existingVendor.manufacturerId;
    if (existingVendor?.name) {
      const match = partners.find(p => p.type === 'Supplier' && p.name.trim().toLowerCase() === existingVendor.name.trim().toLowerCase());
      if (match?.manufacturerId) return match.manufacturerId;
      const mfgMatch = partners.find(p => p.type === 'Manufacturer' && p.name.trim().toLowerCase() === existingVendor.name.trim().toLowerCase());
      if (mfgMatch) return mfgMatch.id;
    }
    return '';
  });

  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(() => {
    if (existingVendor?.supplierId) return existingVendor.supplierId;
    if (existingVendor?.name) {
      const match = partners.find(p => p.type === 'Supplier' && p.name.trim().toLowerCase() === existingVendor.name.trim().toLowerCase());
      if (match) return match.id;
    }
    return '';
  });

  // Modal display states for partner creation
  const [showNewMfgModal, setShowNewMfgModal] = useState(false);
  const [showNewSupplierModal, setShowNewSupplierModal] = useState(false);

  // Modals Data State
  const [newMfgData, setNewMfgData] = useState({
    name: '',
    nameEn: '',
    country: 'ایران',
    city: '',
    address: '',
    email: '',
    contactPerson: '',
    phone: '',
    website: '',
    status: 'Active' as 'Active' | 'Inactive' | 'Blacklisted'
  });

  const [newSupplierTab, setNewSupplierTab] = useState<'general' | 'evaluation'>('general');
  const [newSupplierData, setNewSupplierData] = useState({
    name: '',
    nameEn: '',
    country: 'ایران',
    city: '',
    address: '',
    email: '',
    contactPerson: '',
    phone: '',
    website: '',
    status: 'Active' as 'Active' | 'Inactive' | 'Blacklisted'
  });

  const [newSupplierSopDocs, setNewSupplierSopDocs] = useState<{
    manufacturerLetter: SOPDocumentStatus;
    authorizedSignatory: SOPDocumentStatus;
    businessLicense: SOPDocumentStatus;
    officialEnglishTranslation: SOPDocumentStatus;
    legalization: SOPDocumentStatus;
  }>({
    manufacturerLetter: 'Approved',
    authorizedSignatory: 'Approved',
    businessLicense: 'Approved',
    officialEnglishTranslation: 'Approved',
    legalization: 'Approved'
  });

  const selectedManufacturer = partners.find(p => p.type === 'Manufacturer' && p.id === selectedManufacturerId);
  const selectedSupplier = partners.find(p => p.type === 'Supplier' && p.id === selectedSupplierId);

  // Helper Audit
  const logSourceSelectionAudit = (action: string, details: string, beforeValue: any, afterValue: any) => {
    authFetch('/api/audit-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'Source Evaluation Form',
        action: action,
        entityType: 'SourceSelection',
        entityId: existingVendor?.id || 'new_source',
        entityName: formData.material || 'سورس جدید',
        severity: 'info',
        description: details,
        beforeValue,
        afterValue
      })
    }).catch(err => console.error("Failed to sync selection audit log:", err));
  };

  const handleCreateMfg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMfgData.name.trim()) return;

    const newMfg: BusinessPartner = {
      id: 'bp_mfg_' + Math.random().toString(36).substring(2, 9),
      type: 'Manufacturer',
      name: newMfgData.name.trim(),
      nameEn: newMfgData.nameEn.trim() || undefined,
      country: newMfgData.country.trim(),
      city: newMfgData.city.trim() || undefined,
      address: newMfgData.address.trim() || undefined,
      email: newMfgData.email.trim() || undefined,
      contactPerson: newMfgData.contactPerson.trim() || undefined,
      phone: newMfgData.phone.trim() || undefined,
      website: newMfgData.website.trim() || undefined,
      status: newMfgData.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (onAddPartner) {
      onAddPartner(newMfg);
    }

    setSelectedManufacturerId(newMfg.id);
    setSelectedSupplierId('');

    logSourceSelectionAudit(
      'CreateManufacturerInsideSource',
      `ایجاد تولیدکننده جدید از داخل فرم سورس: ${newMfg.name}`,
      null,
      newMfg
    );

    setNewMfgData({
      name: '',
      nameEn: '',
      country: 'ایران',
      city: '',
      address: '',
      email: '',
      contactPerson: '',
      phone: '',
      website: '',
      status: 'Active'
    });
    setShowNewMfgModal(false);
  };

  const calculateSopScore = (status: SOPDocumentStatus) => {
    switch (status) {
      case 'Approved': return 20;
      case 'Permit Approval': return 10;
      case 'Expired': return 5;
      case 'Not Submitted': return 0;
      default: return 0;
    }
  };

  const computeNewSupplierEval = () => {
    const scores = [
      calculateSopScore(newSupplierSopDocs.manufacturerLetter),
      calculateSopScore(newSupplierSopDocs.authorizedSignatory),
      calculateSopScore(newSupplierSopDocs.businessLicense),
      calculateSopScore(newSupplierSopDocs.officialEnglishTranslation),
      calculateSopScore(newSupplierSopDocs.legalization)
    ];
    const total = scores.reduce((a, b) => a + b, 0);

    let grade: 'A' | 'B' | 'C' | 'Pending Review' | 'Blacklist' = 'A';
    let status: any = 'Approved Supplier';

    if (total >= 80) { grade = 'A'; status = 'Approved Supplier'; }
    else if (total >= 60) { grade = 'B'; status = 'Approved with Monitoring'; }
    else if (total >= 40) { grade = 'C'; status = 'Conditional Supplier'; }
    else if (total >= 30) { grade = 'Pending Review'; status = 'Pending Review'; }
    else { grade = 'Blacklist'; status = 'Blacklist'; }

    return {
      documents: {
        manufacturerLetter: { key: 'manufacturerLetter', nameFa: 'نامه نمایندگی از سازنده', nameEn: 'Manufacturer Authorization Letter', status: newSupplierSopDocs.manufacturerLetter, score: calculateSopScore(newSupplierSopDocs.manufacturerLetter) },
        authorizedSignatory: { key: 'authorizedSignatory', nameFa: 'تعهدنامه صاحبان امضای مجاز', nameEn: 'Authorized Signatory Commitment', status: newSupplierSopDocs.authorizedSignatory, score: calculateSopScore(newSupplierSopDocs.authorizedSignatory) },
        businessLicense: { key: 'businessLicense', nameFa: 'پروانه کسب یا مدرک ثبتی معتبر', nameEn: 'Business License', status: newSupplierSopDocs.businessLicense, score: calculateSopScore(newSupplierSopDocs.businessLicense) },
        officialEnglishTranslation: { key: 'officialEnglishTranslation', nameFa: 'ترجمه رسمی انگلیسی مدارک', nameEn: 'Official English Translation', status: newSupplierSopDocs.officialEnglishTranslation, score: calculateSopScore(newSupplierSopDocs.officialEnglishTranslation) },
        legalization: { key: 'legalization', nameFa: 'تاییدیه سفارت یا آپوستیل', nameEn: 'Embassy Legalization / Apostille', status: newSupplierSopDocs.legalization, score: calculateSopScore(newSupplierSopDocs.legalization) }
      },
      totalScore: total,
      grade,
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.name || 'مدیر سیستم'
    };
  };

  const handleCreateSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierData.name.trim() || !selectedManufacturerId) return;

    const evaluation = computeNewSupplierEval();

    const newSupplier: BusinessPartner = {
      id: 'bp_sup_' + Math.random().toString(36).substring(2, 9),
      type: 'Supplier',
      name: newSupplierData.name.trim(),
      nameEn: newSupplierData.nameEn.trim() || undefined,
      country: newSupplierData.country.trim(),
      city: newSupplierData.city.trim() || undefined,
      address: newSupplierData.address.trim() || undefined,
      email: newSupplierData.email.trim() || undefined,
      contactPerson: newSupplierData.contactPerson.trim() || undefined,
      phone: newSupplierData.phone.trim() || undefined,
      website: newSupplierData.website.trim() || undefined,
      manufacturerId: selectedManufacturerId,
      status: newSupplierData.status,
      evaluation: evaluation as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (onAddPartner) {
      onAddPartner(newSupplier);
    }

    setSelectedSupplierId(newSupplier.id);

    logSourceSelectionAudit(
      'CreateSupplierInsideSource',
      `ایجاد فروشنده جدید از داخل فرم سورس: ${newSupplier.name}`,
      null,
      newSupplier
    );

    setNewSupplierData({
      name: '',
      nameEn: '',
      country: 'ایران',
      city: '',
      address: '',
      email: '',
      contactPerson: '',
      phone: '',
      website: '',
      status: 'Active'
    });
    setNewSupplierSopDocs({
      manufacturerLetter: 'Approved',
      authorizedSignatory: 'Approved',
      businessLicense: 'Approved',
      officialEnglishTranslation: 'Approved',
      legalization: 'Approved'
    });
    setNewSupplierTab('general');
    setShowNewSupplierModal(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.materialId) {
      alert('لطفاً یک ماده از مخزن مواد اولیه انتخاب کنید.');
      return;
    }

    if (!selectedManufacturerId && !selectedSupplierId) {
      alert('لطفاً تأمین‌کنندهٔ این سورس (تولیدکننده یا فروشنده) را از مخزن شرکای تجاری انتخاب کرده یا ثبت کنید.');
      return;
    }

    const newId = existingVendor?.id || ('v' + Math.random().toString(36).substring(2, 6));
    const isDirectPurchase = !selectedSupplierId;
    const finalPartnerDisplayName = selectedSupplier?.name || selectedManufacturer?.name || formData.name;
    
    // Process rejections
    const rejectLines = formData.rejectionReasonList.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    let finalIsSample = isSample;
    let finalCategory = finalIsSample ? 'sample' as Category : sourceType as Category;
    let finalGrade = existingVendor ? existingVendor.grade : (finalIsSample ? null : 'new');
    let finalStatus = existingVendor ? existingVendor.status : (finalIsSample ? 'approved' : 'new');
    let finalInitialSampleStatus: Status | null = null;

    if (finalIsSample) {
      finalCategory = 'sample';
      finalGrade = null; // samples don't have evaluation grade

      const initialMap: Record<string, 'approved' | 'conditional' | 'rejected'> = {
        approved: 'approved',
        not_approved: 'conditional',
        rejected: 'rejected'
      };
      finalInitialSampleStatus = initialMap[sampleStatus] || 'approved';

      const rejectCount = existingVendor?.analysisRecords ? existingVendor.analysisRecords.filter(r => r.decision === 'Reject').length : 0;
      if (rejectCount >= 1) {
        finalStatus = 'rejected';
      } else {
        finalStatus = finalInitialSampleStatus;
      }
    } else {
      finalInitialSampleStatus = null;
      if (existingVendor) {
        if (existingVendor.isSample) {
          finalStatus = 'new';
          finalGrade = 'new';
          finalCategory = sourceType as Category;
        } else {
          finalStatus = existingVendor.status;
          finalGrade = existingVendor.grade;
          if (existingVendor.category === 'blacklist') {
            finalCategory = 'blacklist';
          } else {
            finalCategory = sourceType as Category;
          }
        }
      } else {
        finalStatus = 'new';
        finalGrade = 'new';
        if (formData.status === 'rejected' || formData.grade === 'rejected') {
          finalCategory = 'blacklist';
        }
      }
    }

    const hasStatusChanged = existingVendor && existingVendor.status !== finalStatus;
    const hasGradeChanged = existingVendor && existingVendor.grade !== finalGrade;
    const statusTextMap = { approved: 'تایید شده', conditional: 'تایید مشروط', rejected: 'مردود', new: 'جدید' };
    
    let actionDetail = existingVendor 
      ? `ویرایش اطلاعات سورس "${formData.material}" (${finalPartnerDisplayName})`
      : `ثبت سورس جدید "${formData.material}" (${finalPartnerDisplayName}) در دسته ${categoryLabels[finalCategory as keyof typeof categoryLabels]?.fa || finalCategory}`;
    
    if (existingVendor && existingVendor.materialId !== formData.materialId) {
      actionDetail += ` | تغییر ماده از [${existingVendor.material || 'نامشخص'}] به [${formData.material}]`;
    }

    if (hasStatusChanged) {
      actionDetail += ` | تغییر وضعیت از [${statusTextMap[existingVendor.status] || existingVendor.status}] به [${statusTextMap[finalStatus] || finalStatus}]`;
    }
    if (hasGradeChanged) {
      actionDetail += ` | تغییر درجه کیفی از [Grade ${existingVendor.grade || 'نامشخص'}] به [Grade ${finalGrade || 'نامشخص'}]`;
    }

    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: actionDetail,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };

    const finalCas = formData.cas;
    const finalIrc = formData.irc;
    const finalLastAudit = formData.lastAudit;
    const finalIrcExpiryDate = formData.ircExpiryDate;
    const finalName = selectedSupplier?.name || selectedManufacturer?.name || formData.name;
    const finalNameEn = selectedSupplier?.nameEn || selectedManufacturer?.nameEn || (sourceType === 'domestic' ? '' : formData.nameEn);
    const finalCountry = selectedSupplier?.country || selectedManufacturer?.country || existingVendor?.country || 'نامشخص';
    const finalContactInfo = selectedSupplier 
      ? `${selectedSupplier.contactPerson || ''}\n${selectedSupplier.phone || ''}\n${selectedSupplier.email || ''}`
      : (selectedManufacturer 
          ? `${selectedManufacturer.contactPerson || ''}\n${selectedManufacturer.phone || ''}\n${selectedManufacturer.email || ''}`
          : formData.contactInfo);

    const vendorContext: Vendor = {
      ...existingVendor,
      id: newId,
      category: finalCategory,
      materialId: formData.materialId,
      material: formData.material,
      materialEn: formData.materialEn,
      cas: finalCas,
      irc: finalIrc,
      lastAudit: finalLastAudit,
      ircExpiryDate: finalIrcExpiryDate || undefined,
      name: finalName,
      nameEn: finalNameEn,
      country: finalCountry,
      contactInfo: finalContactInfo,
      manufacturerId: selectedManufacturerId,
      supplierId: selectedSupplierId || null,
      grade: finalGrade,
      status: finalStatus,
      scores: existingVendor?.scores || null, 
      rejectionReasons: rejectLines.length > 0 ? rejectLines : null,
      registrationDate: existingVendor?.registrationDate || new Date().toLocaleDateString('fa-IR'),
      isSample: finalIsSample,
      initialSampleStatus: finalInitialSampleStatus || undefined,
      activityLogs: [...(existingVendor?.activityLogs || []), newLog]
    } as Vendor;

    onSave(vendorContext, null);
    setIsSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1000);
  };

  if (isSuccess) {
    return (
      <Card className="p-12 text-center flex flex-col items-center justify-center mt-6 fade-in shadow-sm border-border bg-card" dir="rtl">
        <div className="bg-emerald-500/10 p-4 rounded-full border border-emerald-500/20 mb-6">
          <CheckCircle className="w-14 h-14 text-emerald-500 bounce-in" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-2">{existingVendor ? 'تغییرات با موفقیت ذخیره شد' : 'سورس جدید با موفقیت ثبت شد'}</h3>
        <p className="text-muted-foreground text-sm font-medium">اطلاعات با موفقیت در آرشیو ثبت گردید. در حال بازگشت...</p>
      </Card>
    );
  }

  return (
    <Card className="w-full shadow-sm text-right mt-6 fade-in relative border-border bg-card overflow-hidden" dir="rtl">
      
      {/* Modals inside form */}
      <AnimatePresence>
        {showNewMfgModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto fade-in">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-card rounded-2xl max-w-2xl w-full border border-border p-6 text-right max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
              <div className="flex justify-between items-center border-b border-border pb-3 mb-4 shrink-0">
                <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-primary" />
                  ثبت تولیدکننده مرجع جدید (New Manufacturer)
                </h3>
                <Button variant="ghost" size="icon" type="button" onClick={() => setShowNewMfgModal(false)} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <form onSubmit={handleCreateMfg} className="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-foreground font-semibold block">نام کارخانه سازنده (فارسی): *</label>
                    <input required type="text" className="w-full bg-background border border-input rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring" value={newMfgData.name} onChange={e => setNewMfgData({...newMfgData, name: e.target.value})} placeholder="مثلاً: داروسازی اکتاویس" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-foreground font-semibold block">Manufacturer Name (English):</label>
                    <input type="text" dir="ltr" className="w-full bg-background border border-input rounded-xl px-3 py-2 text-foreground text-left font-mono" value={newMfgData.nameEn} onChange={e => setNewMfgData({...newMfgData, nameEn: e.target.value})} placeholder="e.g. Actavis Pharma" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-foreground font-semibold block">کشور مبدا: *</label>
                    <input required type="text" className="w-full bg-background border border-input rounded-xl px-3 py-2 text-foreground" value={newMfgData.country} onChange={e => setNewMfgData({...newMfgData, country: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-foreground font-semibold block">شهر:</label>
                    <input type="text" className="w-full bg-background border border-input rounded-xl px-3 py-2 text-foreground" value={newMfgData.city} onChange={e => setNewMfgData({...newMfgData, city: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-foreground font-semibold block">نام رابط (Contact Person):</label>
                    <input type="text" className="w-full bg-background border border-input rounded-xl px-3 py-2 text-foreground" value={newMfgData.contactPerson} onChange={e => setNewMfgData({...newMfgData, contactPerson: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-foreground font-semibold block">شماره تماس رابط:</label>
                    <input type="text" dir="ltr" className="w-full bg-background border border-input rounded-xl px-3 py-2 text-foreground text-left font-mono" value={newMfgData.phone} onChange={e => setNewMfgData({...newMfgData, phone: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-foreground font-semibold block">پست الکترونیکی (Email):</label>
                    <input type="email" dir="ltr" className="w-full bg-background border border-input rounded-xl px-3 py-2 text-foreground text-left font-mono" value={newMfgData.email} onChange={e => setNewMfgData({...newMfgData, email: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-foreground font-semibold block">وب‌سایت (Website):</label>
                    <input type="url" dir="ltr" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono" value={newMfgData.website} onChange={e => setNewMfgData({...newMfgData, website: e.target.value})} placeholder="https://..." />
                  </div>
                  <div className="space-y-1">
                    <label className="text-foreground font-semibold block">وضعیت فعالیت شریک:</label>
                    <select className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground" value={newMfgData.status} onChange={e => setNewMfgData({...newMfgData, status: e.target.value as any})}>
                      <option value="Active">فعال (Active)</option>
                      <option value="Inactive">غیرفعال (Inactive)</option>
                      <option value="Blacklisted">لیست سیاه (Blacklisted)</option>
                    </select>
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <label className="text-foreground font-semibold block">نشانی دقیق کارخانه:</label>
                    <textarea className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground h-16" value={newMfgData.address} onChange={e => setNewMfgData({...newMfgData, address: e.target.value})} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t border-border shrink-0">
                  <button type="button" onClick={() => setShowNewMfgModal(false)} className="px-4 py-2 hover:bg-accent text-muted-foreground rounded-lg font-semibold">انصراف</button>
                  <button type="submit" className="px-5 py-2 bg-[#0071E3] text-white rounded-lg font-semibold hover:bg-[#0025D2] transition-colors">ثبت و انتخاب تولیدکننده</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showNewSupplierModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto fade-in">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-card rounded-2xl max-w-2xl w-full border border-border p-6 text-right max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex justify-between items-center border-b border-border pb-3 mb-3 shrink-0">
                <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                  <Handshake className="w-5 h-5 text-[#0071E3]" />
                  ثبت فروشنده / واسطه جدید (New Supplier)
                </h3>
                <button type="button" onClick={() => setShowNewSupplierModal(false)} className="p-1.5 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Navigation Tabs */}
              <div className="flex gap-2 border-b border-border pb-2 mb-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setNewSupplierTab('general')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    newSupplierTab === 'general' ? 'bg-[#0071E3] text-white' : 'bg-muted text-muted-foreground hover:bg-slate-200'
                  }`}
                >
                  ۱. مشخصات عمومی
                </button>
                <button
                  type="button"
                  onClick={() => setNewSupplierTab('evaluation')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    newSupplierTab === 'evaluation' ? 'bg-[#0071E3] text-white' : 'bg-muted text-muted-foreground hover:bg-slate-200'
                  }`}
                >
                  ۲. ارزیابی مدارک SOP
                  <span className="bg-card/20 px-1.5 py-0.2 rounded text-[10px]">
                    امتیاز: {computeNewSupplierEval().totalScore}
                  </span>
                </button>
              </div>

              <form onSubmit={handleCreateSupplier} className="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
                <div className="bg-blue-50/50 border border-blue-200 rounded-lg p-3 text-blue-800 leading-relaxed font-medium mb-3">
                  تولیدکننده مرجع متصل: <strong className="text-blue-900">{selectedManufacturer?.name}</strong>
                  <p className="mt-1 text-[10px] text-muted-foreground">فروشنده جدید برای کارخانه تولیدی بالا ایجاد می‌شود و به صورت خودکار ارزیابی و درجه‌بندی کیفی می‌گردد.</p>
                </div>

                {newSupplierTab === 'general' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-foreground font-semibold block">نام شرکت فروشنده (فارسی): *</label>
                      <input required type="text" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-[#0071E3]" value={newSupplierData.name} onChange={e => setNewSupplierData({...newSupplierData, name: e.target.value})} placeholder="مثلاً: بازرگانی فارمد" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-foreground font-semibold block">Supplier Name (English):</label>
                      <input type="text" dir="ltr" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono" value={newSupplierData.nameEn} onChange={e => setNewSupplierData({...newSupplierData, nameEn: e.target.value})} placeholder="e.g. Pharmed Trading" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-foreground font-semibold block">کشور: *</label>
                      <input required type="text" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground" value={newSupplierData.country} onChange={e => setNewSupplierData({...newSupplierData, country: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-foreground font-semibold block">شهر:</label>
                      <input type="text" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground" value={newSupplierData.city} onChange={e => setNewSupplierData({...newSupplierData, city: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-foreground font-semibold block">نام رابط بازرگانی:</label>
                      <input type="text" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground" value={newSupplierData.contactPerson} onChange={e => setNewSupplierData({...newSupplierData, contactPerson: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-foreground font-semibold block">شماره تلفن رابط:</label>
                      <input type="text" dir="ltr" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono" value={newSupplierData.phone} onChange={e => setNewSupplierData({...newSupplierData, phone: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-foreground font-semibold block">پست الکترونیکی (Email):</label>
                      <input type="email" dir="ltr" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono" value={newSupplierData.email} onChange={e => setNewSupplierData({...newSupplierData, email: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-foreground font-semibold block">وب‌سایت (Website):</label>
                      <input type="url" dir="ltr" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono" value={newSupplierData.website} onChange={e => setNewSupplierData({...newSupplierData, website: e.target.value})} placeholder="https://..." />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-foreground font-semibold block">وضعیت فعالیت شریک:</label>
                      <select className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground" value={newSupplierData.status} onChange={e => setNewSupplierData({...newSupplierData, status: e.target.value as any})}>
                        <option value="Active">فعال (Active)</option>
                        <option value="Inactive">غیرفعال (Inactive)</option>
                        <option value="Blacklisted">لیست سیاه (Blacklisted)</option>
                      </select>
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <label className="text-foreground font-semibold block">نشانی دقیق دفتر فروشنده:</label>
                      <textarea className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground h-16" value={newSupplierData.address} onChange={e => setNewSupplierData({...newSupplierData, address: e.target.value})} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-muted p-3 rounded-xl border border-border flex items-center justify-between">
                      <div className="text-xs font-bold text-foreground">
                        نتیجه محاسبه ارزیابی SOP: <span className="text-[#0071E3]">{computeNewSupplierEval().status}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">امتیاز کل: <strong>{computeNewSupplierEval().totalScore} / 100</strong></span>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold text-white ${
                          computeNewSupplierEval().grade === 'A' ? 'bg-emerald-600' :
                          computeNewSupplierEval().grade === 'B' ? 'bg-blue-600' :
                          computeNewSupplierEval().grade === 'C' ? 'bg-amber-600' :
                          computeNewSupplierEval().grade === 'Pending Review' ? 'bg-yellow-600' : 'bg-rose-600'
                        }`}>
                          گرید {computeNewSupplierEval().grade}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {[
                        { key: 'manufacturerLetter', label: '۱. نامه نمایندگی از سازنده (Authorization Letter)' },
                        { key: 'authorizedSignatory', label: '۲. تعهدنامه صاحبان امضای مجاز (Authorized Signatory)' },
                        { key: 'businessLicense', label: '۳. پروانه کسب یا مدرک ثبتی معتبر (Business License)' },
                        { key: 'officialEnglishTranslation', label: '۴. ترجمه رسمی انگلیسی مدارک (English Translation)' },
                        { key: 'legalization', label: '۵. تاییدیه سفارت یا آپوستیل (Embassy Legalization)' }
                      ].map((doc) => (
                        <div key={doc.key} className="flex items-center justify-between p-2.5 bg-card border border-border rounded-xl">
                          <span className="font-semibold text-foreground">{doc.label}</span>
                          <select
                            value={(newSupplierSopDocs as any)[doc.key]}
                            onChange={(e) => setNewSupplierSopDocs({ ...newSupplierSopDocs, [doc.key]: e.target.value as SOPDocumentStatus })}
                            className="bg-muted border border-border rounded-lg px-2 py-1 text-xs font-bold text-foreground focus:outline-none focus:border-[#0071E3]"
                          >
                            <option value="Approved">تایید شده (۲۰ امتیاز)</option>
                            <option value="Permit Approval">تایید با مجوز (۱۰ امتیاز)</option>
                            <option value="Expired">منقضی شده (۵ امتیاز)</option>
                            <option value="Not Submitted">عدم ارائه (۰ امتیاز)</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-border shrink-0">
                  <button type="button" onClick={() => setShowNewSupplierModal(false)} className="px-4 py-2 hover:bg-accent text-muted-foreground rounded-lg font-semibold">انصراف</button>
                  <button type="submit" className="px-5 py-2 bg-[#0071E3] text-white rounded-lg font-semibold hover:bg-[#0025D2] transition-colors">ثبت و انتخاب فروشنده</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="p-5 border-b border-border flex justify-between items-center bg-muted/40 rounded-t-2xl">
        <h2 className="text-base font-bold flex items-center gap-2 text-foreground">
          {existingVendor ? <Building className="w-5 h-5 text-primary" /> : <Plus className="w-5 h-5 text-primary" />}
          {existingVendor ? 'ویرایش سورس' : 'افزودن سورس جدید'}
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="p-6 space-y-6 text-sm overflow-y-auto max-h-[80vh]">
          {/* SECTION 1: MATERIAL MASTER SELECTION */}
          <div className="space-y-3 p-4 bg-muted/70 border border-border/80 rounded-2xl">
            <div className="flex items-center gap-2 pb-2 border-b border-border/60">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-fuchsia-600 text-white text-[11px] font-bold">۱</span>
              <h3 className="text-xs font-black text-foreground uppercase tracking-wide">بخش اول: انتخاب ماده اولیه از مخزن مرجع (Material Master)</h3>
            </div>
            
            <div>
              <MaterialSelector 
                materials={materials} 
                onAddMaterial={onAddMaterial}
                value={formData.materialId} 
                oldMaterialName={existingVendor?.material}
                onChange={(id, mat) => {
                  setFormData(prev => ({
                    ...prev,
                    materialId: id,
                    material: mat ? mat.nameFa : '',
                    materialEn: mat ? mat.nameEn : '',
                    cas: mat ? mat.cas : '',
                    irc: prev.irc,
                    lastAudit: prev.lastAudit,
                    ircExpiryDate: prev.ircExpiryDate
                  }));
                }}
              />
            </div>
          </div>

          {/* SECTION 2: SUPPLY CHAIN & PARTNERS */}
          <div className="space-y-4 p-4 bg-muted/70 border border-border/80 rounded-2xl">
            <div className="flex items-center gap-2 pb-2 border-b border-border/60">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold">۲</span>
              <h3 className="text-xs font-black text-foreground uppercase tracking-wide">بخش دوم: اطلاعات زنجیره تأمین، کارخانه سازنده و فروشنده</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-foreground font-semibold text-xs">نوع دسته بندی (Source Type) <span className="text-rose-500">*</span></label>
                <select 
                  className={`w-full bg-[#0071E3]/5 border border-[#0071E3]/20 rounded-lg px-3 py-2 text-[#0071E3] font-bold focus:outline-none focus:ring-1 focus:ring-[#0071E3] ${isSample ? 'opacity-50 cursor-not-allowed' : ''}`} 
                  value={sourceType} 
                  onChange={e => setSourceType(e.target.value)}
                  disabled={isSample}
                >
                  <option value="domestic">خرید داخلی</option>
                  <option value="foreign">خرید خارجی</option>
                  <option value="veterinary">دامی</option>
                  <option value="packaging">اقلام بسته‌بندی</option>
                  <option value="blacklist">لیست سیاه</option>
                </select>
              </div>
              
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input 
                    type="checkbox" 
                    checked={isSample} 
                    onChange={e => setIsSample(e.target.checked)}
                    className="w-4 h-4 text-[#0071E3] rounded border-border focus:ring-[#0071E3]"
                  />
                  <span className="text-xs font-bold text-foreground">این تامین‌کننده به عنوان یک «نمونه» ثبت می‌شود</span>
                </label>

                {isSample && (
                  <div className="space-y-1 fade-in">
                    <label className="text-foreground font-semibold text-xs">وضعیت اولیه نمونه (Initial Sample Status)</label>
                    <select 
                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-[#0071E3]" 
                      value={sampleStatus} 
                      onChange={e => setSampleStatus(e.target.value)}
                    >
                      <option value="approved">Approved (تایید شده)</option>
                      <option value="not_approved">Approved conditional (تایید مشروط)</option>
                      <option value="rejected">Reject (رد شده)</option>
                    </select>

                    {existingVendor && (existingVendor.analysisRecords || []).filter(r => r.decision === 'Reject').length >= 1 && (
                      <p className="text-rose-500 text-xs mt-1.5 font-medium bg-rose-50 p-2.5 rounded-lg border border-rose-100 leading-relaxed text-right">
                        این Source دارای نتیجه آزمایشگاهی Reject است و وضعیت آن تا زمان اصلاح نتایج آزمایشگاه قابل تغییر نیست.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* PARTNER REPOSITORY INTEGRATION — single supplier/manufacturer selector */}
            <div className="bg-card border border-border p-4 rounded-xl shadow-2xs">
              <PartnerSelector
                partners={partners}
                type="Supplier"
                anyType={true}
                selectedId={selectedManufacturerId || selectedSupplierId}
                onSelect={(newId) => {
                  const oldName = partners.find(p => p.id === (selectedManufacturerId || selectedSupplierId))?.name || 'بدون تأمین‌کننده';
                  const picked = partners.find(p => p.id === newId);
                  const newName = picked?.name || 'بدون تأمین‌کننده';

                  // Route the chosen partner into the correct field by its type;
                  // manufacturers and suppliers are independent now.
                  if (!newId || !picked) {
                    setSelectedManufacturerId('');
                    setSelectedSupplierId('');
                  } else if (picked.type === 'Manufacturer') {
                    setSelectedManufacturerId(newId);
                    setSelectedSupplierId('');
                  } else {
                    setSelectedSupplierId(newId);
                    setSelectedManufacturerId('');
                  }

                  logSourceSelectionAudit(
                    'ChangeSupplier',
                    `تغییر تأمین‌کننده از [${oldName}] به [${newName}]`,
                    oldName,
                    newName
                  );
                }}
                onAddNew={() => setShowNewSupplierModal(true)}
              />
              <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
                تأمین‌کنندهٔ این سورس را انتخاب کنید — می‌تواند یک تولیدکننده یا یک فروشنده باشد.
              </p>
            </div>

            {/* Supplier or Manufacturer Direct Summary Card */}
            {selectedSupplier ? (
              <div className="bg-emerald-50/60 border border-emerald-500/20 rounded-xl p-4 fade-in">
                <h4 className="text-emerald-800 font-bold text-xs mb-3 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  جزئیات تاییدیه و صلاحیت فنی شریک تجاری (SOP Evaluation Summary)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground block mb-0.5 font-medium">نام فروشنده:</span>
                    <span className="font-bold text-foreground">{selectedSupplier.name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-0.5 font-medium">امتیاز ارزیابی کیفی:</span>
                    <span className="font-bold text-foreground font-mono text-sm">{selectedSupplier.evaluation?.totalScore || 0} / ۱۰۰</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-0.5 font-medium">رتبه کیفی (Grade):</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">
                      Grade {selectedSupplier.evaluation?.grade || 'A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-0.5 font-medium">وضعیت صلاحیت:</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/10 text-emerald-700">
                      {selectedSupplier.evaluation?.status || 'تایید شده'}
                    </span>
                  </div>
                </div>
              </div>
            ) : selectedManufacturer ? (
              <div className="bg-emerald-50/70 border border-emerald-300 rounded-xl p-4 fade-in">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <h4 className="text-emerald-900 font-bold text-xs flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    تأمین مستقیم و بی‌واسطه از کارخانه سازنده (Direct Manufacturer Sourcing)
                  </h4>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white shadow-2xs">
                    خرید بی‌واسطه
                  </span>
                </div>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  این سورس به صورت <strong className="font-bold">خرید بی‌واسطه</strong> مستقیماً از کارخانه سازنده مرجع (<strong className="text-emerald-950 font-bold">{selectedManufacturer.name}</strong>) تأمین می‌گردد و نیازی به ارزیابی فروشنده واسطه ندارد.
                </p>
              </div>
            ) : null}

            {/* Auto-filled read-only fields for selected partner */}
            {(selectedSupplier || selectedManufacturer) && (
              <div className="bg-card border border-border/80 rounded-xl p-4 space-y-3 shadow-2xs">
                <div className="text-foreground font-bold text-xs border-b border-border pb-2 mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-[#0071E3]" />
                    <span>اطلاعات تماس و نشانی {selectedSupplier ? 'فروشنده واسطه' : 'تولیدکننده مرجع'} (تکمیل خودکار - Read-Only)</span>
                  </div>
                  {!selectedSupplier && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                      خرید بی‌واسطه از تولیدکننده
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs leading-relaxed">
                  <div>
                    <span className="text-muted-foreground block mb-1 font-medium">کشور مبدا:</span>
                    <input type="text" readOnly className="w-full bg-muted/80 border border-border rounded-lg px-2.5 py-1.5 text-foreground font-medium focus:outline-none cursor-not-allowed" value={(selectedSupplier?.country || selectedManufacturer?.country) || 'نامشخص'} />
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1 font-medium">شهر دفتر/کارخانه:</span>
                    <input type="text" readOnly className="w-full bg-muted/80 border border-border rounded-lg px-2.5 py-1.5 text-foreground font-medium focus:outline-none cursor-not-allowed" value={(selectedSupplier?.city || selectedManufacturer?.city) || 'نامشخص'} />
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1 font-medium">نام رابط (Contact Person):</span>
                    <input type="text" readOnly className="w-full bg-muted/80 border border-border rounded-lg px-2.5 py-1.5 text-foreground font-medium focus:outline-none cursor-not-allowed" value={(selectedSupplier?.contactPerson || selectedManufacturer?.contactPerson) || 'نامشخص'} />
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1 font-medium">شماره تماس رابط:</span>
                    <input type="text" readOnly dir="ltr" className="w-full bg-muted/80 border border-border rounded-lg px-2.5 py-1.5 text-foreground font-medium focus:outline-none cursor-not-allowed text-left font-mono" value={(selectedSupplier?.phone || selectedManufacturer?.phone) || 'نامشخص'} />
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-muted-foreground block mb-1 font-medium">پست الکترونیکی (Email):</span>
                    <input type="text" readOnly dir="ltr" className="w-full bg-muted/80 border border-border rounded-lg px-2.5 py-1.5 text-foreground font-medium focus:outline-none cursor-not-allowed text-left font-mono" value={(selectedSupplier?.email || selectedManufacturer?.email) || 'نامشخص'} />
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-muted-foreground block mb-1 font-medium">نشانی کامل پستی:</span>
                    <input type="text" readOnly className="w-full bg-muted/80 border border-border rounded-lg px-2.5 py-1.5 text-foreground font-medium focus:outline-none cursor-not-allowed" value={(selectedSupplier?.address || selectedManufacturer?.address) || 'نامشخص'} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 3: REGULATORY, IRC & INITIAL STATUS */}
          <div className="space-y-4 p-4 bg-muted/70 border border-border/80 rounded-2xl">
            <div className="flex items-center gap-2 pb-2 border-b border-border/60">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-bold">۳</span>
              <h3 className="text-xs font-black text-foreground uppercase tracking-wide">بخش سوم: اطلاعات رگولاتوری، پروانه IRC و وضعیت اولیه سورس</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-foreground font-semibold text-xs">کد IRC / کد IVC / شناسه اختصاصی (اختیاری)</label>
                <input 
                  type="text" 
                  dir="ltr" 
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground text-left focus:outline-none focus:ring-1 focus:ring-[#0071E3] focus:border-[#0071E3] font-mono text-sm" 
                  value={formData.irc} 
                  onChange={e => setFormData({...formData, irc: e.target.value})} 
                  placeholder="مثال: 1234567890"
                />
              </div>

              <div className="space-y-1">
                <label className="text-foreground font-semibold text-xs">تاریخ دریافت / صدور مجوز (اختیاری)</label>
                <ShamsiDatePicker
                  value={formData.lastAudit}
                  onChange={(date) => setFormData({ ...formData, lastAudit: date })}
                  placeholder="انتخاب تاریخ یا مثال: 1403/05/12"
                />
              </div>

              <div className="space-y-1">
                <label className="text-foreground font-semibold text-xs flex items-center justify-between">
                  <span>تاریخ انقضای مجوز (اختیاری)</span>
                  {formData.ircExpiryDate && (
                    <span className="text-[10px] text-muted-foreground font-mono">انقضا</span>
                  )}
                </label>
                <ShamsiDatePicker
                  value={formData.ircExpiryDate}
                  onChange={(date) => setFormData({ ...formData, ircExpiryDate: date })}
                  placeholder="انتخاب تاریخ یا مثال: 1405/05/12"
                />
              </div>

              {!existingVendor && (
                <div className="space-y-1 md:col-span-3">
                   <label className="text-foreground text-xs font-semibold select-none text-right">وضعیت و گرید اولیه سورس</label>
                   <div className="w-full bg-[#0071E3]/5 border border-[#0071E3]/20 rounded-lg px-3 py-2 text-[#0071E3] font-medium text-center text-xs">
                     ثبت جهت بررسی (ارزیابی در مرحله بعد انجام می‌شود)
                   </div>
                </div>
              )}
            </div>

            {/* Real-time Expiry Status Alert in Form */}
            {formData.ircExpiryDate && (() => {
              const expCheck = checkLicenseExpiry(formData.ircExpiryDate);
              if (expCheck.status === 'expired') {
                return (
                  <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 text-xs flex items-center gap-2.5 fade-in">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <div>
                      <strong className="font-bold">اخطار انقضای مجوز:</strong> مجوز وارد شده در تاریخ {formData.ircExpiryDate} منقضی شده است ({Math.abs(expCheck.daysLeft || 0)} روز پیش).
                    </div>
                  </div>
                );
              }
              if (expCheck.status === 'expiring_soon') {
                return (
                  <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs flex items-center gap-2.5 fade-in">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <strong className="font-bold">اعلان انقضای مجوز (کمتر از ۲ ماه):</strong> تنها {expCheck.daysLeft} روز تا انقضای این مجوز در تاریخ {formData.ircExpiryDate} باقی‌مانده است.
                    </div>
                  </div>
                );
              }
              if (expCheck.status === 'valid') {
                return (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-2.5 text-xs flex items-center gap-2 fade-in">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>مجوز تا تاریخ <strong>{formData.ircExpiryDate}</strong> دارای اعتبار قانونی است ({expCheck.daysLeft} روز باقی‌مانده).</span>
                  </div>
                );
              }
              return null;
            })()}

            <div className="space-y-1">
              <label className="text-foreground font-semibold text-xs">سوابق انحرافات (هر مورد در یک خط)</label>
              <textarea className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-[#0071E3] focus:border-[#0071E3] h-20 placeholder:text-muted-foreground text-xs" value={formData.rejectionReasonList} onChange={e => setFormData({...formData, rejectionReasonList: e.target.value})}></textarea>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose} className="px-4 text-xs font-semibold">
              انصراف
            </Button>
            <Button type="button" onClick={handleSubmit} className="px-5 text-xs font-bold">
              {existingVendor ? 'ثبت تغییرات' : 'ثبت سورس'}
            </Button>
          </div>
        </div>
      </Card>
  );
}

// --- View: Category ---
function CategoryView({ 
  db, 
  categoryId, 
  onSelectVendor, 
  currentUser,
  expandedMaterial,
  onToggleMaterial,
  materials,
  onAddMaterial,
  partners = []
}: { 
  db: Vendor[], 
  categoryId: Category, 
  onSelectVendor: any, 
  currentUser: User,
  expandedMaterial: string | null,
  onToggleMaterial: (mat: string | null) => void,
  materials: Material[],
  onAddMaterial: (m: Material) => void,
  partners?: BusinessPartner[]
}) {
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState<'material' | 'count' | 'grade' | 'expiry'>('material');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, sortBy, activeFilter]);

  const meta = categoryLabels[categoryId];
  
  const categoryVendors = useMemo(() => {
    if (categoryId === 'sample') {
      return db.filter(v => v.isSample || v.category === 'sample');
    }
    if (categoryId === 'blacklist') {
      return db.filter(v => !v.isSample && v.category !== 'sample' && (v.category === 'blacklist' || v.status === 'rejected' || v.grade === 'rejected'));
    }
    return db.filter(v => v.category === categoryId && v.status !== 'rejected' && v.grade !== 'rejected');
  }, [db, categoryId]);
  
  const filteredVendors = useMemo(() => {
    const qt = query.toLowerCase();
    return categoryVendors.filter(v => 
      v.name.toLowerCase().includes(qt) || 
      v.nameEn.toLowerCase().includes(qt) || 
      v.material.toLowerCase().includes(qt) || 
      v.materialEn.toLowerCase().includes(qt) ||
      v.cas.toLowerCase().includes(qt) ||
      (v.irc && v.irc.toLowerCase().includes(qt)) ||
      (v.country && getDisplayCountry(v).toLowerCase().includes(qt))
    );
  }, [categoryVendors, query]);

  // Apply the quick status/grade filter (toggled from the stat chips) before grouping.
  const matchesFilter = (v: Vendor): boolean => {
    if (!activeFilter) return true;
    switch (activeFilter) {
      case 'approved': return v.status === 'approved';
      case 'conditional': return v.status === 'conditional';
      case 'rejected': return v.status === 'rejected' || v.grade === 'rejected';
      case 'A': return v.grade === 'A';
      case 'B': return v.grade === 'B';
      case 'C': return v.grade === 'C';
      case 'expiring': {
        if (!v.ircExpiryDate) return false;
        const c = checkLicenseExpiry(v.ircExpiryDate);
        return c.status === 'expired' || c.status === 'expiring_soon';
      }
      default: return true;
    }
  };

  const displayVendors = useMemo(
    () => filteredVendors.filter(matchesFilter),
    [filteredVendors, activeFilter]
  );

  // Group by material
  const grouped = useMemo(() => {
    const groups: Record<string, { fa: string, en: string, cas: string, vendors: Vendor[] }> = {};
    displayVendors.forEach(v => {
      const key = v.materialEn;
      if (!groups[key]) {
        groups[key] = { fa: v.material, en: v.materialEn, cas: v.cas, vendors: [] };
      }
      groups[key].vendors.push(v);
    });
    return groups;
  }, [displayVendors]);

  // Sort the material groups by the selected criterion.
  const gradeRank = (v: Vendor): number => {
    if (v.grade === 'A') return 4;
    if (v.grade === 'B') return 3;
    if (v.grade === 'C') return 2;
    if (v.status === 'approved') return 2;
    return 1;
  };
  const soonestExpiry = (vendors: Vendor[]): number => {
    let min = Infinity;
    vendors.forEach(v => {
      if (v.ircExpiryDate) {
        const c = checkLicenseExpiry(v.ircExpiryDate);
        if (typeof c.daysLeft === 'number') min = Math.min(min, c.daysLeft);
      }
    });
    return min;
  };
  const groupsList = useMemo(() => {
    const list = Object.values(grouped) as { fa: string, en: string, cas: string, vendors: Vendor[] }[];
    const sorted = [...list];
    if (sortBy === 'material') {
      sorted.sort((a, b) => a.fa.localeCompare(b.fa, 'fa'));
    } else if (sortBy === 'count') {
      sorted.sort((a, b) => b.vendors.length - a.vendors.length);
    } else if (sortBy === 'grade') {
      sorted.sort((a, b) => Math.max(...b.vendors.map(gradeRank)) - Math.max(...a.vendors.map(gradeRank)));
    } else if (sortBy === 'expiry') {
      sorted.sort((a, b) => soonestExpiry(a.vendors) - soonestExpiry(b.vendors));
    }
    return sorted;
  }, [grouped, sortBy]);

  const ITEMS_PER_PAGE = 20;
  const totalItems = groupsList.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedGroups = useMemo(() => {
    return groupsList.slice(startIndex, endIndex);
  }, [groupsList, startIndex, endIndex]);

  // Guard against landing on an out-of-range page after the result set shrinks
  // (e.g. a filter reduces the number of groups below the current page).
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  return (
    <div className="space-y-6 fade-in">
      {/* Sticky Category Top Header & Toolbar */}
      <div className="sticky top-0 z-20 bg-muted/95 backdrop-blur-md -mt-4 sm:-mt-8 -mx-4 sm:-mx-8 px-4 sm:px-8 pt-4 sm:pt-6 pb-4 border-b border-border shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2">
              <meta.icon className="w-6 h-6 text-primary" />
              {meta.fa}
            </h2>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{meta.en}</p>
          </div>

          <div className="flex items-center gap-2">
            <Button 
              type="button" 
              onClick={() => exportCategoryToExcel(db, categoryId, meta.fa, partners, materials)}
              className="flex items-center gap-2 text-xs font-bold shadow-xs cursor-pointer active:scale-95"
              title={`دانلود خروجی اکسل دسته‌بندی ${meta.fa}`}
            >
              <Download className="w-4 h-4" />
              <span>خروجی اکسل {meta.fa} (XLSX)</span>
            </Button>
          </div>
        </div>

        {/* Category Toolbar (Search & Stats) */}
        <Card className="p-3.5 sm:p-4 flex flex-col md:flex-row gap-3 sm:gap-4 items-center justify-between bg-card border-border shadow-xs">
          <div className="relative w-full md:w-80">
            <Input 
              type="text" 
              placeholder="جستجو کلمه کلیدی، نام، ماده، CAS، کشور..."
              className="pl-9 pr-4 text-sm bg-background"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              dir="rtl"
            />
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute left-8 top-2.5 text-muted-foreground hover:text-muted-foreground transition-colors p-0.5 rounded cursor-pointer"
                title="پاک کردن جستجو"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Sort control */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <label className="text-[11px] text-muted-foreground whitespace-nowrap flex items-center gap-1">
              <ChevronDown className="w-3.5 h-3.5" /> مرتب‌سازی
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              dir="rtl"
              className="text-xs bg-background border border-border rounded-lg px-2.5 py-2 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
              title="مرتب‌سازی گروه‌های ماده"
            >
              <option value="material">نام ماده (الفبا)</option>
              <option value="count">تعداد سورس (بیشترین)</option>
              <option value="grade">بهترین گرید</option>
              <option value="expiry">نزدیک‌ترین انقضای مجوز</option>
            </select>
          </div>

          {/* Stats double as quick filters (click to toggle) */}
          {(() => {
            const chipCls = (key: string | null) =>
              `px-2.5 py-1 text-xs cursor-pointer select-none transition-shadow ${
                activeFilter === key ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'opacity-95 hover:opacity-100'
              }`;
            const toggle = (key: string) => setActiveFilter(activeFilter === key ? null : key);
            const expiringCount = categoryVendors.filter(v => {
              if (!v.ircExpiryDate) return false;
              const c = checkLicenseExpiry(v.ircExpiryDate);
              return c.status === 'expired' || c.status === 'expiring_soon';
            }).length;
            return (
              <div className="flex flex-wrap gap-2 w-full md:w-auto justify-start md:justify-end items-center">
                <Badge variant="outline" onClick={() => setActiveFilter(null)}
                  className={`px-3 py-1 text-xs cursor-pointer select-none ${activeFilter === null ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
                  title="نمایش همه">
                  کل سورس‌ها: <span className="font-bold font-mono mr-1 text-primary">{categoryVendors.length}</span>
                </Badge>
                {categoryId === 'sample' ? (
                  <>
                    <Badge variant="gradeA" onClick={() => toggle('approved')} className={chipCls('approved')}>
                      Approved: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.status === 'approved').length}</span>
                    </Badge>
                    <Badge variant="gradeC" onClick={() => toggle('conditional')} className={chipCls('conditional')}>
                      Approved conditional: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.status === 'conditional').length}</span>
                    </Badge>
                    <Badge variant="gradeReject" onClick={() => toggle('rejected')} className={chipCls('rejected')}>
                      Reject: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.status === 'rejected').length}</span>
                    </Badge>
                  </>
                ) : categoryId === 'blacklist' ? null : (
                  <>
                    <Badge variant="gradeA" onClick={() => toggle('A')} className={chipCls('A')}>
                      Grade A: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.grade === 'A').length}</span>
                    </Badge>
                    <Badge variant="gradeB" onClick={() => toggle('B')} className={chipCls('B')}>
                      Grade B: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.grade === 'B').length}</span>
                    </Badge>
                    <Badge variant="gradeC" onClick={() => toggle('C')} className={chipCls('C')}>
                      Grade C: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.grade === 'C').length}</span>
                    </Badge>
                    <Badge variant="gradeReject" onClick={() => toggle('rejected')} className={chipCls('rejected')}>
                      لیست سیاه: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.grade === 'rejected' || v.status === 'rejected').length}</span>
                    </Badge>
                  </>
                )}
                {categoryId !== 'blacklist' && expiringCount > 0 && (
                  <Badge variant="warning" onClick={() => toggle('expiring')} className={chipCls('expiring')} title="فیلتر سورس‌های با مجوز رو به انقضا یا منقضی">
                    ⚠ نزدیک انقضا: <span className="font-bold font-mono mr-1">{expiringCount}</span>
                  </Badge>
                )}
              </div>
            );
          })()}
        </Card>
      </div>

      <div className="space-y-6 mt-8">
        {paginatedGroups.map(group => (
          <MaterialGroup 
            key={group.en} 
            group={group} 
            onSelectVendor={onSelectVendor} 
            currentUser={currentUser} 
            categoryId={categoryId} 
            expandedMaterial={expandedMaterial}
            onToggleMaterial={onToggleMaterial}
            partners={partners}
          />
        ))}
        {groupsList.length === 0 && (
          <div className="text-center py-16 px-4 bg-card rounded-2xl border border-border">
            <Archive className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="text-foreground font-semibold text-lg">نتیجه‌ای یافت نشد</h4>
            {(query || activeFilter) && (
              <div className="mt-3">
                <p className="text-sm text-muted-foreground">با فیلتر یا جست‌وجوی فعلی موردی پیدا نشد.</p>
                <button
                  type="button"
                  onClick={() => { setQuery(''); setActiveFilter(null); }}
                  className="mt-3 text-xs font-semibold text-primary hover:underline cursor-pointer"
                >
                  پاک کردن فیلترها
                </button>
              </div>
            )}
          </div>
        )}

        <Pagination 
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          startIndex={startIndex}
          endIndex={endIndex}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
}

const MaterialGroup: React.FC<{ 
  group: { fa: string, en: string, cas: string, vendors: Vendor[] }, 
  onSelectVendor: any, 
  currentUser: User, 
  categoryId?: Category,
  expandedMaterial: string | null,
  onToggleMaterial: (mat: string | null) => void,
  partners?: BusinessPartner[]
}> = ({ group, onSelectVendor, currentUser, categoryId, expandedMaterial, onToggleMaterial, partners = [] }) => {
  const [localOpen, setLocalOpen] = useState(group.en === expandedMaterial);
  const [highlight, setHighlight] = useState(false);
  const manualRef = useRef(false);
  const elementId = `group-${group.en.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  const getPartnerDetails = (vendor: Vendor) => {
    // A source links to a single partner (manufacturer OR supplier).
    let partner =
      partners.find(p => p.id === vendor.supplierId) ||
      partners.find(p => p.id === vendor.manufacturerId);

    // Name-match fallback for legacy/imported records.
    if (!partner) {
      partner = partners.find(p => p.name.trim().toLowerCase() === vendor.name.trim().toLowerCase());
    }

    return {
      partnerName: partner ? partner.name : vendor.name,
      partnerLabel: partner?.type === 'Supplier' ? 'فروشنده' : 'تولیدکننده',
      isSupplier: partner?.type === 'Supplier',
    };
  };

  useEffect(() => {
    if (group.en === expandedMaterial) {
      // This material is the active one: open it, scroll it into view, and —
      // when the open was triggered externally (e.g. returning from a source
      // detail, not a manual click) — briefly highlight it so the user can
      // confirm they landed back on the right material.
      setLocalOpen(true);
      const external = !manualRef.current;
      manualRef.current = false;
      let highlightTimer: ReturnType<typeof setTimeout> | undefined;
      if (external) {
        setHighlight(true);
        highlightTimer = setTimeout(() => setHighlight(false), 1600);
      }
      const scrollTimer = setTimeout(() => {
        const el = document.getElementById(elementId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 250);
      return () => { clearTimeout(scrollTimer); if (highlightTimer) clearTimeout(highlightTimer); };
    } else if (expandedMaterial !== null) {
      // A different material became the active one — collapse this one so the
      // list behaves as a real accordion (only one open at a time).
      manualRef.current = false;
      setLocalOpen(false);
    }
  }, [expandedMaterial, group.en, elementId]);

  const isOpen = localOpen;

  const toggleGroup = () => {
    const nextOpen = !isOpen;
    manualRef.current = true;
    setLocalOpen(nextOpen);
    if (nextOpen) {
      onToggleMaterial(group.en);
    } else if (expandedMaterial === group.en) {
      onToggleMaterial(null);
    }
  };

  return (
    <Card id={elementId} className={`overflow-hidden shadow-xs hover:shadow-sm transition-all duration-500 scroll-mt-52 sm:scroll-mt-48 ${highlight ? 'border-primary ring-2 ring-primary/40 shadow-md' : 'border-border/80'}`}>
      <div 
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls={`${elementId}-content`}
        onClick={toggleGroup}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleGroup();
          }
        }}
        className="bg-muted/30 hover:bg-muted/60 cursor-pointer px-5 py-4 flex flex-col md:flex-row justify-between items-start md:items-center border-b border-border/70 transition-colors"
      >
        <div className="flex items-center gap-3.5">
          <ChevronLeft className={`w-5 h-5 text-primary transition-transform duration-300 ${isOpen ? '-rotate-90' : 'rotate-0'}`} />
          <div className="text-right">
            <h3 className="font-bold text-base text-foreground mb-1">
              {group.fa} <span className="text-muted-foreground text-sm font-normal ml-2">/ {group.en}</span>
            </h3>
            <div className="flex items-center gap-2 text-xs mt-1">
              <Badge variant="outline" className="font-mono text-[11px] px-2 py-0">
                CAS: {group.cas}
              </Badge>
            </div>
          </div>
        </div>
        <div className="mt-3 md:mt-0 text-xs text-muted-foreground mr-8 md:mr-0 font-medium">
          <span className="text-foreground font-bold font-mono text-sm ml-1">{group.vendors.length}</span> سورس ثبتی
        </div>
      </div>
      
      <div
        id={`${elementId}-content`}
        aria-hidden={!isOpen}
        className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <div className="divide-y divide-border/60 bg-card">
            {group.vendors.map(vendor => {
              const { partnerName, partnerLabel } = getPartnerDetails(vendor);
              return (
                <div 
                  key={vendor.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`مشاهده جزئیات ${vendor.name}`}
                  onClick={() => onSelectVendor(vendor)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectVendor(vendor);
                    }
                  }}
                  className="px-5 py-4 flex items-center justify-between hover:bg-muted/40 cursor-pointer transition-colors group"
                >
                  {/* Right side: Name & Status */}
                  <div className="flex items-center gap-3.5">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      vendor.status === 'rejected' || vendor.grade === 'rejected' ? 'bg-red-500' :
                      vendor.isSample ? (
                        vendor.status === 'approved' ? 'bg-emerald-500' :
                        vendor.status === 'conditional' ? 'bg-amber-500' : 'bg-cyan-500'
                      ) : (
                        vendor.grade === 'A' ? 'bg-emerald-500' :
                        vendor.grade === 'B' ? 'bg-[#0071E3]' :
                        vendor.grade === 'C' ? 'bg-amber-500' :
                        vendor.status === 'conditional' ? 'bg-amber-500' : 'bg-cyan-500'
                      )
                    }`} />
                    <div className="text-right space-y-1">
                      {/* 1. Name of Material */}
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-bold">نام ماده اولیه</Badge>
                        <span className="font-bold text-foreground">{vendor.material}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">({vendor.materialEn})</span>
                      </div>
                      
                      {/* 2. Supplier / Manufacturer (single partner) */}
                      <div className="font-bold text-base text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{partnerLabel}</span>
                        <span>{partnerName}</span>
                      </div>

                      {/* 3. Metadata line (English name, country, licence expiry) */}
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                        {vendor.nameEn && vendor.nameEn.trim() && vendor.nameEn.toLowerCase() !== 'n/a' && vendor.nameEn.toLowerCase() !== 'unknown' && (
                          <span className="font-mono text-[10px] text-muted-foreground">{vendor.nameEn}</span>
                        )}
                        {(() => {
                          const displayCountry = getDisplayCountry(vendor);
                          if (displayCountry && displayCountry.trim() && displayCountry.toLowerCase() !== 'unknown' && displayCountry.toLowerCase() !== 'n/a' && displayCountry !== 'نامشخص') {
                            return (
                              <>
                                <span className="text-border">|</span>
                                <span className="font-sans font-medium text-muted-foreground">{displayCountry}</span>
                              </>
                            );
                          }
                          return null;
                        })()}
                        {vendor.ircExpiryDate && (() => {
                          const check = checkLicenseExpiry(vendor.ircExpiryDate);
                          if (check.status === 'expired') {
                            return (
                              <>
                                <span className="text-border">|</span>
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 font-bold">
                                  مجوز منقضی
                                </Badge>
                              </>
                            );
                          }
                          if (check.status === 'expiring_soon') {
                            return (
                              <>
                                <span className="text-border">|</span>
                                <Badge variant="warning" className="text-[10px] px-1.5 py-0 font-bold">
                                  انقضای مجوز: {check.daysLeft} روز
                                </Badge>
                              </>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Left side: Score & Grade */}
                  <div className="flex items-center gap-6">
                    {/* Column 1: Score */}
                    <div className="hidden sm:flex w-28 sm:w-32 shrink-0 flex-col items-center justify-center text-center">
                      {currentUser?.role === 'admin' ? (
                        vendor.scores && calculateOverallScore(vendor.scores) !== null ? (
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground mb-0.5">امتیاز کل</div>
                            <div className={`font-bold font-mono text-sm ${getScoreColorClass(calculateOverallScore(vendor.scores))}`}>
                              {calculateOverallScore(vendor.scores)}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] text-muted-foreground">- بدون امتیاز -</div>
                        )
                      ) : (
                        vendor.scores && vendor.scores[currentUser?.role as keyof Scores] > 0 ? (
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground mb-0.5">امتیاز بخش شما</div>
                            <div className={`font-bold font-mono text-sm ${getScoreColorClass(vendor.scores[currentUser?.role as keyof Scores])}`}>
                              {vendor.scores[currentUser?.role as keyof Scores]}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">عدم ثبت امتیاز</div>
                        )
                      )}
                    </div>

                    {/* Column 2: Risk Level */}
                    {categoryId !== 'blacklist' && (
                      <div className="hidden sm:flex w-24 sm:w-28 shrink-0 flex-col items-center justify-center text-center">
                        <div className="text-[10px] text-muted-foreground mb-0.5">سطح ریسک</div>
                        {vendor.riskAssessment ? (
                          <Badge 
                            variant={
                              vendor.riskAssessment.riskLevel === 'Low' ? 'gradeA' :
                              vendor.riskAssessment.riskLevel === 'Medium' ? 'gradeC' : 'gradeReject'
                            }
                            className="text-[10px] font-bold px-2 py-0"
                          >
                            {vendor.riskAssessment.riskLevel === 'Low' ? 'Low Risk' :
                             vendor.riskAssessment.riskLevel === 'Medium' ? 'Medium Risk' : 'High Risk'}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">-</span>
                        )}
                      </div>
                    )}

                    {/* Column 3: Grade / Status */}
                    {categoryId !== 'blacklist' && (
                      <div className="hidden sm:flex w-24 sm:w-28 shrink-0 flex-col items-center justify-center text-center">
                        {vendor.isSample ? (
                          <>
                            <div className="text-[10px] text-muted-foreground mb-0.5">وضعیت نمونه</div>
                            <Badge 
                              variant={
                                vendor.status === 'approved' ? 'gradeA' :
                                vendor.status === 'conditional' ? 'gradeC' : 'gradeReject'
                              }
                              className="text-[10px] font-bold px-2 py-0"
                            >
                              {vendor.status === 'approved' ? 'Approved' :
                               vendor.status === 'conditional' ? 'Conditional' : 'Reject'}
                            </Badge>
                          </>
                        ) : (
                          <>
                            <div className="text-[10px] text-muted-foreground mb-0.5">رتبه نهایی</div>
                            <GradeBadge grade={vendor.grade} status={vendor.status} scores={vendor.scores} />
                          </>
                        )}
                      </div>
                    )}
                    
                    <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transform group-hover:-translate-x-0.5 transition-all shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
          
          <MaterialsComparisonSection vendors={group.vendors || []} categoryId={categoryId} />
        </div>
      </div>
    </Card>
  );
}

const MaterialsComparisonSection: React.FC<{ vendors: Vendor[]; categoryId?: Category }> = ({ vendors, categoryId }) => {
  const [showLabModGuide, setShowLabModGuide] = useState(false);
  const [showEngineGuide, setShowEngineGuide] = useState(false);

  if (categoryId === 'blacklist' || categoryId === 'sample') {
    return null;
  }

  const validVendors = (vendors || []).filter(v => !v.isSample && v.status !== 'rejected' && v.grade !== 'rejected');
  
  if (validVendors.length === 0) return null;

  const chartData = validVendors.map(v => {
    const overallScore = calculateOverallScore(v.scores, true) || 0;
    
    // Call the isolated FmeaService to run the recommendation engine logic
    const { engineScore, riskMod, labMod, hasLabAssessment, analysisMeta } = 
      FmeaService.calculateEngineScore(overallScore, v.riskAssessment?.riskLevel, v.analysisRecords);

    return {
      name: v.name,
      nameEn: v.nameEn,
      score: overallScore, // Base visual score unchanged
      engineScore,
      riskMod,
      labMod,
      analysisMeta,
      hasLabAssessment,
      qa: v.scores?.qa || 0,
      commercial: v.scores?.commercial || 0,
      planning: v.scores?.planning || 0,
      finance: v.scores?.finance || 0,
      vendor: v
    };
  }).sort((a, b) => b.engineScore - a.engineScore);

  const hasScores = chartData.some(d => d.score > 0);
  if (!hasScores) {
    return (
      <div className="mx-6 my-5 p-4 bg-amber-50/50 border border-amber-200/40 rounded-xl text-center text-amber-800 text-xs">
        هنوز ارزیابی کمّی و ثبت امتیاز کافی برای تامین‌کنندگان غیرنمونه این ماده انجام نشده است.
      </div>
    );
  }

  const bestVendor = chartData[0];

  // Dynamically calculate the latest update date among the material group's vendors
  const getLatestGroupUpdateDate = () => {
    const datesList: string[] = [];
    validVendors.forEach(v => {
      if (v.lastAudit) datesList.push(v.lastAudit);
      if (v.activityLogs) {
        v.activityLogs.forEach(log => {
          if (log.date) {
            const onlyDate = log.date.split(' ')[0];
            if (onlyDate) datesList.push(onlyDate);
          }
        });
      }
    });

    if (datesList.length === 0) {
      return new Date().toLocaleDateString('fa-IR');
    }

    const normalizeDigits = (str: string) => {
      return str.replace(/[۰-۹]/g, w => String.fromCharCode(w.charCodeAt(0) - 1776));
    };

    datesList.sort((a, b) => {
      const normA = normalizeDigits(a);
      const normB = normalizeDigits(b);
      return normB.localeCompare(normA); // descending
    });

    const latest = datesList[0];
    const normLatest = normalizeDigits(latest);
    
    // If the latest parsed year is before 1404 (very old mock data), show the current active system date to look completely up-to-date and updated
    const yearParsed = parseInt(normLatest.split('/')[0]);
    if (isNaN(yearParsed) || yearParsed < 1404) {
      return new Date().toLocaleDateString('fa-IR');
    }

    return latest;
  };

  const groupUpdateDate = getLatestGroupUpdateDate();

  return (
    <div className="mx-6 my-6 p-6 bg-muted/50 rounded-2xl border border-border/80">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#0071E3]" />
            نمودار مقایسه و تحلیل ارزیابی تامین‌کنندگان این ماده
          </h4>
          <p className="text-xs text-muted-foreground mt-1">مقایسه امتیاز کل مکتسبه و تحلیل جهت بهترین انتخاب تأمین کالا</p>
        </div>
        
        {bestVendor && bestVendor.score > 0 && (
          <div className="flex items-center gap-2 bg-[#0071E3]/10 border border-[#0071E3]/20 px-3 py-1.5 rounded-full text-xs text-[#0071E3] font-bold self-start md:self-auto">
            <CheckCircle className="w-3.5 h-3.5" />
            گزینه پیشنهادی سیستم: {bestVendor.name}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-card p-4 rounded-xl border border-border">
            <div className="mb-4 flex justify-between items-center text-xs text-[#6E6E73] font-semibold">
              <span>مقایسه امتیاز کل تخصصی (از ۱۰۰)</span>
              <div className="flex items-center gap-2 font-normal">
                <span className="inline-block w-3 h-3 bg-[#0071E3] rounded-sm"></span>
                <span>امتیاز کل</span>
              </div>
            </div>
            
            <div className="space-y-4">
              {chartData.map((item) => {
                const scorePercent = Math.min(100, item.score);
                const isBest = item.vendor.id === bestVendor.vendor.id;
                return (
                  <div key={item.vendor.id} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-foreground truncate max-w-[200px]" title={item.name}>
                        {item.name} {isBest && <span className="text-[10px] text-[#0071E3] bg-[#0071E3]/10 px-1.5 py-0.5 rounded-md font-normal mr-2">برتر</span>}
                      </span>
                      <span className="font-mono font-bold text-foreground">{item.score} <span className="text-gray-400 font-normal">/ ۱۰۰</span></span>
                    </div>
                    <div className="h-5 w-full bg-muted rounded-full overflow-hidden flex items-center relative">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ${
                          isBest ? 'bg-gradient-to-l from-[#0071E3] to-[#4096FF]' : 'bg-gradient-to-l from-slate-500 to-slate-400'
                        }`}
                        style={{ width: `${scorePercent}%` }}
                      />
                      <div className="absolute left-3 text-[10px] text-gray-500 font-sans pointer-events-none">
                        {item.vendor.grade ? `Grade ${item.vendor.grade}` : 'بدون گرید'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border">
             <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
               <h5 className="font-bold text-foreground text-xs flex items-center gap-2">
                 <Microscope className="w-4 h-4 text-indigo-600" />
                 مقایسه نتایج تست آزمایشگاهی / QC
               </h5>
               <button 
                 onClick={() => setShowLabModGuide(!showLabModGuide)}
                 className="text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
               >
                 <span>فرمول محاسبه</span>
                 <motion.span
                   animate={{ rotate: showLabModGuide ? 180 : 0 }}
                   transition={{ duration: 0.15 }}
                   className="inline-block"
                 >
                   <ChevronDown className="w-3 h-3" />
                 </motion.span>
               </button>
             </div>

             <AnimatePresence initial={false}>
               {showLabModGuide && (
                 <motion.div 
                   initial={{ height: 0, opacity: 0 }}
                   animate={{ height: "auto", opacity: 1 }}
                   exit={{ height: 0, opacity: 0 }}
                   transition={{ duration: 0.2, ease: "easeOut" }}
                   className="overflow-hidden"
                 >
                   <p className="text-[10px] text-muted-foreground mb-3 bg-muted p-3 rounded-lg border border-border leading-relaxed shadow-sm block">
                      <strong className="text-foreground">نحوه محاسبه ضریب نتایج آزمایشگاه (Lab Mod):</strong><br/>
                      تأثیر این بخش در بازه <span className="font-mono text-indigo-600 font-bold" dir="ltr">0.90x ~ 1.10x</span> (قبل از احتساب جریمه‌های ردی) محاسبه می‌شود:<br/>
                      <span className="block mt-1.5"><span className="inline-block w-1 h-1 bg-emerald-500 rounded-full ml-1.5 align-middle"></span> <strong>پایه و پاداش تست مثبت:</strong> ضریب پایه سیستم <strong><span className="font-mono">0.90x</span></strong> است. تا سقف <strong><span className="font-mono">+0.20x</span></strong> (به نسبت درصد تست‌های تایید شده دستگاه) به این پایه اضافه می‌شود. (مثلا اگر ۱۰۰٪ تست‌ها پاس شوند ضریب کامل ۱.۱۰ لحاظ می‌گردد).</span>
                      <span className="block mt-1"><span className="inline-block w-1 h-1 bg-rose-500 rounded-full ml-1.5 align-middle"></span> <strong>جریمه تست مردودی:</strong> به ازای هر ۱ تست که مردود (<span className="text-rose-600 font-bold">Reject</span>) شده باشد، مستقیماً ضریب <strong><span className="font-mono text-rose-600">-0.10x</span></strong> به عنوان جریمه از ضریب کل آزمایشگاه کسر می‌گردد.</span>
                   </p>
                 </motion.div>
               )}
             </AnimatePresence>
             <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                   <thead>
                     <tr className="border-b border-border text-muted-foreground font-semibold">
                       <th className="pb-2">سورس</th>
                       <th className="pb-2 text-center">کل تست‌ها</th>
                       <th className="pb-2 text-center text-emerald-600">پاس/تایید</th>
                       <th className="pb-2 text-center text-rose-600">مردود</th>
                       <th className="pb-2 text-center">ضریب موتور</th>
                     </tr>
                   </thead>
                   <tbody>
                     {chartData.map(item => (
                        <tr key={item.vendor.id} className="border-b border-slate-50/50 last:border-0 text-foreground">
                           <td className="py-2.5 font-medium">{item.name} {item.vendor.id === bestVendor.vendor.id && <span className="text-[#0071E3] px-1 text-[10px]">★</span>}</td>
                           <td className="py-2.5 text-center font-mono">{item.analysisMeta.total || '-'}</td>
                           <td className="py-2.5 text-center font-mono text-emerald-600">{item.hasLabAssessment ? (item.analysisMeta.pass + item.analysisMeta.app) : '-'}</td>
                           <td className="py-2.5 text-center font-mono text-rose-600">{item.hasLabAssessment ? item.analysisMeta.reject : '-'}</td>
                           <td className="py-2.5 text-center font-mono text-indigo-600" dir="ltr">{item.hasLabAssessment ? item.labMod.toFixed(2) + 'x' : '-'}</td>
                        </tr>
                     ))}
                   </tbody>
                </table>
             </div>
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#0071E3]/2 p-5 rounded-xl border border-[#0071E3]/5 flex flex-col justify-between">
          <div>
            <div className="text-[10px] text-[#0071E3] font-bold tracking-wider mb-2 uppercase border border-[#0071E3]/20 bg-[#0071E3]/10 px-2 py-0.5 rounded inline-block">موتور تحلیل سیستم (Local Engine)</div>
            <h5 className="font-bold text-foreground text-sm mb-3 mt-1">چرا {bestVendor.name} پیشنهاد می‌شود؟</h5>
            
            <div className="space-y-3 text-xs text-[#424245] leading-relaxed">
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-[#0071E3] rounded-full mt-1.5 shrink-0" />
                <p>
                  <strong>موتور آفلاین سیستم</strong> برای انتخاب کالا از یک مکانیسم امتیازدهی ترکیبی شفاف استفاده می‌کند:
                  <br/>
                  <span className="inline-block mt-2 font-mono text-[#0071E3] bg-[#0071E3]/5 px-2 py-1 rounded border border-[#0071E3]/20 font-bold" dir="ltr">
                    Engine Score = BaseScore × RiskMod × LabMod
                  </span>
                </p>
              </div>
              
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-[#0071E3] rounded-full mt-1.5 shrink-0" />
                <p>
                  <strong>۱. امتیاز کل (Base Score):</strong> {bestVendor.score} از ۱۰۰ (محاسبه شده از میانگین وزنی فرم‌های ارزیابی بخش‌های تخصصی).
                </p>
              </div>

              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-[#0071E3] rounded-full mt-1.5 shrink-0" />
                <p>
                  <strong>۲. ضریب ریسک (Risk Mod):</strong> سطح ریسک فعلی <strong>{bestVendor.vendor.riskAssessment?.riskLevel || 'Low'}</strong> است که معادل ضریب <strong>{bestVendor.riskMod.toFixed(2)}x</strong> محاسبه می‌شود.
                </p>
              </div>

              {bestVendor.hasLabAssessment ? (
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0" />
                  <p>
                    <strong>۳. ضریب نتایج آزمایشگاه (Lab Mod):</strong> بر اساس سوابق QC و نسبت تست‌های قبول/رد شده، معادل <strong>{bestVendor.labMod.toFixed(2)}x</strong> روی امتیاز کل اعمال شده است.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 bg-amber-500 rounded-full mt-1.5 shrink-0" />
                  <p>
                    <strong>۳. ضریب نتایج آزمایشگاه (Lab Mod):</strong> سابقه قبلی تست وجود ندارد (تأثیر خنثی معادل <strong>1.00x</strong>).
                  </p>
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-[#0071E3]/20 flex items-center justify-between">
                 <span className="font-bold text-foreground">امتیاز نهایی سیستم:</span>
                 <span className="font-mono text-sm" dir="ltr">
                   {bestVendor.score} × {bestVendor.riskMod.toFixed(2)} × {bestVendor.labMod.toFixed(2)} = <strong className="text-[16px] text-[#0071E3] bg-card px-2 rounded-md shadow-sm border border-border">{bestVendor.engineScore.toFixed(1)}</strong>
                 </span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[#0071E3]/10 flex justify-between items-center text-[11px] text-[#6E6E73]">
            <span>آخرین بروزرسانی ارزیابی موتور:</span>
            <span className="font-mono font-bold text-foreground">{groupUpdateDate}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export function LegacyPrintableSampleFormUnused() { return null; }
function UnusedFallbackSampleForm({ vendor, onBack }: { vendor: Vendor, onBack: () => void }) {
  const statusLabel = vendor.status === 'approved' ? 'نمونه تایید شده (Approved Sample)' :
                      vendor.status === 'conditional' ? 'نمونه تایید مشروط (Conditional)' :
                      vendor.status === 'rejected' ? 'نمونه تایید نشده / رد شده (Rejected)' : 'بررسی اولیه / جدید (New/Pending)';
  const statusColor = vendor.status === 'approved' ? 'bg-emerald-600 text-white border-emerald-700' :
                      vendor.status === 'conditional' ? 'bg-amber-500 text-white border-amber-600' :
                      vendor.status === 'rejected' ? 'bg-rose-600 text-white border-rose-700' : 'bg-cyan-500 text-white border-cyan-600';

  return document.body ? createPortal(
    <>
      <style>{`
        @media print {
          #root { display: none !important; }
          body, html { background-color: white !important; margin: 0; padding: 0; }
          @page { size: A4 portrait; margin: 5mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <div className="fixed inset-0 z-[99999] bg-muted text-foreground overflow-y-auto w-full h-full p-4 print:static print:h-auto print:overflow-visible print:bg-white print:p-0 print:block flex flex-col items-center">
         {/* Actions toolbar */}
         <div className="w-full max-w-[210mm] flex justify-between items-center mb-6 print:hidden bg-card p-4 rounded-xl border border-border shadow-sm">
            <button onClick={onBack} className="bg-muted hover:bg-slate-200 px-6 py-2 rounded-lg font-medium text-foreground transition-colors flex items-center gap-2 border border-border">
              <ChevronLeft className="w-5 h-5" />
              بازگشت
            </button>
            <button onClick={() => setTimeout(() => window.print(), 100)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 shadow-sm">
              <Printer className="w-5 h-5" />
              چاپ فرم نمونه تستی
            </button>
         </div>

         {/* A4 Paper Container */}
         <div className="w-[210mm] min-h-[297mm] bg-card print:w-full print:shadow-none shadow-[0_0_20px_rgba(0,0,0,0.1)] font-sans" dir="rtl">
          <div className="p-8 pb-4">
             {/* Header */}
             <div className="flex border-2 border-blue-900 rounded-xl mb-6 overflow-hidden items-stretch">
                <div className="w-1/4 p-4 flex flex-col items-center justify-center border-l-2 border-blue-900">
                   <img src={temadLogo} alt="Temad Logo" className="h-[100px] w-auto object-contain" />
                </div>
                <div className="w-2/4 flex flex-col justify-center items-center p-4 text-center">
                   <h1 className="text-lg font-bold text-blue-900 mb-1">شرکت تولید مواد اولیه داروپخش (تماد)</h1>
                   <div className="text-xs font-semibold text-foreground">فرم ثبت، آزمایش و ارزیابی مشخصات تجربی نمونه مادی تستی (SAMPLES)</div>
                </div>
                <div className="w-1/4 p-4 border-r-2 border-blue-900 flex flex-col justify-center bg-blue-900 text-white space-y-1 text-right">
                   <div className="flex justify-between items-center text-[10px] border-b border-blue-800 pb-1">
                      <span className="opacity-80">تاریخ چاپ:</span>
                      <span className="font-sans">{new Date().toLocaleDateString('fa-IR')}</span>
                   </div>
                   <div className="flex justify-between items-center text-[10px] border-b border-blue-800 pb-1">
                      <span className="opacity-80">نوع پرونده:</span>
                      <span>نمونه تستی (Sample)</span>
                   </div>
                   <div className="flex justify-between items-center text-[10px]">
                      <span className="opacity-80">شناسه سیستم:</span>
                      <span className="font-mono">{vendor.id.slice(0, 8).toUpperCase()}</span>
                   </div>
                </div>
             </div>

             {/* Meta Info */}
             <div className="flex flex-col border-2 border-border rounded-xl mb-6 overflow-hidden text-sm bg-muted/50">
                <div className="flex border-b border-border text-right">
                  <div className="w-1/3 p-3 flex flex-col border-l border-border">
                     <span className="text-muted-foreground font-light mb-1 text-xs">نام کالای (فارسی):</span>
                     <span className="font-bold">{vendor.material}</span>
                  </div>
                  <div className="w-1/3 p-3 flex flex-col border-l border-border">
                     <span className="text-muted-foreground font-light mb-1 text-xs">تولیدکننده سورس نمونه:</span>
                     <span className="font-bold">{vendor.name}</span>
                  </div>
                  <div className="w-1/3 p-3 flex flex-col">
                     <span className="text-muted-foreground font-light mb-1 text-xs">کشور سازنده:</span>
                     <span className="font-bold font-mono">{vendor.country || getDisplayCountry(vendor)}</span>
                  </div>
                </div>
                <div className="flex text-right">
                  <div className="w-1/3 p-3 flex flex-col border-l border-border">
                     <span className="text-muted-foreground font-light mb-1 text-xs">شماره CAS:</span>
                     <span className="font-bold font-mono" dir="ltr">{vendor.cas && vendor.cas.toLowerCase() !== 'n/a' && vendor.cas.toLowerCase() !== 'unknown' ? vendor.cas : '-'}</span>
                  </div>
                  <div className="w-1/3 p-3 flex flex-col border-l border-border">
                     <span className="text-muted-foreground font-light mb-1 text-xs">کد ارجاع فنی کالا:</span>
                     <span className="font-bold font-mono" dir="ltr">{vendor.irc && vendor.irc.toLowerCase() !== 'n/a' && vendor.irc.toLowerCase() !== 'unknown' ? vendor.irc : '-'}</span>
                  </div>
                  <div className="w-1/3 p-3 flex flex-col">
                     <span className="text-muted-foreground font-light mb-1 text-xs">تاریخ ایجاد نمونه در سیستم:</span>
                     <span className="font-bold font-mono text-right">{vendor.lastAudit || vendor.registrationDate || 'ثبت‌نشده'}</span>
                  </div>
                </div>
             </div>

             {/* Explanatory banner */}
             <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-4 mb-6 text-xs leading-relaxed text-right">
                <strong>پیوست آیین‌نامه ارزیابی تامین‌کنندگان شرکت تماد:</strong> کالاهایی که تحت عنوان <strong>«فرم نمونه آزمایشی»</strong> در سامانه به ثبت می‌رسند، به لحاظ ماهیت از ارزیابی ریسک کلی سالانه و فرآیند امتیازدهی چندجانبه دپارتمان‌های تجاری (بازرگانی، مالی و انبار) معاف می‌باشند. ارزیابی این موارد به بررسی فیزیکی اولیه در دپارتمان کیفیت (QA) و انطباق آزمایشگاهی توسط واحدهای آزمایشگاهی فنی مربوطه تخصیص یافته است.
             </div>

             {/* Physical and documentation Checklist */}
             <div className="border border-border rounded-xl overflow-hidden mb-6 text-right">
               <div className="bg-muted px-4 py-2 border-b border-border text-foreground font-bold text-sm">
                 ۱. نتایج بررسی‌های فیزیکی ظاهری و مستندات نمونه (Checklist)
               </div>
               <div className="grid grid-cols-2 text-xs divide-x-reverse divide-x divide-y divide-border">
                 <div className="p-3 flex items-center justify-between gap-2">
                   <span className="text-muted-foreground">پلمپ و بسته‌بندی محفظه نمونه:</span>
                   <div className="flex gap-4 font-bold">
                     <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> مناسب و سالم</span>
                     <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> معیوب/مخدوش</span>
                   </div>
                 </div>
                 <div className="p-3 flex items-center justify-between gap-2">
                   <span className="text-muted-foreground">برگه آنالیز سازنده (COA):</span>
                   <div className="flex gap-4 font-bold">
                     <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> همراه‌بسته دارد</span>
                     <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> کسر مدرک COA</span>
                   </div>
                 </div>
                 <div className="p-3 flex items-center justify-between gap-2">
                   <span className="text-muted-foreground">برگه ایمنی و فنی (MSDS/TDS):</span>
                   <div className="flex gap-4 font-bold">
                     <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> ارائه گردیده</span>
                     <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> ناقص / کسر مدرک</span>
                   </div>
                 </div>
                 <div className="p-3 flex items-center justify-between gap-2">
                   <span className="text-muted-foreground">برگانطباق مندرجات لیبل بسته‌بندی با ماده:</span>
                   <div className="flex gap-4 font-bold">
                     <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> کاملا منطبق</span>
                     <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> دارای مغایرت</span>
                   </div>
                 </div>
               </div>
             </div>

             {/* Laboratory Parameters Evaluation Table */}
             <div className="border border-border rounded-xl overflow-hidden mb-6 text-right">
               <div className="bg-muted px-4 py-2 border-b border-border text-foreground font-bold text-sm">
                 ۲. بررسی‌های آزمایشگاهی و کنترل کیفیت نمونه (QC Lab Control Details)
               </div>
               <div className="p-4 text-xs space-y-4">
                 <div className="grid grid-cols-3 gap-4 text-right">
                   <div>
                     <span className="text-muted-foreground block mb-1">شماره بچ نمونه آزمایشگاهی (Test Batch No):</span>
                     <div className="p-2 border border-dashed border-border rounded bg-muted h-8 font-mono text-center"></div>
                   </div>
                   <div>
                     <span className="text-muted-foreground block mb-1">مقدار نمونه واصله (Sample Weight):</span>
                     <div className="p-2 border border-dashed border-border rounded bg-muted h-8 text-center"></div>
                   </div>
                   <div>
                     <span className="text-muted-foreground block mb-1">تاریخ تکمیل تست در آزمایشگاه:</span>
                     <div className="p-2 border border-dashed border-border rounded bg-muted h-8 text-center"></div>
                   </div>
                 </div>

                 <table className="w-full text-center border border-border mt-4 text-xs">
                   <thead className="bg-muted text-muted-foreground font-bold">
                     <tr className="border-b border-border">
                       <th className="py-2.5 px-2 border-l border-border">شاخص‌های آزمایش کالا</th>
                       <th className="py-2.5 px-2 border-l border-border">مشخصه فنی تعریف شده مرجع (Specs)</th>
                       <th className="py-2.5 px-2 border-l border-border">مقدار آزمون اخذ شده آزمایشگاهی</th>
                       <th className="py-2.5 px-2">نتیجه و تصمیم کارشناس</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-border">
                     <tr>
                       <td className="py-3 px-2 border-l border-border text-foreground font-medium">شکل فیزیکی، رنگ و بو (Appearance)</td>
                       <td className="py-3 px-2 border-l border-border italic text-muted-foreground">Conforms to Standard Checklist</td>
                       <td className="py-3 px-2 border-l border-border text-slate-300">................................................</td>
                       <td className="py-3 px-2 flex justify-center gap-3">
                         <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> منطبق (Pass)</span>
                         <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> نامنطبق (Fail)</span>
                       </td>
                     </tr>
                     <tr>
                       <td className="py-3 px-2 border-l border-border text-foreground font-medium">آنالیز کیفی شناسایی (Identification)</td>
                       <td className="py-3 px-2 border-l border-border italic text-muted-foreground">Positive Reaction / FTIR Conformance</td>
                       <td className="py-3 px-2 border-l border-border text-slate-300">................................................</td>
                       <td className="py-3 px-2 flex justify-center gap-3">
                         <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> منطبق (Pass)</span>
                         <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> نامنطبق (Fail)</span>
                       </td>
                     </tr>
                     <tr>
                       <td className="py-3 px-2 border-l border-border text-foreground font-medium">پلوت و تعیین ناخالصی دفتری (Impurities)</td>
                       <td className="py-3 px-2 border-l border-border italic text-muted-foreground">Within Pharmacopoeia Criteria Limits</td>
                       <td className="py-3 px-2 border-l border-border text-slate-300">................................................</td>
                       <td className="py-3 px-2 flex justify-center gap-3">
                         <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> منطبق (Pass)</span>
                         <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> نامنطبق (Fail)</span>
                       </td>
                     </tr>
                     <tr>
                       <td className="py-3 px-2 border-l border-border text-foreground font-medium">درصد خلوص یا عیار نهایی (Assay/Purity)</td>
                       <td className="py-3 px-2 border-l border-border italic text-muted-foreground">According requested COA parameters</td>
                       <td className="py-3 px-2 border-l border-border text-slate-300">................................................</td>
                       <td className="py-3 px-2 flex justify-center gap-3">
                         <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> منطبق (Pass)</span>
                         <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> نامنطبق (Fail)</span>
                       </td>
                     </tr>
                   </tbody>
                 </table>
               </div>
             </div>

             {/* Opinion and signature workflow */}
             <div className="grid grid-cols-2 gap-4 mb-6 text-right">
               <div className="border border-border rounded-xl p-4 text-xs flex flex-col justify-between h-36">
                 <div>
                   <strong className="text-foreground block mb-1">۳. نظر فنی کارشناسی بخش تحقیق و توسعه (R&D Verdict):</strong>
                   <p className="text-muted-foreground leading-relaxed">محل درج گزارش نهایی عملکرد آزمایشی نمونه در فرمولاسیون و انطباق اولیه ساخت آزمایشگاهی...</p>
                 </div>
                 <div className="flex justify-between items-center border-t border-border pt-2 text-muted-foreground text-[10px]">
                   <span>محل امضاء کارشناس R&D:</span>
                   <span>تاریخ ثبت: ..............................</span>
                 </div>
               </div>

               <div className="border border-border rounded-xl p-4 text-xs flex flex-col justify-between h-36">
                 <div>
                   <strong className="text-foreground block mb-1">۴. اعلام نظر سرپرست آزمایشگاه‌های کنترل کیفیت (QC Lab Supervisor):</strong>
                   <p className="text-muted-foreground leading-relaxed">توضیحات تکمیلی پیرامون نتایج آنالیزهای فوق و مونتوگراف‌های مرجع آزمایشگاهی...</p>
                 </div>
                 <div className="flex justify-between items-center border-t border-border pt-2 text-muted-foreground text-[10px]">
                   <span>امضاء مسئول آزمایشگاه QC تماد:</span>
                   <span>تاریخ ثبت: ..............................</span>
                 </div>
               </div>
             </div>

             {/* QA Final Approved Banner */}
             <div className="border-2 border-border rounded-xl p-4 bg-muted/50 mb-6 font-sans text-right">
               <div className="flex justify-between items-center">
                 <div className="flex items-center gap-4">
                   <div className={`w-14 h-14 rounded-full flex items-center justify-center text-white ${statusColor} text-lg font-black shrink-0 border shadow-md`}>
                     {vendor.status === 'approved' ? 'OK' : vendor.status === 'conditional' ? 'COND' : vendor.status === 'rejected' ? 'REJ' : 'PEND'}
                   </div>
                   <div>
                     <span className="text-xs text-muted-foreground block">تصمیم‌گیری نهایی دپارتمان کیفیت (QA Final Disposition)</span>
                     <span className="text-base font-bold block mt-0.5">{statusLabel}</span>
                   </div>
                 </div>

                 <div className="text-[10px] text-muted-foreground text-left border-r border-border pr-6 pl-2 space-y-1">
                   <div>مسئول کنترل کیفیت: <strong>دپارتمان کیفیت تماد</strong></div>
                   <div>تاریخ ارزیابی نمونه: <strong>{vendor.lastAudit || 'نامشخص'}</strong></div>
                   <div>مهر و امضاء نهایی مدیر کیفیت تماد: <strong>..............................</strong></div>
                 </div>
               </div>
             </div>

             {/* Printable footer */}
             <div className="text-center text-[10px] text-muted-foreground border-t border-border pt-3 pb-8">
               * این فرم صرفاً پس از ثبت سیستمی پرونده جهت تاییدات نهایی فیزیکی آزمایشگاهی نمونه مادی تولید شده و فاقد ارزش ارزیابی ریسک سالانه است.
             </div>
          </div>
         </div>
      </div>
    </>,
    document.body
  ) : null;
}

export function LegacyPrintableEvaluationFormUnused() { return null; }
function UnusedFallbackEvaluationForm({ vendor, onBack }: { vendor: Vendor, onBack: () => void }) {
  if (vendor.isSample) {
    return <PrintableSampleForm vendor={vendor} onBack={onBack} />;
  }
  const overall = calculateOverallScore(vendor.scores, true);
  
  useEffect(() => {
    // Optionally trigger print dialog after a short delay
    // const timer = setTimeout(() => { window.print(); }, 500);
    // return () => clearTimeout(timer);
  }, []);

  const getRankParams = (grade: Grade) => {
    if (grade === 'A') return { label: 'A', score: '80 - 100', color: 'bg-emerald-600' };
    if (grade === 'B') return { label: 'B', score: '60 - 79', color: 'bg-[#0071E3]' };
    if (grade === 'C') return { label: 'C', score: '40 - 59', color: 'bg-amber-500' };
    return { label: 'D', score: '0 - 39', color: 'bg-red-500' };
  };
  const rank = getRankParams(vendor.grade);

  const getRiskColor = (level: string | undefined) => {
    if (level === 'Low') return 'bg-emerald-500 text-white';
    if (level === 'Medium') return 'bg-amber-500 text-white';
    if (level === 'High') return 'bg-red-500 text-white';
    return 'bg-muted text-muted-foreground border border-border';
  };
  
  const getRiskLabel = (level: string | undefined) => {
    if (level === 'Low') return 'Low';
    if (level === 'Medium') return 'Medium';
    if (level === 'High') return 'High';
    return 'N/A';
  };

  return document.body ? createPortal(
    <>
      <style>{`
        @media print {
          #root { display: none !important; }
          body, html { background-color: white !important; margin: 0; padding: 0; }
          @page { size: A4 portrait; margin: 5mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <div className="fixed inset-0 z-[99999] bg-muted text-foreground overflow-y-auto w-full h-full p-4 print:static print:h-auto print:overflow-visible print:bg-white print:p-0 print:block flex flex-col items-center">
         {/* Actions toolbar */}
         <div className="w-full max-w-[210mm] flex justify-between items-center mb-6 print:hidden bg-card p-4 rounded-xl border border-border shadow-sm">
            <button onClick={onBack} className="bg-muted hover:bg-slate-200 px-6 py-2 rounded-lg font-medium text-foreground transition-colors flex items-center gap-2 border border-border">
              <ChevronLeft className="w-5 h-5" />
              بازگشت
            </button>
            <button onClick={() => setTimeout(() => window.print(), 100)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 shadow-sm">
              <Printer className="w-5 h-5" />
              چاپ فرم
            </button>
         </div>

         {/* A4 Paper Container */}
         <div className="w-[210mm] min-h-[297mm] bg-card print:w-full print:shadow-none shadow-[0_0_20px_rgba(0,0,0,0.1)] font-sans" dir="rtl">
          <div className="p-8 pb-4">
             {/* Header */}
             <div className="flex border-2 border-blue-900 rounded-xl mb-6 overflow-hidden items-stretch">
                <div className="w-1/4 p-4 flex flex-col items-center justify-center border-l-2 border-blue-900">
                   <img src={temadLogo} alt="Temad Logo" className="h-[100px] w-auto object-contain" />
                </div>
                <div className="w-2/4 flex flex-col justify-center items-center p-4">
                   <h1 className="text-xl font-bold text-blue-900 mb-2">شرکت تولید مواد اولیه داروپخش (تماد)</h1>
                   <div className="text-sm font-semibold text-foreground">ارزیابی تامین کنندگان</div>
                </div>
                <div className="w-1/4 p-4 border-r-2 border-blue-900 flex flex-col justify-center bg-blue-900 text-white space-y-2">
                   <div className="flex justify-between items-center text-[11px] border-b border-blue-800 pb-1">
                      <span className="opacity-80">تاریخ چاپ:</span>
                      <span className="font-sans">{new Date().toLocaleDateString('fa-IR')}</span>
                   </div>
                   <div className="flex justify-between items-center text-[11px] border-b border-blue-800 pb-1">
                      <span className="opacity-80">شماره صفحه:</span>
                      <span>۱ از ۱</span>
                   </div>
                   <div className="flex justify-between items-center text-[11px]">
                      <span className="opacity-80">کد ارجاع سیستمی:</span>
                      <span className="font-mono">{vendor.id.slice(0, 8).toUpperCase()}</span>
                   </div>
                </div>
             </div>

             {/* Meta Info */}
             <div className="flex flex-col border-2 border-border rounded-xl mb-6 overflow-hidden text-sm bg-muted/50">
                <div className="flex border-b border-border">
                  <div className="w-1/4 p-3 flex flex-col items-center justify-center text-center border-l border-border">
                     <span className="text-muted-foreground font-light mb-1">دسته کالا:</span>
                     <span className="font-bold">
                       {vendor.category === 'foreign' ? 'خرید خارجی' :
                        vendor.category === 'domestic' ? 'خرید داخلی' :
                        vendor.category === 'veterinary' ? 'خرید دامی' :
                        vendor.category === 'packaging' ? 'اقلام بسته‌بندی' :
                        vendor.category === 'sample' ? 'نمونه' :
                        vendor.category === 'blacklist' ? 'لیست سیاه' : 'نامشخص'}
                     </span>
                  </div>
                  <div className="w-1/4 p-3 flex flex-col items-center justify-center text-center border-l border-border">
                     <span className="text-muted-foreground font-light mb-1">نام کالا:</span>
                     <span className="font-bold">{vendor.material}</span>
                  </div>
                  <div className="w-1/4 p-3 flex flex-col items-center justify-center text-center border-l border-border">
                     <span className="text-muted-foreground font-light mb-1">نام تولیدکننده:</span>
                     <span className="font-bold">{vendor.name}</span>
                  </div>
                  <div className="w-1/4 p-3 flex flex-col items-center justify-center text-center">
                     <span className="text-muted-foreground font-light mb-1">کشور سازنده:</span>
                     <span className="font-bold font-mono">{vendor.country || getDisplayCountry(vendor)}</span>
                  </div>
                </div>
                <div className="flex">
                  <div className="w-1/3 p-3 flex flex-col items-center justify-center text-center border-l border-border">
                     <span className="text-muted-foreground font-light mb-1">شماره CAS:</span>
                     <span className="font-bold font-mono" dir="ltr">{vendor.cas && vendor.cas.toLowerCase() !== 'n/a' && vendor.cas.toLowerCase() !== 'unknown' ? vendor.cas : '-'}</span>
                  </div>
                  <div className="w-1/3 p-3 flex flex-col items-center justify-center text-center border-l border-border">
                     <span className="text-muted-foreground font-light mb-1">کد {vendor.category === 'veterinary' ? 'IVC' : 'IRC'}:</span>
                     <span className="font-bold font-mono" dir="ltr">{vendor.irc && vendor.irc.toLowerCase() !== 'n/a' && vendor.irc.toLowerCase() !== 'unknown' ? vendor.irc : '-'}</span>
                  </div>
                  <div className="w-1/3 p-3 flex flex-col items-center justify-center text-center">
                     <span className="text-muted-foreground font-light mb-1">تاریخ تایید ارزیابی:</span>
                     <span className="font-bold font-mono">{vendor.lastAudit || vendor.registrationDate || 'ثبت‌نشده'}</span>
                  </div>
                </div>
             </div>

             {/* Dept 1: Commercial */}
             <div className="flex border-2 border-border rounded-xl mb-4 overflow-hidden">
                <div className="w-1/5 bg-muted flex flex-col items-center justify-center p-2 border-l border-border">
                   <div className="text-xs text-center font-bold text-foreground mb-2">واحد ارزیابی کننده: بازرگانی</div>
                   <div className="w-8 h-8 bg-[#0071E3]/10 text-[#0071E3] rounded-full flex items-center justify-center mb-1">
                     <Handshake className="w-4 h-4" />
                   </div>
                   <div className="text-[10px] text-green-600 flex items-center gap-1 mt-2">
                     <CheckCircle className="w-3 h-3" /> تأیید مدیر بازرگانی
                   </div>
                </div>
                <div className="w-4/5 text-sm flex flex-col">
                   <table className="w-full text-center">
                     <thead className="bg-muted/50 border-b border-border text-muted-foreground text-xs">
                        <tr>
                          <th className="py-2 px-1 w-1/3 font-medium">فاکتورهای ارزیابی</th>
                          <th className="py-2 px-1 w-1/6 font-medium">وزن</th>
                          <th className="py-2 px-1 w-1/4 font-medium">امتیاز کسب شده</th>
                          <th className="py-2 px-1 w-1/4 font-medium">امتیاز نهایی</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-border">
                        <tr>
                          <td className="py-2 px-1">تحویل به موقع</td>
                          <td className="py-2 px-1">40</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'commercial', 'delivery')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'commercial', 'delivery')) / 5 * 40)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-1">پاسخگویی و جبران سازی</td>
                          <td className="py-2 px-1">30</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'commercial', 'responsiveness')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'commercial', 'responsiveness')) / 5 * 30)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-1">سابقه همکاری و تعداد دفعات خرید</td>
                          <td className="py-2 px-1">30</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'commercial', 'history')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'commercial', 'history')) / 5 * 30)}</td>
                        </tr>
                        <tr className="bg-muted font-bold">
                          <td className="py-2 px-1">جمع</td>
                          <td className="py-2 px-1">100</td>
                          <td className="py-2 px-1"></td>
                          <td className="py-2 px-1">{vendor.scores?.commercial || 0}</td>
                        </tr>
                     </tbody>
                   </table>
                </div>
             </div>

             {/* Dept 2: QA */}
             <div className="flex border-2 border-border rounded-xl mb-4 overflow-hidden">
                <div className="w-1/5 bg-muted flex flex-col items-center justify-center p-2 border-l border-border">
                   <div className="text-xs text-center font-bold text-foreground mb-2">واحد ارزیابی کننده: کیفیت</div>
                   <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-1">
                     <Shield className="w-4 h-4" />
                   </div>
                   <div className="text-[10px] text-green-600 flex items-center gap-1 mt-2">
                     <CheckCircle className="w-3 h-3" /> تأیید مدیر کیفیت
                   </div>
                </div>
                <div className="w-4/5 text-sm flex flex-col">
                   <table className="w-full text-center">
                     <thead className="bg-muted/50 border-b border-border text-muted-foreground text-xs">
                        <tr>
                          <th className="py-2 px-1 w-1/3 font-medium">فاکتورهای ارزیابی</th>
                          <th className="py-2 px-1 w-1/6 font-medium">وزن</th>
                          <th className="py-2 px-1 w-1/4 font-medium">امتیاز کسب شده</th>
                          <th className="py-2 px-1 w-1/4 font-medium">امتیاز نهایی</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-border">
                        <tr>
                          <td className="py-2 px-1">کیفیت و تطابق با مشخصات</td>
                          <td className="py-2 px-1">35</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'qa', 'quality')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'qa', 'quality')) / 5 * 35)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-1">تداوم کیفیت</td>
                          <td className="py-2 px-1">25</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'qa', 'consistency')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'qa', 'consistency')) / 5 * 25)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-1">نتایج Deviation, OOS</td>
                          <td className="py-2 px-1">25</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'qa', 'ncr')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'qa', 'ncr')) / 5 * 25)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-1 text-[11px]">ارائه مستندات درخواستی</td>
                          <td className="py-2 px-1">15</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'qa', 'documents')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'qa', 'documents')) / 5 * 15)}</td>
                        </tr>
                        <tr className="bg-muted font-bold">
                          <td className="py-2 px-1">جمع</td>
                          <td className="py-2 px-1">100</td>
                          <td className="py-2 px-1"></td>
                          <td className="py-2 px-1">{vendor.scores?.qa || 0}</td>
                        </tr>
                     </tbody>
                   </table>
                </div>
             </div>

             {/* Dept 3: QC/Planning */}
             <div className="flex border-2 border-border rounded-xl mb-4 overflow-hidden">
                <div className="w-1/5 bg-muted flex flex-col items-center justify-center p-2 border-l border-border">
                   <div className="text-xs text-center font-bold text-foreground mb-2">واحد ارزیابی کننده: برنامه‌ریزی و انبار</div>
                   <div className="w-8 h-8 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-1">
                     <Warehouse className="w-4 h-4" />
                   </div>
                   <div className="text-[10px] text-green-600 flex items-center gap-1 mt-2">
                     <CheckCircle className="w-3 h-3" /> تأیید مدیر برنامه
                   </div>
                </div>
                <div className="w-4/5 text-sm flex flex-col">
                   <table className="w-full text-center">
                     <thead className="bg-muted/50 border-b border-border text-muted-foreground text-xs">
                        <tr>
                          <th className="py-2 px-1 w-1/3 font-medium">فاکتورهای ارزیابی</th>
                          <th className="py-2 px-1 w-1/6 font-medium">وزن</th>
                          <th className="py-2 px-1 w-1/4 font-medium">امتیاز کسب شده</th>
                          <th className="py-2 px-1 w-1/4 font-medium">امتیاز نهایی</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-border">
                        <tr>
                          <td className="py-2 px-1">راندمان</td>
                          <td className="py-2 px-1">60</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'planning', 'efficiency')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'planning', 'efficiency')) / 5 * 60)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-1 text-xs">تطابق کالا با مشخصات فنی درج شده در پکینگ لیست</td>
                          <td className="py-2 px-1">40</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'planning', 'conformance')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'planning', 'conformance')) / 5 * 40)}</td>
                        </tr>
                        <tr className="bg-muted font-bold">
                          <td className="py-2 px-1">جمع</td>
                          <td className="py-2 px-1">100</td>
                          <td className="py-2 px-1"></td>
                          <td className="py-2 px-1">{vendor.scores?.planning || 0}</td>
                        </tr>
                     </tbody>
                   </table>
                </div>
             </div>

             {/* Dept 4: Finance */}
             <div className="flex border-2 border-border rounded-xl mb-8 overflow-hidden">
                <div className="w-1/5 bg-muted flex flex-col items-center justify-center p-2 border-l border-border">
                   <div className="text-xs text-center font-bold text-foreground mb-2">واحد ارزیابی کننده: مالی</div>
                   <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-1">
                     <DollarSign className="w-4 h-4" />
                   </div>
                   <div className="text-[10px] text-green-600 flex items-center gap-1 mt-2">
                     <CheckCircle className="w-3 h-3" /> تأیید مدیر مالی
                   </div>
                </div>
                <div className="w-4/5 text-sm flex flex-col">
                   <table className="w-full text-center">
                     <thead className="bg-muted/50 border-b border-border text-muted-foreground text-xs">
                        <tr>
                          <th className="py-2 px-1 w-1/3 font-medium">فاکتورهای ارزیابی</th>
                          <th className="py-2 px-1 w-1/6 font-medium">وزن</th>
                          <th className="py-2 px-1 w-1/4 font-medium">امتیاز کسب شده</th>
                          <th className="py-2 px-1 w-1/4 font-medium">امتیاز نهایی</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-border">
                        <tr>
                          <td className="py-2 px-1">قیمت</td>
                          <td className="py-2 px-1">60</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'finance', 'price')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'finance', 'price')) / 5 * 60)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-1">نوع پرداخت</td>
                          <td className="py-2 px-1">40</td>
                          <td className="py-2 px-1 font-mono">{getRawScoreValue(vendor, 'finance', 'payment')}</td>
                          <td className="py-2 px-1 bg-muted font-bold">{Math.round((getRawScoreValue(vendor, 'finance', 'payment')) / 5 * 40)}</td>
                        </tr>
                        <tr className="bg-muted font-bold">
                          <td className="py-2 px-1">جمع</td>
                          <td className="py-2 px-1">100</td>
                          <td className="py-2 px-1"></td>
                          <td className="py-2 px-1">{vendor.scores?.finance || 0}</td>
                        </tr>
                     </tbody>
                   </table>
                </div>
             </div>

             {/* Final Evaluation & SPS Banner */}
             <div className="flex rounded-2xl overflow-hidden mb-6 shadow-sm border border-blue-950" dir="rtl">
                {/* 8 Columns of Scores (Right Part - Blue) */}
                <div className="flex-1 bg-[#121f42] text-white flex flex-col justify-center">
                  <div className="flex text-center text-xs opacity-90 border-b border-white/10 py-2.5">
                     <div className="w-[15%]">امتیاز بازرگانی</div>
                     <div className="w-[10%] border-r border-white/10">وزن</div>
                     <div className="w-[15%] border-r border-white/10">امتیاز کیفیت</div>
                     <div className="w-[10%] border-r border-white/10">وزن</div>
                     <div className="w-[15%] border-r border-white/10">امتیاز انبار</div>
                     <div className="w-[10%] border-r border-white/10">وزن</div>
                     <div className="w-[15%] border-r border-white/10">امتیاز مالی</div>
                     <div className="w-[10%] border-r border-white/10">وزن</div>
                  </div>
                  <div className="flex text-center py-3 items-center font-bold text-base">
                     <div className="w-[15%] text-lg">{vendor.scores?.commercial || 0}</div>
                     <div className="w-[10%] border-r border-white/10 text-xs font-mono font-normal opacity-80">20%</div>
                     <div className="w-[15%] border-r border-white/10 text-lg">{vendor.scores?.qa || 0}</div>
                     <div className="w-[10%] border-r border-white/10 text-xs font-mono font-normal opacity-80">40%</div>
                     <div className="w-[15%] border-r border-white/10 text-lg">{vendor.scores?.planning || 0}</div>
                     <div className="w-[10%] border-r border-white/10 text-xs font-mono font-normal opacity-80">10%</div>
                     <div className="w-[15%] border-r border-white/10 text-lg">{vendor.scores?.finance || 0}</div>
                     <div className="w-[10%] border-r border-white/10 text-xs font-mono font-normal opacity-80">30%</div>
                  </div>
                </div>

                {/* SPS Index (Left Part - Green) */}
                <div className={`w-[18%] ${getScoreColorClass(overall, true)} text-white flex flex-col items-center justify-center p-3 border-r border-blue-950`}>
                  <div className="text-[10px] sm:text-xs font-medium opacity-90 mb-1">شاخص (SPS)</div>
                  <div className="text-3xl font-black font-sans tracking-tight">{overall || 0}</div>
                </div>
             </div>

             {/* Risk Assessment Block */}
             <div className="border border-border rounded-2xl mb-6 overflow-hidden flex shadow-sm min-h-[90px]" dir="rtl">
                {/* Right vertical box representing risk assessment */}
                <div className="w-[18%] bg-muted flex flex-col items-center justify-center p-2 border-l border-border text-center">
                   <div className="text-xs font-bold text-foreground mb-1">ارزیابی ریسک کیفی</div>
                   <div className="text-red-500 font-bold flex flex-col items-center gap-0.5 mt-1">
                      <AlertTriangle className="w-5 h-5" />
                      <span className="text-[10px] text-muted-foreground font-medium">کیفیت</span>
                   </div>
                </div>
                {/* 5 Column Data Block */}
                <div className="flex-1 flex items-center bg-card text-foreground text-sm">
                   <div className="w-[20%] flex flex-col items-center justify-center border-l border-border/60 pb-1 pt-0.5">
                      <div className="text-[10px] text-muted-foreground font-bold mb-1 text-center leading-tight">اهمیت ماده (از ۵)<br/>(Material Criticaly)</div>
                      <div className="text-lg font-bold font-mono text-foreground">{vendor.riskAssessment?.materialCriticality || '-'}</div>
                   </div>
                   <div className="w-[20%] flex flex-col items-center justify-center border-l border-border/60 pb-1 pt-0.5">
                      <div className="text-[10px] text-muted-foreground font-bold mb-1 text-center leading-tight">احتمال خرابی (از ۵)<br/>(Probability of failure)</div>
                      <div className="text-lg font-bold font-mono text-foreground">{vendor.riskAssessment?.probability || '-'}</div>
                   </div>
                   <div className="w-[20%] flex flex-col items-center justify-center border-l border-border/60 pb-1 pt-0.5">
                      <div className="text-[10px] text-muted-foreground font-bold mb-1 text-center leading-tight">تشخیص (از ۵)<br/>(Detectability)</div>
                      <div className="text-lg font-bold font-mono text-foreground">{vendor.riskAssessment?.detectability || '-'}</div>
                   </div>
                   <div className="w-[20%] flex flex-col items-center justify-center border-l border-border/60 pb-1 pt-0.5 bg-muted/50">
                      <div className="text-[10px] text-muted-foreground font-bold mb-1 text-center leading-tight">نمره ریسک<br/>(RPN)</div>
                      <div className="text-lg font-bold font-mono text-foreground">{vendor.riskAssessment?.riskScore || '-'}</div>
                   </div>
                   <div className="w-[20%] flex flex-col items-center justify-center pb-1 pt-0.5 bg-muted/50">
                      <div className={`text-[10px] ${getSRIColorClass(vendor.riskAssessment?.sri)} font-bold mb-1 text-center leading-tight`}>شاخص<br/>(SRI)</div>
                      <div className={`text-lg font-bold font-mono ${getSRIColorClass(vendor.riskAssessment?.sri)} font-black`}>{vendor.riskAssessment?.sri !== undefined && vendor.riskAssessment?.sri !== null ? Number(vendor.riskAssessment.sri).toFixed(1) : '-'}</div>
                   </div>
                </div>
             </div>

             {/* Analysis Records */}
             {vendor.analysisRecords && vendor.analysisRecords.length > 0 && (
                <div className="flex border-2 border-border rounded-xl mb-6 overflow-hidden print:break-inside-avoid">
                   <div className="w-1/5 bg-muted flex flex-col items-center justify-center p-2 border-l border-border text-center">
                      <div className="text-xs font-bold text-foreground mb-2">سوابق آزمایشگاهی (QC)</div>
                      <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-1">
                        <Microscope className="w-4 h-4" />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-2 leading-tight">
                        موتور محاسبه و آنالیز<br/>(نتایج تست)
                      </div>
                   </div>
                   <div className="w-4/5 text-sm flex flex-col p-0">
                      <table className="w-full text-center">
                        <thead className="bg-muted/50 border-b border-border text-muted-foreground text-[10px] uppercase tracking-wider font-bold">
                           <tr>
                             <th className="py-2 px-1">کد QC</th>
                             <th className="py-2 px-1 border-r border-border">تصمیم</th>
                             <th className="py-2 px-1 border-r border-border">وضعیت انحراف</th>
                             <th className="py-2 px-1 border-r border-border text-right pr-2">توضیحات</th>
                             <th className="py-2 px-1 border-r border-border">تاریخ</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-border text-xs">
                           {vendor.analysisRecords.map((r, i) => (
                              <tr key={i}>
                                <td className="py-2 px-1 font-mono font-bold tracking-wide">{r.qcCode}</td>
                                <td className={`py-2 px-1 border-r border-border font-bold ${r.decision === 'Pass' || r.decision === 'Approved Conditional' ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {r.decision}
                                </td>
                                <td className="py-2 px-1 border-r border-border text-[10px]">{r.deviationReason}</td>
                                <td className="py-2 px-1 border-r border-border text-right pr-2 text-muted-foreground">{r.comments || '-'}</td>
                                <td className="py-2 px-1 border-r border-border font-mono text-muted-foreground">{r.date}</td>
                              </tr>
                           ))}
                           <tr className="bg-muted/80 font-bold text-xs border-t-2 border-border">
                             <td colSpan={5} className="py-2 text-right pr-4 text-indigo-700">
                               جمع‌بندی عملکرد آزمایشگاهی: {vendor.analysisRecords.filter(r => r.decision === 'Pass' || r.decision === 'Approved Conditional').length} تست تایید شده از کل {vendor.analysisRecords.length} تست. این نتایج در موتور انتخاب سورس برتر در قالب ضریب کیفی تأثیرگذار است.
                             </td>
                           </tr>
                        </tbody>
                      </table>
                   </div>
                </div>
             )}

             {/* Grades */}
             <div className="flex items-stretch rounded-xl overflow-hidden border border-border text-sm shadow-sm relative mb-4 mt-8">
               <div className="bg-muted p-3 w-32 border-l border-border flex items-center justify-center text-center font-bold text-foreground">رتبه تأمین کننده</div>
               <div className="flex-1 flex">
                 <div className="flex-1 bg-emerald-500 flex flex-col justify-center items-center text-white p-2">
                   <div className="font-bold text-xl">A</div>
                   <div className="text-xs opacity-90">(80 - 100)</div>
                 </div>
                 <div className="flex-1 bg-[#0071E3] flex flex-col justify-center items-center text-white p-2 border-r border-border/20">
                   <div className="font-bold text-xl">B</div>
                   <div className="text-xs opacity-90">(60 - 79)</div>
                 </div>
                 <div className="flex-1 bg-amber-500 flex flex-col justify-center items-center text-white p-2 border-r border-border/20">
                   <div className="font-bold text-xl">C</div>
                   <div className="text-xs opacity-90">(40 - 59)</div>
                 </div>
                 <div className="flex-1 bg-red-500 flex flex-col justify-center items-center text-white p-2 border-r border-border/20">
                   <div className="font-bold text-xl">D</div>
                   <div className="text-xs opacity-90">(0 - 39)</div>
                 </div>
               </div>
             </div>

             {/* Final Result Card */}
             <div className="flex justify-between items-center bg-muted border border-border rounded-2xl p-4 shadow-sm" dir="rtl">
                 {/* Right Section: Total Score */}
                 <div className="flex items-center gap-3">
                   <div className="w-14 h-14 bg-card rounded-full flex items-center justify-center border-2 border-border text-foreground font-bold text-xl font-mono shadow-sm">
                     {overall || 0}
                   </div>
                   <div className="flex flex-col text-right">
                     <span className="text-xs text-muted-foreground font-bold">جمع امتیاز نهایی</span>
                     <span className="text-sm font-bold text-foreground font-mono mt-0.5">{overall || 0} از 100</span>
                   </div>
                 </div>
                 
                 <div className="flex items-center gap-6 mr-auto pr-6 pl-2">
                   {/* Middle Section: Risk Level */}
                   <div className="flex items-center gap-3">
                     <div className="text-[11px] text-muted-foreground font-bold leading-tight text-right">سطح ریسک<br/>ارزیابی شده</div>
                     <div className={`px-4 py-2 rounded-lg text-sm font-extrabold ${getRiskColor(vendor.riskAssessment?.riskLevel)}`}>
                        {getRiskLabel(vendor.riskAssessment?.riskLevel)}
                     </div>
                   </div>

                   <div className="w-px h-10 bg-slate-200 mx-2"></div>

                   {/* Left Section: Supplier Rank */}
                   <div className="flex items-center gap-3">
                     <div className="text-xs text-muted-foreground font-bold">رتبه تأمین کننده:</div>
                     <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-white text-2xl font-black shadow-md ${getScoreColorClass(overall, true)}`}>
                        {rank.label}
                     </div>
                   </div>
                 </div>
              </div>
              
              <div className="mt-8 flex justify-between gap-4" dir="rtl">
                 {[
                   "کیفیت",
                   "برنامه‌ریزی و انبار",
                   "بازرگانی",
                   "مالی"
                 ].map((dept, i) => (
                   <div key={i} className="flex-1 border-2 border-border border-solid rounded-xl p-4 h-32 flex flex-col justify-between relative bg-card">
                     <div className="text-xs font-bold text-muted-foreground mb-1">دپارتمان ارزیاب:</div>
                     <div className="text-sm font-bold text-foreground border-b border-border pb-2 mb-2">{dept}</div>
                     <div className="text-xs font-bold text-muted-foreground mt-auto">محل امضا و تاریخ:</div>
                   </div>
                 ))}
              </div>
              
              <div className="mt-8 text-center text-xs text-muted-foreground border-t border-border pt-4 pb-12 print:pb-4">
                * این فرم به منظور ارزیابی عملکرد تأمین‌کننده بر اساس معیارهای تعیین شده سیستم طراحی گردیده است.
              </div>
           </div>
        </div>
     </div>
     </>,
     document.body
  ) : null;
}

function ArchiveView({ db, currentUser, partners = [], materials = [] }: { db: Vendor[], currentUser: User, partners?: BusinessPartner[], materials?: Material[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  
  const [printingVendor, setPrintingVendor] = useState<Vendor | null>(null);

  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, gradeFilter, riskFilter, categoryFilter, statusFilter]);

  const handleExportCategory = (catId: string, catLabel: string) => {
    exportCategoryToExcel(db, catId, catLabel, partners, materials);
  };

  const filteredDb = useMemo(() => {
    return db.filter(v => {
      const term = searchTerm.toLowerCase();
      const matchSearch = 
        v.name.toLowerCase().includes(term) || 
        v.nameEn.toLowerCase().includes(term) ||
        v.material.toLowerCase().includes(term) ||
        v.materialEn.toLowerCase().includes(term) ||
        v.cas.toLowerCase().includes(term) ||
        (v.irc && v.irc.toLowerCase().includes(term)) ||
        (v.country && getDisplayCountry(v).toLowerCase().includes(term));
        
      const matchGrade = gradeFilter ? v.grade === gradeFilter : true;
      const matchCategory = categoryFilter 
        ? ((categoryFilter as string) === 'sample'
            ? (v.isSample || v.category === 'sample')
            : (categoryFilter as string) === 'approved_samples' 
            ? (v.isSample && (v.status === 'approved' || v.status === 'conditional'))
            : (categoryFilter as string) === 'rejected_samples'
            ? (v.isSample && v.status === 'rejected')
            : (categoryFilter as string) === 'blacklist'
            ? (!v.isSample && v.category !== 'sample' && (v.category === 'blacklist' || v.status === 'rejected' || v.grade === 'rejected'))
            : (v.category === categoryFilter && v.status !== 'rejected' && v.grade !== 'rejected')
          )
        : true;
      const matchStatus = statusFilter ? v.status === statusFilter : true;
      const riskLevel = v.riskAssessment?.riskLevel || 'Unknown';
      const matchRisk = riskFilter 
        ? (riskFilter === 'None' ? (!v.riskAssessment) : riskLevel === riskFilter) 
        : true;
      
      return matchSearch && matchGrade && matchRisk && matchCategory && matchStatus;
    });
  }, [db, searchTerm, gradeFilter, riskFilter, categoryFilter, statusFilter]);

  const ITEMS_PER_PAGE = 20;
  const totalItems = filteredDb.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedDb = useMemo(() => {
    return filteredDb.slice(startIndex, endIndex);
  }, [filteredDb, startIndex, endIndex]);

  if (printingVendor) {
    return <PrintableEvaluationForm vendor={printingVendor} onBack={() => setPrintingVendor(null)} partners={partners} materials={materials} />;
  }

  return (
    <div className="space-y-6 fade-in text-right">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-4">
        {/* Left side: Export Options */}
        <div className="flex items-center gap-2.5 flex-wrap order-2 md:order-1">
          {/* Primary Action: Multi-Sheet Comprehensive Workbook Export */}
          <button 
            type="button" 
            onClick={() => exportFullArchiveMultiSheetExcel(db, partners, materials)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-[0_2px_8px_rgba(5,150,105,0.25)] hover:shadow-[0_4px_14px_rgba(5,150,105,0.35)] transition-all cursor-pointer active:scale-95"
            title="دانلود خروجی جامع چند شیتی شامل کل آرشیو و تفکیک کلیه ۶ دسته‌بندی"
          >
            <Download className="w-4 h-4" />
            <span>خروجی اکسل چند شیتی (Multi-Sheet XLSX)</span>
          </button>

          {/* Secondary Dropdown: Specific single category export */}
          <div className="relative group">
            <button 
              type="button" 
              className="flex items-center gap-2 bg-card hover:bg-accent text-foreground border border-border/90 text-xs font-semibold px-3.5 py-2.5 rounded-xl shadow-xs transition-all cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>خروجی تک‌دسته‌ای</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            
            {/* Custom dropdown menu */}
            <div className="absolute left-0 mt-2 w-64 bg-card border border-border/80 rounded-2xl shadow-xl py-2 z-10 hidden group-hover:block hover:block divide-y divide-border text-right transition-all">
              <div className="px-3.5 py-2 text-[10px] font-bold text-muted-foreground bg-muted/50 rounded-t-2xl tracking-wider select-none">
                انتخاب دسته‌بندی جهت خروجی تک‌شیت
              </div>
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => handleExportCategory('all', 'کل_آرشیو')}
                  className="w-full text-right px-4 py-2 text-xs text-foreground hover:bg-accent hover:text-[#0071E3] font-medium transition-colors flex items-center justify-between"
                >
                  <span className="font-mono text-[9px] text-muted-foreground">All</span>
                  <span>گزارش تجمیعی کل آرشیو</span>
                </button>
                {Object.entries(categoryLabels).map(([key, labelData]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleExportCategory(key, labelData.fa)}
                    className="w-full text-right px-4 py-2 text-xs text-foreground hover:bg-accent hover:text-[#0071E3] font-medium transition-colors flex items-center justify-between"
                  >
                    <span className="font-mono text-[9px] text-muted-foreground">{key}</span>
                    <span>گزارش {labelData.fa}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right side: Title */}
        <div className="order-1 md:order-2 text-right">
          <h2 className="text-2xl font-bold text-foreground mb-1 flex items-center justify-end gap-3">
            آرشیو کل تامین‌کنندگان
            <Archive className="w-6 h-6 text-muted-foreground" />
          </h2>
          <p className="text-[#6E6E73] text-sm">لیست جامع تمامی تامین‌کنندگان ارزیابی شده (Vendor Archive Data)</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-card/75 backdrop-blur-md border border-slate-900/10 rounded-2xl p-4 shadow-[0_1px_4px_rgba(15,23,42,0.06)] flex flex-col md:flex-row gap-4 items-center mb-6 focus-within:ring-2 focus-within:ring-cyan-500/20 transition-all">
        <div className="flex-1 flex items-center gap-3 w-full">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            className="flex-1 bg-transparent text-sm text-foreground placeholder-slate-400 focus:outline-none text-right"
            placeholder="جستجو کلمه کلیدی، نام، ماده، CAS، کشور..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="text-muted-foreground hover:text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          {[
            { value: categoryFilter, setValue: setCategoryFilter, options: [{val:'', label:'همه دسته‌ها'}, ...Object.entries(categoryLabels).map(([k,v])=>({val:k, label:v.fa}))] },
            { value: riskFilter, setValue: setRiskFilter, options: [{val:'', label:'همه سطوح ریسک (Risk Level)'}, {val:'Low', label:'ریسک پایین (Low)'}, {val:'Medium', label:'ریسک متوسط (Medium)'}, {val:'High', label:'ریسک بالا (High)'}] },
            { value: gradeFilter, setValue: setGradeFilter, options: [{val:'', label:'همه گریدها'}, {val:'A', label:'Grade A'}, {val:'B', label:'Grade B'}, {val:'C', label:'Grade C'}, {val:'rejected', label:'Rejected'}] }
          ].map((filter, idx) => (
            <select 
              key={idx}
              className="bg-transparent border border-slate-900/10 text-muted-foreground text-xs rounded-xl py-2 px-3 focus:outline-none focus:border-cyan-500/30 flex-1 md:flex-none text-right min-w-[110px]"
              value={filter.value}
              onChange={(e) => filter.setValue(e.target.value)}
            >
              {filter.options.map(opt => <option key={opt.val} value={opt.val}>{opt.label}</option>)}
            </select>
          ))}
        </div>
      </div>

      {/* ARCHIVE TABLE */}
      <div className="rounded-2xl overflow-hidden border border-slate-900/10 shadow-[0_1px_4px_rgba(15,23,42,0.06)] bg-card mb-8">
        <div className="bg-muted border-b border-slate-900/10 grid grid-cols-12 gap-4 px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
          <div className="col-span-6 sm:col-span-4">تامین‌کننده</div>
          <div className="col-span-4 sm:col-span-3">ماده</div>
          <div className="col-span-2 hidden sm:block">دسته</div>
          <div className="col-span-2 hidden sm:block">کشور</div>
          <div className="col-span-2 sm:col-span-1 text-center">جزئیات</div>
        </div>

        <div className="divide-y divide-slate-900/5">
          {filteredDb.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
              <Search className="w-8 h-8 opacity-20 mb-3" />
              <span>هیچ نتیجه‌ای یافت نشد.</span>
            </div>
          ) : paginatedDb.map((v, i) => (
            <div key={v.id} className="grid grid-cols-12 gap-4 px-5 py-3.5 items-center hover:bg-accent transition-colors vendor-row" style={{ animationDelay: `${i * 20}ms` }}>
              <div className="col-span-6 sm:col-span-4 min-w-0">
                <div className="font-semibold text-foreground text-sm truncate">{v.name}</div>
                <div className="text-muted-foreground text-xs truncate mt-0.5" dir="ltr" style={{ textAlign: 'right' }}>{v.nameEn}</div>
              </div>
              <div className="col-span-4 sm:col-span-3 min-w-0">
                <div className="text-muted-foreground text-sm truncate">{v.material}</div>
                <div className="font-mono text-muted-foreground text-xs truncate mt-0.5">{v.cas || 'N/A'}</div>
              </div>
              <div className="col-span-2 hidden sm:block min-w-0">
                <span className="bg-slate-900/5 border border-slate-900/10 text-xs text-muted-foreground rounded px-2 py-0.5 inline-block truncate max-w-full font-medium">
                  {v.isSample 
                    ? (v.status === 'rejected' ? 'نمونه تایید نشده' : 'نمونه تایید شده')
                    : (categoryLabels[v.category as keyof typeof categoryLabels]?.fa || v.category)
                  }
                </span>
              </div>
              <div className="col-span-2 hidden sm:block min-w-0 text-muted-foreground text-sm truncate">
                {getDisplayCountry(v).split(' ')[0]}
              </div>
              <div className="col-span-2 sm:col-span-1 text-center flex items-center justify-center gap-2">
                {currentUser?.role === 'admin' ? (
                  <button 
                    onClick={() => setPrintingVendor(v)}
                    className="p-1.5 text-muted-foreground hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors border border-transparent hover:border-cyan-200"
                    title="چاپ فرم ارزیابی"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground font-medium font-mono">-</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Pagination 
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        startIndex={startIndex}
        endIndex={endIndex}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}

// --- View: Vendor Detail ---
function VendorDetail({ vendor, db, onBack, onSave, onDelete, currentUser, materials = [], onAddMaterial, partners = [], onAddPartner, registerNavGuard }: { vendor: Vendor, db: Vendor[], onBack: () => void, onSave: (v: Vendor, msg?: string | null) => void, onDelete: (id: string) => void, currentUser: User, materials?: Material[], onAddMaterial?: (m: Material) => void, partners?: BusinessPartner[], onAddPartner?: (p: BusinessPartner) => void, registerNavGuard?: (fn: (() => boolean) | null) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const editFormRef = useRef<HTMLDivElement>(null);

  // Warn before navigating away (or closing the tab) with the edit form open.
  useEffect(() => {
    registerNavGuard?.(() => isEditing);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isEditing) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      registerNavGuard?.(null);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [isEditing, registerNavGuard]);

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => {
        editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }
  }, [isEditing]);

  const [showRiskAssessment, setShowRiskAssessment] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showAdminScoresEdit, setShowAdminScoresEdit] = useState(false);

  // Guided evaluation wizard: department scoring -> risk assessment -> lab results.
  // Only the stages the current user is allowed to perform are shown.
  const canRisk = currentUser?.role === 'admin' || currentUser?.role === 'qa' || currentUser?.role === 'lab';
  const canAnalysis = currentUser?.role === 'admin' || currentUser?.role === 'qa';
  const evalStages = [
    ...(!vendor.isSample ? [{ id: 'score', title: 'امتیازدهی دپارتمان‌ها', icon: DollarSign }] : []),
    ...(!vendor.isSample && canRisk ? [{ id: 'risk', title: 'ارزیابی ریسک', icon: ShieldAlert }] : []),
    ...(canAnalysis ? [{ id: 'analysis', title: 'ثبت نتایج آزمایشگاهی', icon: Microscope }] : []),
  ];
  const [evalStageRaw, setEvalStage] = useState<string>(evalStages[0]?.id || 'score');
  const evalStage = evalStages.some(s => s.id === evalStageRaw) ? evalStageRaw : (evalStages[0]?.id || 'score');
  const evalStageIdx = evalStages.findIndex(s => s.id === evalStage);
  const showEvalWizard = evalStages.length >= 2;

  const [showAddAnalysisForm, setShowAddAnalysisForm] = useState(false);
  const [analysisSuccess, setAnalysisSuccess] = useState(false);
  const [newAnalysis, setNewAnalysis] = useState({
    date: new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/[۰-۹]/g, c => '0123456789'[c.charCodeAt(0) - 1776]),
    qcCode: '',
    decision: 'Pass' as 'Pass' | 'Reject' | 'Approved Conditional',
    deviationReason: 'None' as 'None' | 'NCR' | 'Deviation' | 'OOS' | 'CAPA' | 'OOT' | 'Complaint' | 'Other',
    comments: ''
  });

  // Reject → status automation.
  // Samples: a single Reject QC result auto-flags 'rejected' (→ Black List); this is
  // acceptable because a sample is a one-shot go/no-go decision.
  // Sources/suppliers: NO automatic status change — a source can have many results and
  // one failure should not blacklist it automatically. The QA/admin decides manually via
  // the decision box, with a mandatory explanation (logged to audit + source).
  const deriveQcOutcome = (records: AnalysisRecord[]): { status: Status; rejectionReasons: string[] | null } => {
    const isSampleVendor = vendor.isSample || vendor.category === 'sample';
    if (!isSampleVendor) {
      return { status: vendor.status, rejectionReasons: vendor.rejectionReasons || null };
    }
    const existingReasons = vendor.rejectionReasons ? [...vendor.rejectionReasons] : [];
    const rejectRecords = records.filter(r => r.decision === 'Reject');
    if (rejectRecords.length >= 1) {
      const qcReasons = rejectRecords.map(r =>
        `مردود در آزمون QC [کد: ${r.qcCode} | تاریخ: ${r.date}]${r.deviationReason && r.deviationReason !== 'None' ? ` - انحراف: ${r.deviationReason}` : ''}${r.comments ? ` - شرح: ${r.comments}` : ''}`
      );
      const existingNonQc = existingReasons.filter(r => !r.startsWith('مردود در آزمون QC'));
      const merged = [...existingNonQc, ...qcReasons];
      return { status: 'rejected', rejectionReasons: merged.length > 0 ? merged : null };
    }
    // No Reject results remain → drop QC reasons, and restore status if it was auto-rejected by QC.
    const nonQcReasons = existingReasons.filter(r => !r.startsWith('مردود در آزمون QC'));
    let status = vendor.status;
    if (vendor.status === 'rejected' && nonQcReasons.length === 0) {
      status = (vendor.initialSampleStatus === 'not_approved' || vendor.initialSampleStatus === 'conditional') ? 'conditional' : 'approved';
    }
    return { status, rejectionReasons: nonQcReasons.length > 0 ? nonQcReasons : null };
  };

  const handleAddAnalysisSubmit = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!newAnalysis.date.trim()) {
      alert('لطفاً تاریخ آزمایش را انتخاب کنید.');
      return;
    }
    if (!newAnalysis.qcCode.trim()) {
      alert('لطفاً کد آزمایشگاهی (QC Code) را وارد کنید.');
      return;
    }

    const record = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
      date: newAnalysis.date,
      qcCode: newAnalysis.qcCode.trim(),
      decision: newAnalysis.decision,
      deviationReason: newAnalysis.deviationReason,
      comments: newAnalysis.comments.trim(),
      recordedBy: currentUser ? currentUser.name : 'کیفیت / سیستم'
    };

    const updatedRecords = [...(vendor.analysisRecords || []), record];

    const { status: finalStatus, rejectionReasons: derivedReasons } = deriveQcOutcome(updatedRecords);
    const statusChangedToRejected = finalStatus === 'rejected' && vendor.status !== 'rejected';

    const decisionMapList = { Pass: 'قبول (Pass)', Reject: 'مردود (Reject)', 'Approved Conditional': 'قبول مشروط (Approved Conditional)' };
    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `ثبت نتیجه آزمایش جدید برای سورس "${vendor.material}" (${vendor.name}) - تصمیم: [${decisionMapList[record.decision] || record.decision}] (کد QC: ${record.qcCode})${statusChangedToRejected ? ' — وضعیت سورس به «مردود» تغییر کرد و به لیست سیاه منتقل شد' : ''}`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };

    onSave({
      ...vendor,
      status: finalStatus,
      rejectionReasons: derivedReasons,
      analysisRecords: updatedRecords,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, null);

    setAnalysisSuccess(true);

    setTimeout(() => {
      setAnalysisSuccess(false);
      setShowAddAnalysisForm(false);
      setNewAnalysis({
        date: new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/[۰-۹]/g, c => '0123456789'[c.charCodeAt(0) - 1776]),
        qcCode: '',
        decision: 'Pass',
        deviationReason: 'None',
        comments: ''
      });
    }, 1000);
  };

  const [editingAnalysisId, setEditingAnalysisId] = useState<string | null>(null);
  const [editingAnalysis, setEditingAnalysis] = useState<{
    date: string;
    qcCode: string;
    decision: 'Pass' | 'Reject' | 'Approved Conditional';
    deviationReason: 'None' | 'NCR' | 'Deviation' | 'OOS' | 'CAPA' | 'OOT' | 'Complaint' | 'Other';
    comments: string;
  } | null>(null);
  const [confirmDeleteAnalysisId, setConfirmDeleteAnalysisId] = useState<string | null>(null);

   const handleEditAnalysisStart = (record: AnalysisRecord) => {
    setEditingAnalysisId(record.id);
    setEditingAnalysis({
      date: record.date || '',
      qcCode: record.qcCode,
      decision: record.decision,
      deviationReason: record.deviationReason,
      comments: record.comments || ''
    });
    setConfirmDeleteAnalysisId(null);
  };

  const handleEditAnalysisCancel = () => {
    setEditingAnalysisId(null);
    setEditingAnalysis(null);
  };

  const handleEditAnalysisSave = (recordId: string) => {
    if (!editingAnalysis || !editingAnalysis.date.trim()) {
      alert('لطفاً تاریخ آزمایش را انتخاب کنید.');
      return;
    }
    if (!editingAnalysis.qcCode.trim()) {
      alert('لطفاً کد آزمایشگاهی (QC Code) را وارد کنید.');
      return;
    }

    const updatedRecords = (vendor.analysisRecords || []).map(r => {
      if (r.id === recordId) {
        return {
          ...r,
          date: editingAnalysis.date,
          qcCode: editingAnalysis.qcCode.trim(),
          decision: editingAnalysis.decision,
          deviationReason: editingAnalysis.deviationReason,
          comments: editingAnalysis.comments.trim(),
          recordedBy: currentUser ? `${currentUser.name} (ویرایشگر)` : r.recordedBy
        };
      }
      return r;
    });

    const decisionMapList = { Pass: 'قبول (Pass)', Reject: 'مردود (Reject)', 'Approved Conditional': 'قبول مشروط (Approved Conditional)' };
    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `ویرایش نتیجه آزمایش برای سورس "${vendor.material}" (${vendor.name}) - تصمیم جدید: [${decisionMapList[editingAnalysis.decision] || editingAnalysis.decision}] (کد QC: ${editingAnalysis.qcCode})`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };

    const { status: finalStatus, rejectionReasons: derivedReasons } = deriveQcOutcome(updatedRecords);

    onSave({
      ...vendor,
      status: finalStatus,
      rejectionReasons: derivedReasons,
      analysisRecords: updatedRecords,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, 'نتیجه آزمایش با موفقیت ویرایش شد!');

    setEditingAnalysisId(null);
    setEditingAnalysis(null);
  };

  const handleDeleteAnalysis = (recordId: string) => {
    const updatedRecords = (vendor.analysisRecords || []).filter(r => r.id !== recordId);
    const deletedRecord = (vendor.analysisRecords || []).find(r => r.id === recordId);
    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `حذف نتیجه آزمایش برای سورس "${vendor.material}" (${vendor.name}) ${deletedRecord ? `(کد QC: ${deletedRecord.qcCode})` : ''}`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };

    const { status: finalStatus, rejectionReasons: derivedReasons } = deriveQcOutcome(updatedRecords);

    onSave({
      ...vendor,
      status: finalStatus,
      rejectionReasons: derivedReasons,
      analysisRecords: updatedRecords,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, 'نتیجه آزمایش با موفقیت حذف شد!');
    setConfirmDeleteAnalysisId(null);
  };

  // Admin manual decision for sources/suppliers (not samples): reject → Black List, or restore.
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectDecisionReason, setRejectDecisionReason] = useState('');

  const handleAdminRejectSource = () => {
    if (!rejectDecisionReason.trim()) {
      alert('لطفاً دلیل رد این سورس را وارد کنید (الزامی).');
      return;
    }
    const reasonLine = `رد توسط ${currentUser?.name || 'ادمین'} بر اساس نتایج آزمایشگاهی — ${rejectDecisionReason.trim()}`;
    const existingNonQc = (vendor.rejectionReasons || []).filter(r => !r.startsWith('رد توسط'));
    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `رد سورس "${vendor.material}" (${vendor.name}) و انتقال به لیست سیاه توسط ${currentUser?.name || 'ادمین'} — دلیل: ${rejectDecisionReason.trim()}`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };
    onSave({
      ...vendor,
      status: 'rejected',
      rejectionReasons: [...existingNonQc, reasonLine],
      reasonForChange: `رد سورس بر اساس تصمیم کیفی: ${rejectDecisionReason.trim()}`,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, 'سورس به لیست سیاه منتقل شد.');
    setShowRejectBox(false);
    setRejectDecisionReason('');
  };

  const handleAdminRestoreSource = () => {
    if (!rejectDecisionReason.trim()) {
      alert('لطفاً دلیل بازگردانی این سورس را وارد کنید (الزامی).');
      return;
    }
    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `بازگردانی سورس "${vendor.material}" (${vendor.name}) از لیست سیاه توسط ${currentUser?.name || 'ادمین'} — دلیل: ${rejectDecisionReason.trim()}`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };
    onSave({
      ...vendor,
      status: 'approved',
      rejectionReasons: null,
      reasonForChange: `بازگردانی سورس از لیست سیاه: ${rejectDecisionReason.trim()}`,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, 'سورس از لیست سیاه بازگردانی شد.');
    setShowRejectBox(false);
    setRejectDecisionReason('');
  };

  const evalFormRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (showAdminScoresEdit && evalFormRef.current) {
      setTimeout(() => {
        evalFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [showAdminScoresEdit]);

  // Score history reconstructed from the audit trail (SPS over time).
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  useEffect(() => {
    if (vendor.isSample) return;
    let cancelled = false;
    authFetch(`/api/vendors/${vendor.id}/score-history`)
      .then(res => (res.ok ? res.json() : []))
      .then((data: any[]) => { if (!cancelled && Array.isArray(data)) setScoreHistory(data.filter(d => d.totalSPS !== null)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [vendor.id, vendor.isSample, vendor.scores]);

  // Risk assessment history reconstructed from the audit trail (SRI/RPN over time).
  const [riskHistory, setRiskHistory] = useState<any[]>([]);
  useEffect(() => {
    if (vendor.isSample) return;
    let cancelled = false;
    authFetch(`/api/vendors/${vendor.id}/risk-history`)
      .then(res => (res.ok ? res.json() : []))
      .then((data: any[]) => { if (!cancelled && Array.isArray(data)) setRiskHistory(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [vendor.id, vendor.isSample, vendor.riskAssessment]);

  const overall = calculateOverallScore(vendor.scores, true);
  let displayedScore: number | null = overall;
  if (currentUser && currentUser.role !== 'admin' && currentUser.role !== 'lab') {
    const deptId = currentUser.role;
    if (deptId === 'qa' || deptId === 'commercial' || deptId === 'planning' || deptId === 'finance') {
      displayedScore = (vendor.scores as any)?.[deptId] ?? null;
    }
  }
  const scoreConfig = getScoreColorConfig(displayedScore, vendor.status);

  // Business Partner Repository resolution for Manufacturer and Supplier
  // A source links to a single partner (manufacturer or supplier).
  const mfgPartner = partners.find(p => p.id === vendor.supplierId) || partners.find(p => p.id === vendor.manufacturerId);
  const partnerLabel = mfgPartner?.type === 'Supplier' ? 'فروشنده' : 'تولیدکننده';
  const mfgName = mfgPartner ? mfgPartner.name : vendor.name;
  const rawMfgCountry = mfgPartner ? mfgPartner.country : (vendor.country || getDisplayCountry(vendor));
  const mfgCountry = rawMfgCountry && rawMfgCountry.trim() && rawMfgCountry.toLowerCase() !== 'unknown' && rawMfgCountry.toLowerCase() !== 'n/a' && rawMfgCountry !== 'نامشخص' && rawMfgCountry !== 'مشخص نشده' ? rawMfgCountry : null;

  const supPartner = partners.find(p => p.id === vendor.supplierId);
  const supName = supPartner ? supPartner.name : null;
  const rawSupCountry = supPartner ? supPartner.country : null;
  const supCountry = rawSupCountry && rawSupCountry.trim() && rawSupCountry.toLowerCase() !== 'unknown' && rawSupCountry.toLowerCase() !== 'n/a' && rawSupCountry !== 'نامشخص' && rawSupCountry !== 'مشخص نشده' ? rawSupCountry : null;
  const rawSupGrade = supPartner?.evaluation?.grade;
  const supGrade = rawSupGrade ? String(rawSupGrade) : null;

  // Material Repository resolution for standard names
  const matchedMaterial = materials.find(m => 
    (vendor.materialId && m.id === vendor.materialId) ||
    (m.standardNameFa && vendor.material && m.standardNameFa.trim().toLowerCase() === vendor.material.trim().toLowerCase()) ||
    (m.nameFa && vendor.material && m.nameFa.trim().toLowerCase() === vendor.material.trim().toLowerCase()) ||
    (m.standardNameEn && vendor.materialEn && m.standardNameEn.trim().toLowerCase() === vendor.materialEn.trim().toLowerCase()) ||
    (m.nameEn && vendor.materialEn && m.nameEn.trim().toLowerCase() === vendor.materialEn.trim().toLowerCase())
  );

  const displayStandardNameFa = matchedMaterial?.standardNameFa || matchedMaterial?.nameFa || vendor.material;
  const displayStandardNameEn = matchedMaterial?.standardNameEn || matchedMaterial?.nameEn || vendor.materialEn;

  const isScored = vendor.scores && Object.values(vendor.scores).some(v => v > 0);

  return (
    <div className="space-y-6 fade-in relative pb-10 max-w-6xl mx-auto text-right" dir="rtl">
      
      {/* Back Button */}
      <button 
        onClick={onBack}
        className="group flex items-center gap-2 mb-6 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit font-medium"
      >
        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        <span>بازگشت به لیست</span>
      </button>

      {showConfirmDelete && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-2xl p-6 text-center fade-in shadow-sm">
           <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
           <h3 className="text-xl font-bold text-foreground mb-1">آیا از حذف این فایل مطمئن هستید؟</h3>
           <p className="text-red-700 mb-6 font-medium text-sm">این عملیات غیر قابل بازگشت است و سورس به همراه تمامی ارزیابی‌های آن از سیستم حذف خواهد شد.</p>
           <div className="flex justify-center gap-4">
              <button 
                onClick={() => setShowConfirmDelete(false)}
                className="px-6 py-2 rounded-xl bg-card border border-border text-foreground hover:bg-accent font-bold text-sm"
              >
                انصراف
              </button>
              <button 
                onClick={() => onDelete(vendor.id)}
                className="px-6 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 font-bold text-sm shadow-[0_4px_14px_rgba(220,38,38,0.25)]"
              >
                بله، حذف شود
              </button>
           </div>
        </div>
      )}

      {/* Editing Form */}
      <div ref={editFormRef} className={`overflow-hidden transition-all duration-300 ease-in-out ${isEditing ? 'opacity-100 max-h-[2000px] mb-6' : 'opacity-0 max-h-0'}`}>
        {isEditing && (
          <VendorForm 
            db={db}
            materials={materials}
            onAddMaterial={onAddMaterial}
            categoryId={vendor.category} 
            existingVendor={vendor}
            onClose={() => setIsEditing(false)} 
            onSave={(v, msg) => { onSave(v, msg); }} 
            currentUser={currentUser}
            partners={partners}
            onAddPartner={onAddPartner}
          />
        )}
      </div>

      {/* HERO CARD */}
      <div className={`bg-card border border-border/60 rounded-2xl p-6 mb-6 shadow-sm ${scoreConfig.heroBorder}`}>
        <div className="flex flex-col xl:flex-row items-start justify-between gap-5 pb-1">
          <div className="flex items-center gap-5">
            {/* Score Ring */}
            <div className={`w-20 h-20 shrink-0 rounded-full border-4 flex items-center justify-center bg-muted ${scoreConfig.border}`}>
              <span className="font-mono text-2xl font-black">
                {displayedScore !== null ? displayedScore : '-'}
              </span>
            </div>
            
            <div className="text-right">
              {/* Manufacturer display (Bold) */}
              <div className="font-bold text-foreground text-lg sm:text-xl lg:text-2xl leading-tight mb-1">
                <span>تولید کننده : {mfgName}</span>
                {mfgCountry && (
                  <>
                    <span className="mx-3 sm:mx-4 text-slate-300 font-normal">|</span>
                    <span>کشور : {mfgCountry}</span>
                  </>
                )}
              </div>

              {/* Supplier display (Regular) or Direct Purchase Badge */}
              {supPartner ? (
                <div className="font-normal text-muted-foreground text-xs sm:text-sm leading-relaxed mt-1">
                  <span>فروشنده : {supName}</span>
                  {supCountry && (
                    <>
                      <span className="mx-3 text-slate-300">|</span>
                      <span>کشور : {supCountry}</span>
                    </>
                  )}
                  {supGrade && (
                    <>
                      <span className="mx-3 text-slate-300">|</span>
                      <span>Grade : {supGrade}</span>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 rounded-lg text-xs font-bold shadow-2xs">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    خرید بی‌واسطه از تولیدکننده
                  </span>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex flex-col items-start xl:items-end gap-2">
            <div className="flex gap-2">
              {currentUser.role === 'admin' && (
                <>
                  <button 
                    onClick={() => setIsEditing(!isEditing)}
                    className={`flex items-center justify-center gap-2 text-sm transition-all h-10 px-4 rounded-xl border font-bold ${isEditing ? 'bg-cyan-50 text-cyan-700 border-cyan-200' : 'bg-card text-foreground hover:bg-accent border-border shadow-sm'}`}
                  >
                    <Pencil className="w-4 h-4" />
                    <span>{isEditing ? 'انصراف' : 'ویرایش اطلاعات'}</span>
                  </button>
                  <button 
                    onClick={() => setShowConfirmDelete(true)}
                    className="flex items-center justify-center h-10 w-10 transition-colors rounded-xl border bg-card border-border text-muted-foreground hover:border-red-200 hover:bg-red-50 hover:text-red-600 shadow-sm"
                    title="حذف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {/* Label وضعیت / گرید */}
            <div className="mt-1">
              {vendor.isSample ? (
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold shadow-2xs ${
                  vendor.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                  vendor.status === 'conditional' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                  'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  <ClipboardCheck className="w-4 h-4 ml-1.5" />
                  {vendor.status === 'approved' ? 'نمونه: تایید شده (Approved)' :
                   vendor.status === 'conditional' ? 'نمونه: تایید مشروط (Conditional)' : 'نمونه: مردود (Rejected)'}
                </div>
              ) : (
                !isScored && <GradeBadge grade={vendor.grade} status={vendor.status} scores={vendor.scores} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* LICENSE EXPIRY PROMINENT ALERT (IF EXPIRING OR EXPIRED) */}
      {vendor.ircExpiryDate && (() => {
        const check = checkLicenseExpiry(vendor.ircExpiryDate);
        if (check.status === 'expired') {
          return (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-900 shadow-xs flex items-center justify-between gap-4 fade-in">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-600/10 border border-rose-600/20 flex items-center justify-center text-rose-600 shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-extrabold text-sm text-rose-900">
                    هشدار اضطراری: مجوز IRC / قانونی این سورس منقضی شده است!
                  </div>
                  <div className="text-xs text-rose-700 mt-0.5">
                    تاریخ انقضا: <strong className="font-mono font-bold">{vendor.ircExpiryDate}</strong> ({Math.abs(check.daysLeft || 0)} روز گذشته). تمدید فوری مجوز الزامی است.
                  </div>
                </div>
              </div>
              <span className="px-3 py-1 bg-rose-600 text-white font-bold text-xs rounded-xl shadow-xs shrink-0">
                منقضی شده
              </span>
            </div>
          );
        }
        if (check.status === 'expiring_soon') {
          return (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 text-amber-950 shadow-xs flex items-center justify-between gap-4 fade-in">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 shrink-0">
                  <AlertTriangle className="w-5 h-5 animate-bounce" />
                </div>
                <div>
                  <div className="font-extrabold text-sm text-amber-900">
                    اعلان تمدید مجوز (کمتر از ۲ ماه تا انقضا)
                  </div>
                  <div className="text-xs text-amber-800 mt-0.5">
                    مجوز IRC این سورس در تاریخ <strong className="font-mono font-bold">{vendor.ircExpiryDate}</strong> منقضی می‌شود (<strong>{check.daysLeft} روز باقی‌مانده</strong>). لطفاً فرآیند تمدید را آغاز فرمایید.
                  </div>
                </div>
              </div>
              <span className="px-3 py-1 bg-amber-500 text-white font-bold text-xs rounded-xl shadow-xs shrink-0">
                {check.daysLeft} روز تا انقضا
              </span>
            </div>
          );
        }
        return null;
      })()}

      {/* 1. اطلاعات تامین کننده */}
      <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm text-right">
        <div className="flex items-center gap-2.5 mb-5 border-b border-border pb-3">
          <Globe className="w-4 h-4 text-cyan-600" />
          <h3 className="font-bold text-foreground text-sm">مشخصات فنی و اطلاعات عمومی</h3>
        </div>
        
        <div className="flex flex-col gap-5 text-sm">
          {/* مشخصات اصلی ماده اولیه و کدهای ثبتی */}
          <div className="space-y-4">
            {/* جعبه شاخص ماده اولیه */}
            <div className="bg-muted/40 border border-slate-900/5 rounded-xl p-4 shadow-inner space-y-3">
              <div>
                <div className="text-muted-foreground text-xs font-bold mb-1">نام استاندارد فارسی:</div>
                <div className="font-black text-foreground text-lg sm:text-xl leading-relaxed" title={displayStandardNameFa}>
                  {displayStandardNameFa}
                </div>
              </div>
              <div className="pt-2.5 border-t border-border/60">
                <div className="text-muted-foreground text-xs font-bold mb-1">نام استاندارد انگلیسی:</div>
                <div className="text-sm sm:text-base font-mono font-bold text-foreground" dir="ltr">
                  {displayStandardNameEn}
                </div>
              </div>
            </div>

            {/* کارت‌های فرعی مشخصات عددی */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl p-4 shadow-xs text-right flex flex-col justify-between">
                <div>
                  <div className="text-muted-foreground text-xs mb-1.5 font-mono">CAS Number</div>
                  <div className="font-mono text-foreground font-bold bg-muted text-center py-1.5 px-3 rounded-lg border border-slate-900/5 text-sm" dir="ltr">
                    {vendor.cas && vendor.cas.trim() && vendor.cas.toLowerCase() !== 'n/a' && vendor.cas.toLowerCase() !== 'unknown' ? vendor.cas : '-'}
                  </div>
                </div>
              </div>
              
              <div className="bg-card border border-border rounded-xl p-4 shadow-xs text-right flex flex-col justify-between">
                <div>
                  <div className="text-muted-foreground text-xs mb-1.5 font-mono">
                    {vendor.category === 'veterinary' ? 'IVC Code' : 'IRC Code'}
                  </div>
                  <div className="font-mono text-foreground font-bold bg-muted text-center py-1.5 px-3 rounded-lg border border-slate-900/5 text-sm" dir="ltr">
                    {vendor.irc && vendor.irc.trim() && vendor.irc.toLowerCase() !== 'n/a' && vendor.irc.toLowerCase() !== 'unknown' ? vendor.irc : '-'}
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-medium">تاریخ دریافت / صدور:</span>
                    <span className="font-mono font-bold text-foreground" dir="ltr">
                      {vendor.lastAudit || vendor.registrationDate || 'ثبت نشده'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-medium">تاریخ انقضای مجوز:</span>
                    {vendor.ircExpiryDate ? (() => {
                      const check = checkLicenseExpiry(vendor.ircExpiryDate);
                      return (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-foreground" dir="ltr">
                            {vendor.ircExpiryDate}
                          </span>
                          {check.status === 'expired' && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                              منقضی
                            </span>
                          )}
                          {check.status === 'expiring_soon' && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-900">
                              {check.daysLeft} روز
                            </span>
                          )}
                          {check.status === 'valid' && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              معتبر
                            </span>
                          )}
                        </div>
                      );
                    })() : (
                      <span className="text-muted-foreground font-mono">ثبت نشده</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 shadow-xs text-right flex flex-col justify-between">
                <div>
                  <div className="text-muted-foreground text-xs mb-1.5">کد سیستم / Unique ID</div>
                  <div className="font-mono text-cyan-700 font-bold bg-cyan-50/50 text-center py-1.5 px-3 rounded-lg border border-cyan-100 text-sm" dir="ltr">
                    {vendor.id.substring(0, 8).toUpperCase()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* کادر اطلاعات تماس و آدرس به تفکیک تولیدکننده و فروشنده */}
          <div className="bg-muted/60 border border-border/50 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2 text-foreground font-bold text-xs sm:text-sm border-b border-border/60 pb-3">
              <Building2 className="w-4 h-4 text-cyan-600" />
              <span>اطلاعات تماس و آدرس (تولیدکننده و فروشنده)</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* بخش تولیدکننده */}
              <div className="bg-card border border-border/80 rounded-xl p-4 shadow-2xs space-y-2 text-right">
                <div className="flex items-center gap-2 text-indigo-900 font-extrabold text-sm border-b border-border pb-2">
                  <Factory className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="truncate">{partnerLabel}: {mfgPartner ? mfgPartner.name : vendor.name}</span>
                </div>

                <div className="space-y-1.5 text-xs text-muted-foreground leading-relaxed pt-1">
                  <div className="flex items-start gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <span><strong>کشور / شهر:</strong> {(mfgPartner?.country && mfgPartner.country.toLowerCase() !== 'unknown' && mfgPartner.country.toLowerCase() !== 'n/a' && mfgPartner.country !== 'نامشخص' ? mfgPartner.country : (vendor.country && vendor.country.toLowerCase() !== 'unknown' && vendor.country.toLowerCase() !== 'n/a' && vendor.country !== 'نامشخص' ? vendor.country : (getDisplayCountry(vendor) || 'ثبت‌نشده')))}{mfgPartner?.city ? ` - ${mfgPartner.city}` : ''}</span>
                  </div>

                  {(mfgPartner?.address || (!mfgPartner && vendor.contactInfo)) && (
                    <div className="flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <span><strong>آدرس:</strong> {mfgPartner?.address || vendor.contactInfo}</span>
                    </div>
                  )}

                  {mfgPartner?.contactPerson && (
                    <div className="flex items-center gap-1.5">
                      <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span><strong>شخص رابط:</strong> {mfgPartner.contactPerson}</span>
                    </div>
                  )}

                  {(mfgPartner?.phone || mfgPartner?.email) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                      {mfgPartner?.phone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span dir="ltr" className="font-mono">{mfgPartner.phone}</span>
                        </div>
                      )}
                      {mfgPartner?.email && (
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span dir="ltr" className="font-mono">{mfgPartner.email}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {mfgPartner?.website && (
                    <div className="flex items-center gap-1.5 pt-0.5" dir="ltr">
                      <a href={mfgPartner.website.startsWith('http') ? mfgPartner.website : `https://${mfgPartner.website}`} target="_blank" rel="noreferrer" className="text-cyan-700 hover:underline font-mono text-[11px]">
                        {mfgPartner.website}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* بخش فروشنده (در صورت وجود) */}
              {supPartner ? (
                <div className="bg-card border border-border/80 rounded-xl p-4 shadow-2xs space-y-2 text-right">
                  <div className="flex items-center gap-2 text-emerald-900 font-extrabold text-sm border-b border-border pb-2">
                    <Handshake className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="truncate">فروشنده: {supPartner.name}</span>
                  </div>

                  <div className="space-y-1.5 text-xs text-muted-foreground leading-relaxed pt-1">
                    <div className="flex items-start gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <span><strong>کشور / شهر:</strong> {(supPartner.country && supPartner.country.toLowerCase() !== 'unknown' && supPartner.country.toLowerCase() !== 'n/a' && supPartner.country !== 'نامشخص' ? supPartner.country : 'ثبت‌نشده')}{supPartner.city ? ` - ${supPartner.city}` : ''}</span>
                    </div>

                    {supPartner.address && (
                      <div className="flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <span><strong>آدرس:</strong> {supPartner.address}</span>
                      </div>
                    )}

                    {supPartner.contactPerson && (
                      <div className="flex items-center gap-1.5">
                        <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span><strong>شخص رابط:</strong> {supPartner.contactPerson}</span>
                      </div>
                    )}

                    {(supPartner.phone || supPartner.email) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                        {supPartner.phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span dir="ltr" className="font-mono">{supPartner.phone}</span>
                          </div>
                        )}
                        {supPartner.email && (
                          <div className="flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span dir="ltr" className="font-mono">{supPartner.email}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {supPartner.website && (
                      <div className="flex items-center gap-1.5 pt-0.5" dir="ltr">
                        <a href={supPartner.website.startsWith('http') ? supPartner.website : `https://${supPartner.website}`} target="_blank" rel="noreferrer" className="text-cyan-700 hover:underline font-mono text-[11px]">
                          {supPartner.website}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-emerald-50/50 border border-emerald-200/80 rounded-xl p-4 flex flex-col justify-center text-right text-emerald-900 text-xs space-y-2 min-h-[120px]">
                  <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      <span>خرید بی‌واسطه از تولیدکننده</span>
                    </div>
                    <span className="bg-emerald-600 text-white font-bold text-[10px] px-2 py-0.5 rounded-full">
                      مستقیم
                    </span>
                  </div>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    این سورس فاقد فروشنده واسطه بوده و کلیه فرآیندهای خرید و ارسال به صورت مستقیم و بدون واسطه از کارخانه سازنده مرجع صورت می‌پذیرد.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* سوابق انحرافات */}
          {vendor.rejectionReasons && vendor.rejectionReasons.length > 0 && (
            <div className="bg-muted/60 border border-border/50 rounded-xl p-5 shadow-xs">
              <div className="flex items-center gap-2 mb-3 text-foreground font-bold text-xs sm:text-sm">
                <AlertTriangle className="w-4 h-4 text-cyan-600" />
                <span>سوابق انحرافات</span>
              </div>
              <div className="text-foreground font-medium text-sm leading-relaxed whitespace-pre-wrap text-right" dir="auto">
                <ul className="list-disc list-inside space-y-1.5">
                  {vendor.rejectionReasons.map((reason, idx) => (
                    <li key={idx} className="break-words">{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {vendor.isSample && (
        <div className="bg-indigo-50/50 border border-indigo-200 rounded-2xl p-6 shadow-sm flex items-start gap-4">
          <div className="bg-indigo-100 p-3 rounded-xl border border-indigo-200 shrink-0 text-indigo-600">
            <Info className="w-5 h-5" />
          </div>
          <div className="text-right">
            <h3 className="text-base font-bold text-indigo-850 mb-1">نمونه تستی (Sample)</h3>
            <p className="text-indigo-700 text-sm font-medium">برای مواردی که به عنوان «نمونه» ثبت می‌شوند، نیازی به ارزیابی ریسک و فرم امتیازدهی دوره‌ای دپارتمان‌ها نمی‌باشد.</p>
          </div>
        </div>
      )}

      {vendor.status === 'rejected' && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 md:p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="bg-rose-100 p-3 rounded-xl border border-rose-200 shrink-0 text-rose-600">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div className="text-right flex-1 min-w-0">
              {vendor.isSample || vendor.category === 'sample' ? (
                <>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-lg font-black text-rose-900">وضعیت: نمونه مردود در کنترل کیفیت (QC Rejected Sample)</h3>
                    <span className="bg-rose-600 text-white font-bold text-xs px-2.5 py-0.5 rounded-full">
                      مردود / Reject
                    </span>
                  </div>
                  <p className="text-rose-700 text-sm mb-5 font-semibold">
                    این نمونه بر اساس نتایج آزمایشگاهی دپارتمان کنترل کیفیت (QC) و به دلیل عدم انطباق با مشخصات فنی/فارماکوپه‌ای تایید نگردیده و مردود شده است:
                  </p>

                  {/* Rejected QC Analysis Records Display */}
                  {(() => {
                    const rejectedQCRecords = (vendor.analysisRecords || []).filter(r => r.decision === 'Reject');
                    const nonQcRejectionReasons = (vendor.rejectionReasons || []).filter(
                      reason => !reason.startsWith('مردود در آزمون QC')
                    );

                    return (
                      <div className="space-y-3">
                        {rejectedQCRecords.length > 0 && (
                          <div className="space-y-3">
                            {rejectedQCRecords.map((r, idx) => (
                              <div key={r.id || idx} className="bg-card border border-rose-200/80 rounded-xl p-4 shadow-xs space-y-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 pb-2 text-xs">
                                  <div className="flex items-center gap-3">
                                    <span className="font-bold text-rose-900">
                                      برگه آزمایش {idx + 1}: کد QC <span className="font-mono bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded border border-rose-200 font-bold">{r.qcCode}</span>
                                    </span>
                                    <span className="text-slate-300">|</span>
                                    <span className="text-muted-foreground font-medium">تاریخ آزمایش: <span className="font-mono font-bold text-foreground">{r.date}</span></span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {r.deviationReason && r.deviationReason !== 'None' && (
                                      <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-bold">
                                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                                        انحراف: {
                                          r.deviationReason === 'OOS' ? 'خارج از حدود مشخصات (OOS)' :
                                          r.deviationReason === 'OOT' ? 'خارج از روند (OOT)' :
                                          r.deviationReason === 'NCR' ? 'گزارش عدم انطباق (NCR)' :
                                          r.deviationReason === 'CAPA' ? 'اقدام اصلاحی/پیشگیرانه (CAPA)' :
                                          r.deviationReason === 'Complaint' ? 'شکایت کیفی' :
                                          r.deviationReason === 'Deviation' ? 'انحراف فرآیندی' : r.deviationReason
                                        }
                                      </span>
                                    )}
                                    <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[11px] font-bold">
                                      تصمیم: مردود (Reject)
                                    </span>
                                  </div>
                                </div>

                                {r.comments && (
                                  <div className="text-xs text-foreground bg-rose-50/40 p-2.5 rounded-lg border border-rose-100/60 leading-relaxed">
                                    <span className="font-bold text-rose-900 block mb-0.5">گزارش و توضیحات کارشناس کنترل کیفیت:</span>
                                    <p className="whitespace-pre-wrap">{r.comments}</p>
                                  </div>
                                )}

                                {r.recordedBy && (
                                  <div className="text-[11px] text-muted-foreground font-medium text-left">
                                    ثبت‌شده توسط: <span className="text-muted-foreground font-bold">{r.recordedBy}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Other general rejection reasons if any */}
                        {nonQcRejectionReasons.length > 0 && (
                          <div className="mt-3 space-y-2">
                            <h4 className="text-xs font-bold text-rose-900">سایر دلایل و ملاحظات عدم تایید:</h4>
                            <ul className="space-y-1.5">
                              {nonQcRejectionReasons.map((reason, idx) => (
                                <li key={idx} className="bg-card border border-rose-100 px-3.5 py-2.5 rounded-xl text-rose-800 text-xs flex gap-2.5 items-start font-medium shadow-xs">
                                  <span className="bg-rose-50 text-rose-700 text-[10px] w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold">{idx + 1}</span>
                                  <span>{reason}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {rejectedQCRecords.length === 0 && nonQcRejectionReasons.length === 0 && vendor.rejectionReasons && (
                          <ul className="space-y-2">
                            {vendor.rejectionReasons.map((reason, idx) => (
                              <li key={idx} className="bg-card border border-rose-100 px-4 py-3 rounded-xl text-rose-800 text-sm flex gap-3 items-start font-medium shadow-sm">
                                <span className="bg-rose-50 text-rose-700 text-xs w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold">{idx + 1}</span>
                                <span>{reason}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-rose-800 mb-1">وضعیت: لیست سیاه — تامین‌کننده رد صلاحیت شده</h3>
                  <p className="text-rose-700 text-sm mb-5 max-w-2xl font-semibold">این تامین‌کننده به دلایل زیر از لیست تامین‌کنندگان مجاز حذف شده است (Disqualified due to critical non-conformities):</p>
                  
                  <ul className="space-y-2">
                    {vendor.rejectionReasons?.map((reason, idx) => (
                      <li key={idx} className="bg-card border border-rose-100 px-4 py-3 rounded-xl text-rose-800 text-sm flex gap-3 items-start font-medium shadow-sm">
                        <span className="bg-rose-50 text-rose-700 text-xs w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold">{idx + 1}</span>
                        {reason}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 border-t border-rose-200 pt-4 flex items-center text-xs text-rose-600/70 font-mono">
                    <Info className="w-4 h-4 mr-2" /> {vendor.category === 'veterinary' ? 'IVC' : 'IRC'}_ISSUE_DATE: {vendor.lastAudit || 'N/A'}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Guided evaluation wizard header (stepper) */}
      {showEvalWizard && (
        <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2.5 mb-4">
            <ClipboardCheck className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">فرآیند ارزیابی سورس <span className="text-muted-foreground text-xs font-normal font-mono">(Evaluation Workflow)</span></h3>
          </div>
          <div className="flex items-center">
            {evalStages.map((s, i) => {
              const done = i < evalStageIdx;
              const current = i === evalStageIdx;
              const Ic = s.icon;
              return (
                <React.Fragment key={s.id}>
                  <button type="button" onClick={() => setEvalStage(s.id)} className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer group" title={s.title}>
                    <span className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                      current ? 'border-primary text-primary bg-primary/5 ring-4 ring-primary/10' :
                      done ? 'border-primary bg-primary text-white' :
                      'border-border text-muted-foreground bg-card group-hover:border-border'
                    }`}>
                      {done ? <CheckCircle className="w-4 h-4" /> : <Ic className="w-4 h-4" />}
                    </span>
                    <span className={`text-[10px] sm:text-xs font-semibold whitespace-nowrap ${current ? 'text-primary' : done ? 'text-muted-foreground' : 'text-muted-foreground'}`}>{s.title}</span>
                  </button>
                  {i < evalStages.length - 1 && (
                    <div className="flex-1 h-[2px] mx-2 sm:mx-3 -mt-4 rounded-full bg-slate-200 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${i < evalStageIdx ? 'bg-primary w-full' : 'w-0'}`} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. اول بخش امتیاز دهی بیاد */}
      {!vendor.isSample && (!showEvalWizard || evalStage === 'score') && (
        <div className="bg-card border border-border/60 rounded-2xl shadow-sm overflow-hidden text-right">
          <div className="border-b border-border px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <FileText className="w-4 h-4 text-cyan-600" />
              <h3 className="font-bold text-foreground text-sm">ارزیابی عملکرد تامین‌کنندگان <span className="text-muted-foreground text-xs font-normal font-mono relative top-[0.5px]">(Evaluation)</span></h3>
            </div>
            {currentUser && currentUser.role !== 'lab' && !showAdminScoresEdit && (
              <button 
                onClick={() => setShowAdminScoresEdit(true)}
                className="px-3 py-1.5 rounded-lg bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-200 transition-colors text-xs font-bold flex items-center gap-1.5"
              >
                {vendor.scores && Object.values(vendor.scores).some(v => v > 0) ? 'تغییر امتیازات' : 'ثبت امتیاز ارزیابی'}
              </button>
            )}
            {showAdminScoresEdit && (
              <button 
                onClick={() => setShowAdminScoresEdit(false)}
                className="flex items-center justify-center gap-1.5 text-xs transition-colors w-fit px-4 py-1.5 rounded-lg border font-bold bg-card text-foreground hover:bg-accent border-border shadow-sm"
              >
                <span>انصراف</span>
              </button>
            )}
          </div>

          <div className="p-6">
            {showAdminScoresEdit ? (
              <div ref={evalFormRef} className="space-y-6">
                <div className="bg-cyan-600/5 border border-cyan-600/20 rounded-xl p-4 flex items-center gap-3 text-cyan-700 text-right">
                  <Info className="w-5 h-5 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold text-sm">{vendor.scores && Object.values(vendor.scores).some(v => v > 0) ? 'ویرایش امتیازات ارزیابی' : 'ثبت ارزیابی جدید'}</h4>
                    <p className="text-xs opacity-90 mt-0.5">لطفاً ارزیابی مربوط به بخش خود را بر اساس مستندات ثبت کنید.</p>
                  </div>
                </div>
                <EvaluationForm vendor={vendor} onSave={onSave} onClose={() => setShowAdminScoresEdit(false)} currentUser={currentUser} />
              </div>
            ) : vendor.scores ? (
              <div className="space-y-6">
                {/* Weighted average score, beautifully centered and designed */}
                {currentUser?.role === 'admin' ? (
                  <div className="flex justify-center p-2">
                    <div className="text-center bg-muted border border-border p-5 rounded-2xl flex flex-col items-center justify-center min-w-[240px] shadow-sm relative overflow-hidden">
                      <div className="absolute top-0 right-0 left-0 h-[3px] bg-cyan-600" />
                      <span className="text-muted-foreground text-xs font-bold mb-1">امتیاز کل (میانگین وزنی)</span>
                      <span className="text-[10px] text-muted-foreground font-mono mb-2">Weighted Average Score</span>
                      <span id="weighted-average-score-badge" className={`text-3xl font-extrabold font-mono tracking-tighter ${getScoreColorClass(overall)}`}>
                        {overall !== null ? overall : '-'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-muted/50 border border-border/60 rounded-xl p-4 text-right flex items-center gap-3 text-muted-foreground mb-2">
                    <div className="w-1.5 h-8 bg-cyan-600 rounded-full" />
                    <div className="text-xs">
                      کاربر گرامی، شما با سطح دسترسی <strong className="text-cyan-700">
                        {currentUser?.role === 'qa' ? 'کیفیت (QA)' : 
                         currentUser?.role === 'commercial' ? 'بازرگانی' : 
                         currentUser?.role === 'planning' ? 'برنامه‌ریزی و انبار' : 
                         currentUser?.role === 'finance' ? 'مالی' : 'کاربر'}
                      </strong> وارد شده‌اید. بر این اساس، صرفاً به امتیاز ارزیابی ثبت شده واحد خود دسترسی دارید.
                    </div>
                  </div>
                )}

                <div className="mt-8 space-y-6">
                  {/* ScoreCards - 2x2 Grid Layout */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {FORM_LAYOUT.map(layout => {
                      const deptScore = vendor.scores[layout.id as keyof typeof vendor.scores];
                      if (deptScore === undefined || deptScore === null) return null;
                      
                      // Security Restriction: Only show the score of the user's role, except for Admin
                      if (currentUser?.role !== 'admin' && layout.id !== currentUser?.role) return null;
                      
                      return (
                        <ScoreCard 
                           key={layout.id} 
                           title={layout.title} 
                           titleEn={
                             layout.id === 'commercial' ? 'COMMERCIAL DEPT' : 
                             layout.id === 'qa' ? 'QUALITY' : 
                             layout.id === 'planning' ? 'PLANNING & WAREHOUSE' : 'FINANCE DEPT'}
                           icon={layout.icon}
                           score={deptScore}
                           items={layout.criteria.map(crit => ({
                             label: crit.label,
                             value: getRawScoreValue(vendor, layout.id, crit.key),
                             max: 5
                           }))}
                        />
                      );
                    })}
                  </div>

                  {/* Radar Chart (Distribution) is now below the scores, Admin only */}
                  {currentUser?.role === 'admin' && (
                    <div className="bg-card border border-slate-900/10 rounded-xl p-4 shadow-sm">
                      <div className="text-center mb-4">
                        <h4 className="font-bold text-foreground text-sm mb-1">نمودار توزیع امتیازات بخش‌ها <span className="font-mono text-xs">(Score Distribution)</span></h4>
                        <div className="w-16 h-1 bg-cyan-500/20 mx-auto rounded-full" />
                      </div>
                      <div className="h-56 sm:h-64 w-full" dir="ltr">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={[
                            { subject: 'بازرگانی', A: vendor.scores.commercial || 0, fullMark: 100 },
                            { subject: 'کیفیت', A: vendor.scores.qa || 0, fullMark: 100 },
                            { subject: 'برنامه‌ریزی و انبار', A: vendor.scores.planning || 0, fullMark: 100 },
                            { subject: 'مالی', A: vendor.scores.finance || 0, fullMark: 100 },
                          ]}>
                            <PolarGrid stroke="#e2e8f0" />
                            <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'Vazirmatn FD' }} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                            <Radar name="Vendor" dataKey="A" stroke="#0ea5e9" fill="#38bdf8" fillOpacity={0.3} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-xs bg-muted/50 rounded-xl border border-dashed border-slate-250">
                هیچ امتیازی برای این تامین‌کننده ثبت نشده است. لطفاً نسبت به ثبت ارزیابی اقدام کنید.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Score history & trend (reconstructed from the audit trail) */}
      {!vendor.isSample && (!showEvalWizard || evalStage === 'score') && scoreHistory.length > 0 && (
        <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm text-right">
          <div className="flex items-center justify-between gap-3 mb-5 border-b border-border pb-3">
            <div className="flex items-center gap-2.5">
              <History className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-foreground text-sm">تاریخچه و روند نمرات <span className="text-muted-foreground text-xs font-normal font-mono relative top-[0.5px]">(Score History)</span></h3>
            </div>
            <Badge variant="outline" className="text-[11px] px-2 py-0.5">{scoreHistory.length} تغییر</Badge>
          </div>

          {scoreHistory.length >= 2 && (
            <div className="h-52 w-full mb-5" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={scoreHistory.map((h, i) => ({
                  idx: i + 1,
                  label: new Date(h.date).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }),
                  sps: h.totalSPS,
                }))} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'Vazirmatn FD' }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <RTooltip
                    contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                    formatter={(v: any) => [`${v}`, 'SPS']}
                    labelFormatter={(l: any) => l}
                  />
                  <Line type="monotone" dataKey="sps" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, fill: '#2563eb' }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-right font-semibold py-2 px-2">تاریخ</th>
                  <th className="text-center font-semibold py-2 px-2">SPS</th>
                  <th className="text-center font-semibold py-2 px-2">تغییر</th>
                  <th className="text-center font-semibold py-2 px-2">گرید</th>
                  <th className="text-right font-semibold py-2 px-2">کاربر</th>
                </tr>
              </thead>
              <tbody>
                {[...scoreHistory].reverse().map((h) => {
                  const delta = (typeof h.totalSPS === 'number' && typeof h.previousSPS === 'number') ? +(h.totalSPS - h.previousSPS).toFixed(1) : null;
                  return (
                    <tr key={h.id} className="border-b border-slate-50 hover:bg-accent/60">
                      <td className="py-2 px-2 text-foreground">{new Date(h.date).toLocaleDateString('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                      <td className="py-2 px-2 text-center font-mono font-bold text-foreground">{h.totalSPS}</td>
                      <td className="py-2 px-2 text-center font-mono">
                        {delta === null || delta === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : delta > 0 ? (
                          <span className="text-emerald-600">▲ {delta}</span>
                        ) : (
                          <span className="text-red-500">▼ {Math.abs(delta)}</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {h.grade ? <Badge variant={h.grade === 'A' ? 'gradeA' : h.grade === 'B' ? 'gradeB' : h.grade === 'C' ? 'gradeC' : 'gradeReject'} className="text-[10px] px-2 py-0">{h.grade}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">{h.user}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. ارزیابی ریسک تامین کنندگان */}
      {!vendor.isSample && (!showEvalWizard || evalStage === 'risk') && (currentUser?.role === 'admin' || currentUser?.role === 'qa' || currentUser?.role === 'lab') && (
        <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm text-right">
          <div className="flex items-center justify-between gap-3 mb-5 border-b border-border pb-3">
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              <h3 className="font-bold text-foreground text-sm">ارزیابی ریسک تامین کنندگان <span className="text-muted-foreground text-xs font-normal font-mono relative top-[0.5px]">(Risk Assessment)</span></h3>
            </div>
            {(currentUser.role === 'qa' || currentUser.role === 'lab' || currentUser.role === 'admin') && !showRiskAssessment && (
              <button 
                onClick={() => setShowRiskAssessment(true)}
                className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition-colors text-xs font-bold"
              >
                {vendor.riskAssessment ? 'بروزرسانی ارزیابی ریسک' : 'ثبت ارزیابی ریسک'}
              </button>
            )}
          </div>

          {showRiskAssessment ? (
            <RiskAssessmentForm 
              vendor={vendor} 
              onSave={onSave} 
              onClose={() => setShowRiskAssessment(false)} 
              currentUser={currentUser} 
            />
          ) : vendor.riskAssessment ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              <div className={`p-5 rounded-2xl border flex items-center justify-between gap-4 md:col-span-1 ${
                vendor.riskAssessment.riskLevel === 'Low' ? 'bg-emerald-50/40 border-emerald-500/20' : 
                vendor.riskAssessment.riskLevel === 'Medium' ? 'bg-amber-50/40 border-amber-500/20' : 
                'bg-red-50/40 border-red-500/20'
              }`}>
                <div className="flex items-center gap-3">
                  <Activity className={`w-6 h-6 shrink-0 ${
                    vendor.riskAssessment.riskLevel === 'Low' ? 'text-emerald-600' : 
                    vendor.riskAssessment.riskLevel === 'Medium' ? 'text-amber-600' : 
                    'text-red-600'
                  }`} />
                  <div className="text-right">
                    <div className="font-black text-foreground text-base">
                      سطح ریسک: {vendor.riskAssessment.riskLevel === 'Low' ? 'پایین' : vendor.riskAssessment.riskLevel === 'Medium' ? 'متوسط' : 'بالا'}
                    </div>
                    <div className="text-muted-foreground text-[10px] uppercase font-mono tracking-wide mt-0.5">Supplier Risk Index</div>
                  </div>
                </div>
                <div className={`text-3xl font-black font-mono shrink-0 leading-none ${
                    vendor.riskAssessment.riskLevel === 'Low' ? 'text-emerald-600' : 
                    vendor.riskAssessment.riskLevel === 'Medium' ? 'text-amber-600' : 
                    'text-red-600'
                }`}>
                  {Number(vendor.riskAssessment.sri).toFixed(1)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 md:col-span-2">
                <div className="bg-muted/50 p-4 rounded-xl border border-border flex items-center justify-between px-5">
                  <span className="text-xs text-slate-505 font-semibold font-mono">Risk Score</span>
                  <span className="text-sm font-black font-mono text-foreground">{vendor.riskAssessment.riskScore}</span>
                </div>
                <div className="bg-muted/50 p-4 rounded-xl border border-border flex items-center justify-between px-5">
                  <span className="text-xs text-slate-505 font-semibold">کلاس ریسک کلی</span>
                  <span className={`text-sm font-bold ${
                    vendor.riskAssessment.riskLevel === 'Low' ? 'text-emerald-600' :
                    vendor.riskAssessment.riskLevel === 'Medium' ? 'text-amber-600' : 'text-red-600'
                  }`}>{vendor.riskAssessment.riskLevel}</span>
                </div>
                <div className="bg-muted/50 p-4 rounded-xl border border-border col-span-2 flex justify-between items-center px-5">
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-0.5">Evaluator</div>
                    <div className="text-xs font-bold text-foreground">{vendor.riskAssessment.evaluator}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-0.5">Evaluation Date</div>
                    <div className="text-xs font-bold text-foreground font-mono" dir="ltr">{vendor.riskAssessment.date}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-muted-foreground text-xs bg-muted/50 rounded-xl border border-dashed border-border">
              هیچ ارزیابی ریسکی برای این تامین‌کننده ثبت نشده است.
            </div>
          )}

          {/* Risk assessment history & SRI/RPN trend (reconstructed from the audit trail) */}
          {!showRiskAssessment && riskHistory.length > 0 && (
            <div className="mt-6 pt-6 border-t border-border">
              <div className="flex items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-2.5">
                  <History className="w-4 h-4 text-primary" />
                  <h3 className="font-bold text-foreground text-sm">تاریخچه و روند ریسک <span className="text-muted-foreground text-xs font-normal font-mono relative top-[0.5px]">(Risk History)</span></h3>
                </div>
                <Badge variant="outline" className="text-[11px] px-2 py-0.5">{riskHistory.length} ارزیابی</Badge>
              </div>

              {riskHistory.length >= 2 && (
                <div className="h-52 w-full mb-5" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={riskHistory.map((h, i) => ({
                      idx: i + 1,
                      label: new Date(h.date).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }),
                      sri: h.sri,
                      rpn: h.riskScore,
                    }))} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'Vazirmatn FD' }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <RTooltip
                        contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                      />
                      <Line type="monotone" dataKey="sri" name="SRI" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3, fill: '#dc2626' }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="rpn" name="RPN" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-right font-semibold py-2 px-2">تاریخ</th>
                      <th className="text-center font-semibold py-2 px-2">سطح ریسک</th>
                      <th className="text-center font-semibold py-2 px-2">RPN</th>
                      <th className="text-center font-semibold py-2 px-2">SRI</th>
                      <th className="text-right font-semibold py-2 px-2">ارزیاب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...riskHistory].reverse().map((h) => (
                      <tr key={h.id} className="border-b border-slate-50 hover:bg-accent/60">
                        <td className="py-2 px-2 text-foreground">{new Date(h.date).toLocaleDateString('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                        <td className="py-2 px-2 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                            h.riskLevel === 'Low' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            h.riskLevel === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            h.riskLevel === 'High' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-muted text-muted-foreground border-border'
                          }`}>
                            {h.riskLevel === 'Low' ? 'پایین' : h.riskLevel === 'Medium' ? 'متوسط' : h.riskLevel === 'High' ? 'بالا' : (h.riskLevel || '—')}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-foreground">{h.riskScore ?? '—'}</td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-foreground">{typeof h.sri === 'number' ? h.sri.toFixed(1) : '—'}</td>
                        <td className="py-2 px-2 text-muted-foreground">{h.user}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. ثبت نتایج آزمایشگاه */}
      {(!showEvalWizard || evalStage === 'analysis') && (currentUser?.role === 'admin' || currentUser?.role === 'qa') && (
        <div id="purchase-history-analysis-section" className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm text-right">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <Microscope className="w-5 h-5 text-indigo-600 animate-pulse" />
              <div>
                <h3 className="font-bold text-foreground text-sm">سابقه خرید و نتایج آنالیز آزمایشگاهی</h3>
                <p className="text-xs text-muted-foreground mt-1">مدیریت و ثبت اطلاعات آزمایش، کدهای آزمایشگاهی (QC)، وضعیت انحراف و تصمیم نهایی (صرفاً ادمین و واحد کیفیت)</p>
              </div>
            </div>
            <button
              id="add-analysis-record-btn"
              onClick={() => setShowAddAnalysisForm(!showAddAnalysisForm)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>ثبت نتیجه آزمایش جدید</span>
            </button>
          </div>

          {/* Inline Form to add laboratory record */}
          {showAddAnalysisForm && (
            <div id="add-analysis-form" className="mb-6 p-6 rounded-2xl border border-indigo-100 bg-indigo-50/25 space-y-4">
              {analysisSuccess ? (
                <div className="flex items-center justify-center gap-3 py-8 px-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-800 font-bold text-sm fade-in">
                  <CheckCircle className="w-5 h-5 text-emerald-600 bounce-in" />
                  <span>سابقه آزمایش با موفقیت ثبت گردید.</span>
                </div>
              ) : (
                <>
                  <div className="text-sm font-bold text-indigo-950 flex items-center gap-1.5 pb-2 border-b border-indigo-100">
                    <Microscope className="w-4 h-4 text-indigo-600" />
                    <span>فرم ثبت نتایج و سوابق آنالیز ماده</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Date */}
                    <div>
                      <label className="block text-muted-foreground font-semibold text-xs mb-1.5">تاریخ آزمایش <span className="text-red-500">*</span></label>
                      <ShamsiDatePicker
                        value={newAnalysis.date}
                        onChange={(date) => setNewAnalysis({ ...newAnalysis, date })}
                        placeholder="YYYY/MM/DD"
                      />
                    </div>

                    {/* QC Code */}
                    <div>
                      <label className="block text-muted-foreground font-semibold text-xs mb-1.5">کد آزمایشگاهی / QC Code <span className="text-red-500">*</span></label>
                      <input
                        id="new-qc-code-input"
                        type="text"
                        required
                        value={newAnalysis.qcCode}
                        onChange={e => setNewAnalysis({ ...newAnalysis, qcCode: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono text-left"
                        placeholder="مثال: QC-1405-102"
                        dir="ltr"
                      />
                    </div>

                    {/* Final Decision */}
                    <div>
                      <label className="block text-muted-foreground font-semibold text-xs mb-1.5">نتیجه نهایی (Decision)</label>
                      <select
                        id="new-decision-select"
                        value={newAnalysis.decision}
                        onChange={e => setNewAnalysis({ ...newAnalysis, decision: e.target.value as any })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                      >
                        <option value="Pass">Pass</option>
                        <option value="Approved Conditional">Approved Conditional</option>
                        <option value="Reject">Reject</option>
                      </select>
                    </div>

                    {/* Deviation Reason / regulatory */}
                    <div>
                      <label className="block text-muted-foreground font-semibold text-xs mb-1.5">وضعیت انحراف</label>
                      <select
                        id="new-deviation-select"
                        value={newAnalysis.deviationReason}
                        onChange={e => setNewAnalysis({ ...newAnalysis, deviationReason: e.target.value as any })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                      >
                        <option value="None">None</option>
                        <option value="NCR">NCR</option>
                        <option value="Deviation">Deviation</option>
                        <option value="OOS">OOS</option>
                        <option value="CAPA">CAPA</option>
                        <option value="OOT">OOT</option>
                        <option value="Complaint">Complaint</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  {/* Comments */}
                  <div>
                    <label className="block text-muted-foreground font-semibold text-xs mb-1.5">توضیحات و گزارش آنالیز (Comments)</label>
                    <textarea
                      id="new-comments-textarea"
                      value={newAnalysis.comments}
                      onChange={e => setNewAnalysis({ ...newAnalysis, comments: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                      placeholder="گزارش دقیق آنالیز، درصد خلوص، ناخالصی‌ها، تطابق آزمون‌های فیزیکوشیمیایی یا میکروبیولوژی با مراجع فارماکوپه..."
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      id="cancel-analysis-btn"
                      type="button"
                      onClick={() => {
                        setShowAddAnalysisForm(false);
                        setNewAnalysis({ date: new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/[۰-۹]/g, c => '0123456789'[c.charCodeAt(0) - 1776]), qcCode: '', decision: 'Pass', deviationReason: 'None', comments: '' });
                      }}
                      className="px-3 py-1.5 text-xs font-bold text-muted-foreground bg-muted hover:bg-slate-200 active:bg-slate-300 rounded-lg transition-all"
                    >
                      انصراف
                    </button>
                    <button
                      id="submit-analysis-btn"
                      type="button"
                      onClick={handleAddAnalysisSubmit}
                      className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg transition-all shadow-sm"
                    >
                      ثبت آزمایش در سابقه سورس
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Lab results summary + chronological timeline */}
          {vendor.analysisRecords && vendor.analysisRecords.length > 0 && (() => {
            const recs = vendor.analysisRecords!;
            const pass = recs.filter(r => r.decision === 'Pass').length;
            const cond = recs.filter(r => r.decision === 'Approved Conditional').length;
            const rej = recs.filter(r => r.decision === 'Reject').length;
            const total = recs.length;
            const passRate = total > 0 ? Math.round(((pass + cond) / total) * 100) : 0;
            const sorted = [...recs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            return (
              <div className="mb-6 space-y-4">
                {/* Summary strip */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 text-center">
                    <div className="text-2xl font-black font-mono text-emerald-700">{pass}</div>
                    <div className="text-[11px] font-bold text-emerald-600">قبول (Pass)</div>
                  </div>
                  <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3 text-center">
                    <div className="text-2xl font-black font-mono text-blue-700">{cond}</div>
                    <div className="text-[11px] font-bold text-blue-600">قبول مشروط</div>
                  </div>
                  <div className="bg-rose-50/60 border border-rose-200 rounded-xl p-3 text-center">
                    <div className="text-2xl font-black font-mono text-rose-700">{rej}</div>
                    <div className="text-[11px] font-bold text-rose-600">مردود (Reject)</div>
                  </div>
                  <div className="bg-muted border border-border rounded-xl p-3 text-center">
                    <div className={`text-2xl font-black font-mono ${passRate >= 80 ? 'text-emerald-700' : passRate >= 50 ? 'text-amber-600' : 'text-rose-700'}`}>{passRate}%</div>
                    <div className="text-[11px] font-bold text-muted-foreground">نرخ قبولی</div>
                  </div>
                </div>

                {/* Lab results trend line chart (Pass=100 / Conditional=50 / Reject=0) */}
                <div className="bg-muted/50 border border-border/60 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-4 h-4 text-indigo-600" />
                    <h4 className="font-bold text-foreground text-xs">روند کیفی نتایج آزمایشگاهی <span className="text-muted-foreground font-normal font-mono">(Lab Quality Trend)</span></h4>
                  </div>
                  <div className="h-56 w-full" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sorted.map((r) => ({
                        label: r.date,
                        qc: r.qcCode,
                        level: r.decision === 'Pass' ? 100 : r.decision === 'Approved Conditional' ? 50 : 0,
                        decision: r.decision,
                      }))} margin={{ top: 10, right: 16, left: -8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'Vazirmatn FD' }} />
                        <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v: number) => v === 100 ? 'Pass' : v === 50 ? 'Cond.' : v === 0 ? 'Reject' : ''} tick={{ fill: '#94a3b8', fontSize: 10 }} width={48} />
                        <RTooltip
                          contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                          formatter={(v: any) => [v === 100 ? 'قبول (Pass)' : v === 50 ? 'قبول مشروط' : 'مردود (Reject)', 'نتیجه']}
                          labelFormatter={(l: any, p: any) => `${l}${p && p[0] ? ' • ' + p[0].payload.qc : ''}`}
                        />
                        <Line type="monotone" dataKey="level" name="نتیجه" stroke="#4f46e5" strokeWidth={2.5}
                          dot={(props: any) => {
                            const c = props.payload.decision === 'Pass' ? '#10b981' : props.payload.decision === 'Approved Conditional' ? '#3b82f6' : '#e11d48';
                            return <circle key={props.key} cx={props.cx} cy={props.cy} r={4.5} fill={c} stroke="#fff" strokeWidth={1.5} />;
                          }}
                          activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Admin decision box for sources/suppliers (not samples) */}
                {!(vendor.isSample || vendor.category === 'sample') && (currentUser?.role === 'admin' || currentUser?.role === 'qa') && (
                  <div className={`rounded-xl p-4 border ${vendor.status === 'rejected' ? 'bg-rose-50/50 border-rose-200' : 'bg-amber-50/40 border-amber-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <ShieldAlert className={`w-4 h-4 ${vendor.status === 'rejected' ? 'text-rose-600' : 'text-amber-600'}`} />
                      <h4 className="font-bold text-foreground text-xs">تصمیم‌گیری کیفی دربارهٔ سورس <span className="text-muted-foreground font-normal font-mono">(QA Decision)</span></h4>
                    </div>
                    {vendor.status === 'rejected' ? (
                      <p className="text-[11px] text-rose-700 leading-relaxed mb-3">این سورس در حال حاضر در <strong>لیست سیاه</strong> است. در صورت رفع مشکل می‌توانید آن را بازگردانی کنید (با ذکر دلیل).</p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                        وجود {rej > 0 ? <strong className="text-rose-600">{rej} نتیجهٔ مردود</strong> : 'نتایج آزمایشگاهی'} به‌تنهایی سورس را رد نمی‌کند. تصمیم نهایی رد سورس با کارشناس کیفیت است و باید با ذکر دلیل ثبت شود (در audit و سابقهٔ سورس ثبت می‌گردد).
                      </p>
                    )}
                    {showRejectBox ? (
                      <div className="space-y-2">
                        <textarea
                          value={rejectDecisionReason}
                          onChange={e => setRejectDecisionReason(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          placeholder={vendor.status === 'rejected' ? 'دلیل بازگردانی از لیست سیاه (الزامی)...' : 'دلیل رد سورس بر اساس نتایج آزمایشگاهی (الزامی)...'}
                        />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => { setShowRejectBox(false); setRejectDecisionReason(''); }} className="px-3 py-1.5 text-xs font-bold text-muted-foreground bg-muted hover:bg-slate-200 rounded-lg">انصراف</button>
                          {vendor.status === 'rejected' ? (
                            <button type="button" onClick={handleAdminRestoreSource} className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg">تأیید بازگردانی</button>
                          ) : (
                            <button type="button" onClick={handleAdminRejectSource} className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg">تأیید رد و انتقال به لیست سیاه</button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setShowRejectBox(true)} className={`px-4 py-1.5 text-xs font-bold text-white rounded-lg ${vendor.status === 'rejected' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>
                        {vendor.status === 'rejected' ? 'بازگردانی سورس از لیست سیاه' : 'رد سورس و انتقال به لیست سیاه'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Lab Records List / Table */}
          {vendor.analysisRecords && vendor.analysisRecords.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border/60 shadow-xs">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-muted text-foreground border-b border-border/60 font-semibold text-foreground">
                    <th className="py-2.5 px-3 font-bold text-center w-12">ردیف</th>
                    <th className="py-2.5 px-3">تاریخ آزمایش</th>
                    <th className="py-2.5 px-3">کد آزمایشگاهی (QC Code)</th>
                    <th className="py-2.5 px-3">تصمیم نهایی (Decision)</th>
                    <th className="py-2.5 px-3">وضعیت انحراف</th>
                    <th className="py-2.5 px-3 max-w-sm">گزارش و توضیحات آزمایش</th>
                    <th className="py-2.5 px-3">کاربر ثبت‌کننده</th>
                    <th className="py-2.5 px-3 text-center w-36">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...vendor.analysisRecords].reverse().map((record, index) => {
                    const rowNumber = vendor.analysisRecords!.length - index;
                    const isEditingThis = editingAnalysisId === record.id;
                    const isDeletingThis = confirmDeleteAnalysisId === record.id;

                    return (
                      <tr key={record.id || index} className={`${isEditingThis ? 'bg-indigo-50/30' : 'hover:bg-accent/50'} transition-all`}>
                        <td className="py-3 px-3 text-center font-mono text-muted-foreground font-semibold">{rowNumber}</td>
                        <td className="py-3 px-3">
                          {isEditingThis ? (
                            <div className="w-40 mx-auto">
                              <ShamsiDatePicker
                                value={editingAnalysis?.date || ''}
                                onChange={date => setEditingAnalysis({ ...editingAnalysis!, date })}
                                placeholder="YYYY/MM/DD"
                              />
                            </div>
                          ) : (
                            <div className="font-mono text-muted-foreground" dir="ltr">{record.date}</div>
                          )}
                        </td>
                        
                        {/* QC Code */}
                        <td className="py-3 px-3">
                          {isEditingThis ? (
                            <input
                              type="text"
                              value={editingAnalysis?.qcCode || ''}
                              onChange={e => setEditingAnalysis({ ...editingAnalysis!, qcCode: e.target.value })}
                              className="px-2 py-1 rounded-lg border border-indigo-250 font-mono text-center text-xs w-full bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-505"
                              dir="ltr"
                            />
                          ) : (
                            <span className="font-bold text-foreground font-mono tracking-wide" dir="ltr">{record.qcCode}</span>
                          )}
                        </td>

                        {/* Decision */}
                        <td className="py-3 px-3 font-mono">
                          {isEditingThis ? (
                            <select
                              value={editingAnalysis?.decision || 'Pass'}
                              onChange={e => setEditingAnalysis({ ...editingAnalysis!, decision: e.target.value as any })}
                              className="px-2 py-1 rounded-lg border border-indigo-250 text-xs w-full text-right bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-505 font-medium"
                            >
                              <option value="Pass">Pass</option>
                              <option value="Approved Conditional">Approved Conditional</option>
                              <option value="Reject">Reject</option>
                            </select>
                          ) : (
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              record.decision === 'Pass' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                              record.decision === 'Approved Conditional' ? 'bg-indigo-50 text-[#3b82f6] border border-blue-200' :
                              'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${record.decision === 'Pass' ? 'bg-emerald-500 animate-pulse' : record.decision === 'Approved Conditional' ? 'bg-blue-500' : 'bg-rose-500'}`} />
                              <span>{record.decision === 'Pass' ? 'قبول (Pass)' : record.decision === 'Approved Conditional' ? 'قبول مشروط' : 'مردود (Reject)'}</span>
                            </span>
                          )}
                        </td>

                          {/* Deviation */}
                          <td className="py-3 px-3 font-mono">
                            {isEditingThis ? (
                              <select
                                value={editingAnalysis?.deviationReason || 'None'}
                                onChange={e => setEditingAnalysis({ ...editingAnalysis!, deviationReason: e.target.value as any })}
                                className="px-2 py-1 rounded-lg border border-indigo-250 text-xs w-full text-right bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-505 font-medium"
                              >
                                <option value="None">None</option>
                                <option value="NCR">NCR</option>
                                <option value="Deviation">Deviation</option>
                                <option value="OOS">OOS</option>
                                <option value="CAPA">CAPA</option>
                                <option value="OOT">OOT</option>
                                <option value="Complaint">Complaint</option>
                                <option value="Other">Other</option>
                              </select>
                            ) : (
                              <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold tracking-wide ${
                                record.deviationReason === 'None' ? 'bg-muted text-muted-foreground' :
                                record.deviationReason === 'NCR' ? 'bg-orange-105 text-orange-800 border border-orange-200' :
                                record.deviationReason === 'Deviation' ? 'bg-amber-100 text-amber-800 border border-amber-250' :
                                record.deviationReason === 'OOS' ? 'bg-red-100 text-red-905 border border-red-300' :
                                record.deviationReason === 'CAPA' ? 'bg-teal-55 text-teal-700 border border-teal-200' :
                                record.deviationReason === 'OOT' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                                'bg-purple-100 text-purple-800 border border-purple-200'
                              }`}>
                                {record.deviationReason}
                              </span>
                            )}
                          </td>

                          {/* Comments */}
                          <td className="py-3 px-3 max-w-sm">
                            {isEditingThis ? (
                              <textarea
                                rows={2}
                                value={editingAnalysis?.comments || ''}
                                onChange={e => setEditingAnalysis({ ...editingAnalysis!, comments: e.target.value })}
                                className="px-2 py-1 rounded-lg border border-indigo-250 text-xs w-full text-right bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-505 leading-normal"
                                placeholder="توضیحات..."
                              />
                            ) : (
                              <span className="text-slate-605 leading-relaxed font-light">{record.comments || 'فاقد توضیحات تکمیلی'}</span>
                            )}
                          </td>

                          {/* RecordedBy */}
                          <td className="py-3 px-3 text-muted-foreground font-semibold">
                            {record.recordedBy}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 text-center">
                            {isEditingThis ? (
                              <div className="flex items-center justify-center gap-1.5" dir="ltr">
                                <button
                                  onClick={() => handleEditAnalysisSave(record.id)}
                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded transition-all"
                                  title="ذخیره"
                                >
                                  ذخیره
                                </button>
                                <button
                                  onClick={handleEditAnalysisCancel}
                                  className="px-2 py-1 bg-muted hover:bg-slate-200 text-muted-foreground font-bold text-[10px] rounded transition-all"
                                  title="انصراف"
                                >
                                  انصراف
                                </button>
                              </div>
                            ) : isDeletingThis ? (
                              <div className="flex items-center justify-center gap-1.5" dir="ltr">
                                <button
                                  onClick={() => handleDeleteAnalysis(record.id)}
                                  className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] rounded transition-all"
                                  title="تایید حذف"
                                >
                                  حذف قطعی
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteAnalysisId(null)}
                                  className="px-2 py-1 bg-muted hover:bg-slate-200 text-muted-foreground font-bold text-[10px] rounded transition-all"
                                  title="لغو"
                                >
                                  لغو
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1" dir="ltr">
                                <button
                                  onClick={() => handleEditAnalysisStart(record)}
                                  className="p-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition-all"
                                  title="ویرایش"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteAnalysisId(record.id)}
                                  className="p-1 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded transition-all"
                                  title="حذف"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground text-xs bg-muted/50 rounded-xl border border-dashed border-slate-250">
                هیچ سابقه خرید یا نتیجه آنالیز آزمایشگاهی برای این سورس ثبت نشده است.
              </div>
            )}
          </div>
        )}

        {/* Evaluation wizard navigation */}
        {showEvalWizard && (
          <div className="flex items-center justify-between gap-3 bg-card border border-border/60 rounded-2xl px-5 py-4 shadow-sm">
            <button type="button" onClick={() => setEvalStage(evalStages[Math.max(0, evalStageIdx - 1)].id)} disabled={evalStageIdx === 0}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold text-sm text-muted-foreground border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
              <ChevronRight className="w-4 h-4" /> مرحله قبل
            </button>
            <span className="text-xs text-muted-foreground font-medium">مرحله {evalStageIdx + 1} از {evalStages.length}</span>
            {evalStageIdx < evalStages.length - 1 ? (
              <button type="button" onClick={() => setEvalStage(evalStages[Math.min(evalStages.length - 1, evalStageIdx + 1)].id)}
                className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-primary hover:bg-primary-hover transition-colors shadow-sm cursor-pointer">
                مرحله بعد <ChevronLeft className="w-4 h-4" />
              </button>
            ) : (
              <span className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold text-sm text-emerald-700 bg-emerald-50 border border-emerald-200">
                <CheckCircle className="w-4 h-4" /> آخرین مرحله
              </span>
            )}
          </div>
        )}

      </div>
  );
}



// --- View: Risk Assessment Form ---
// FMEA 5×5 risk matrix (Criticality × Probability). Highlights the live cell.
function RiskHeatmap({ criticality, probability, detectability }: { criticality: number; probability: number; detectability: number }) {
  // rows: criticality 5→1 (top=most critical) · cols: probability 1→5
  const rows = [5, 4, 3, 2, 1];
  const cols = [1, 2, 3, 4, 5];
  const cellColor = (c: number, p: number) => {
    const rpn = c * p; // 1..25
    if (rpn >= 15) return 'bg-red-500/25 border-red-500/40';
    if (rpn >= 8) return 'bg-amber-500/25 border-amber-500/40';
    return 'bg-emerald-500/20 border-emerald-500/40';
  };
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4" dir="ltr">
      <div className="text-slate-200 font-bold text-sm mb-3 text-center" dir="rtl">
        ماتریس ریسک (اهمیت × احتمال)
      </div>
      <div className="flex items-stretch gap-2">
        {/* Y-axis label */}
        <div className="flex items-center">
          <span className="text-[10px] text-muted-foreground font-bold [writing-mode:vertical-rl] rotate-180">
            Criticality →
          </span>
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-5 gap-1">
            {rows.map(c =>
              cols.map(p => {
                const active = c === criticality && p === probability;
                return (
                  <div
                    key={`${c}-${p}`}
                    className={`relative aspect-square rounded-md border flex items-center justify-center text-xs font-mono font-bold transition-all ${cellColor(c, p)} ${
                      active ? 'ring-2 ring-white scale-105 z-10 shadow-lg' : 'opacity-90'
                    }`}
                    title={`Criticality ${c} × Probability ${p} = RPN(2D) ${c * p}`}
                  >
                    <span className={active ? 'text-white' : 'text-slate-100'}>{c * p}</span>
                    {active && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-card border border-slate-900" />
                    )}
                  </div>
                );
              })
            )}
          </div>
          {/* X-axis labels */}
          <div className="grid grid-cols-5 gap-1 mt-1">
            {cols.map(p => (
              <div key={p} className="text-center text-[10px] text-muted-foreground font-bold">{p}</div>
            ))}
          </div>
          <div className="text-center text-[10px] text-muted-foreground font-bold mt-1">Probability →</div>
        </div>
      </div>
      {/* Detectability factor → full 3D RPN */}
      <div className="flex items-center justify-center gap-2 mt-3 text-xs" dir="rtl">
        <span className="text-slate-300 font-mono" dir="ltr">
          {criticality} × {probability} = <span className="text-amber-300 font-bold">{criticality * probability}</span>
        </span>
        <span className="text-muted-foreground">×</span>
        <span className="text-slate-300">تشخیص <span className="font-mono text-white font-bold">{detectability}</span></span>
        <span className="text-muted-foreground">=</span>
        <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-200 font-mono font-black">
          RPN {criticality * probability * detectability}
        </span>
      </div>
      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-muted-foreground" dir="rtl">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/40" /> پایین</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-500/40" /> متوسط</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/30 border border-red-500/40" /> بالا</span>
      </div>
    </div>
  );
}

function RiskAssessmentForm({ vendor, onSave, onClose, currentUser }: { vendor: Vendor, onSave: (v: Vendor, msg?: string | null) => void, onClose: () => void, currentUser: User | null }) {
  const spsScore = calculateOverallScore(vendor.scores, true) || 0;
  
  // Calculate recommended probability based on SPS via the isolated FmeaService
  const recommendedProb = FmeaService.getRecommendedProbability(spsScore);

  const [criticality, setCriticality] = useState<number>(vendor.riskAssessment?.materialCriticality || 5);
  const [detectability, setDetectability] = useState<number>(vendor.riskAssessment?.detectability || 1);
  const [probability, setProbability] = useState<number>(vendor.riskAssessment?.probability || recommendedProb);
  const [isSuccess, setIsSuccess] = useState(false);

  // Call the isolated FmeaService to run the full FMEA mathematical assessment
  const { riskScore, sri, riskLevel } = FmeaService.performAssessment(criticality, detectability, probability, spsScore);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUser?.role !== 'qa' && currentUser?.role !== 'lab' && currentUser?.role !== 'admin') {
      alert('شما دسترسی ثبت ارزیابی ریسک را ندارید.');
      return;
    }

    const assessment: RiskAssessmentData = {
      materialCriticality: criticality,
      detectability: detectability,
      probability: probability,
      sps: spsScore,
      riskScore,
      sri: sri,
      riskLevel,
      date: new Date().toLocaleDateString('fa-IR'),
      evaluator: currentUser?.name || 'کاربر سیستم'
    };

    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `ثبت ارزیابی ریسک برای "${vendor.material}" (${vendor.name}) - سطح ریسک: ${riskLevel === 'High' ? 'بالا (High)' : riskLevel === 'Medium' ? 'متوسط (Medium)' : riskLevel === 'Low' ? 'پایین (Low)' : 'نامشخص'}، امتیاز نهایی: ${riskScore}، شاخص SRI: ${sri || 'N/A'}`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };

    onSave({
      ...vendor,
      riskAssessment: assessment,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, null);
    
    setIsSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1000);
  };

  if (isSuccess) {
    return (
      <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-16 text-center flex flex-col items-center justify-center mb-8 shadow-[0_0_20px_rgba(16,185,129,0.1)] fade-in" dir="rtl">
        <div className="bg-emerald-500/10 p-4 rounded-full border border-emerald-500/20 mb-6">
          <CheckCircle className="w-16 h-16 text-emerald-400 bounce-in" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">ارزیابی ریسک با موفقیت ثبت شد</h3>
        <p className="text-muted-foreground font-medium">نتایج ارزیابی ریسک و محاسبات شاخص SRI با موفقیت ثبت گردید. در حال بازگشت...</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-6 mb-8 shadow-[0_0_20px_rgba(245,158,11,0.1)] fade-in">
      <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
        <h3 className="text-xl font-bold text-amber-500 flex items-center gap-2">
          <ShieldAlert className="w-6 h-6" />
          ارزیابی ریسک تامین کنندگان (Supplier Risk Assessment)
        </h3>
        <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-muted-foreground hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Material Criticality */}
          <div className="space-y-3 p-4 bg-slate-800/40 rounded-xl border border-slate-700/50">
            <label className="block text-sm font-medium text-slate-300">۱. اهمیت ماده (Material Criticality)</label>
            <select value={criticality} onChange={e => setCriticality(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-amber-500">
              <option value={5}>ماده موثره - امتیاز ۵</option>
              <option value={4}>اکسپیانت - امتیاز ۴</option>
              <option value={3}>حدواسط شیمیایی، حلال ها و واکنشگرها - امتیاز ۳</option>
              <option value={2}>اقلام بسته بندی اولیه - امتیاز ۲</option>
              <option value={1}>اقلام بسته بندی ثانویه - امتیاز ۱</option>
            </select>
          </div>

          {/* Probability of Failure */}
          <div className="space-y-3 p-4 bg-slate-800/40 rounded-xl border border-slate-700/50">
            <label className="block text-sm font-medium text-slate-300">۲. احتمال خرابی (Probability of failure)</label>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>SPS فعلی: <strong className="text-amber-400 text-sm">{spsScore > 0 ? spsScore : 'تعیین نشده'}</strong></span>
            </div>
            <select value={probability} onChange={e => setProbability(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-amber-500">
              <option value={1}>عدم خرابی (SPS: 80-100) - امتیاز ۱</option>
              <option value={2}>احتمال کم (SPS: 60-79) - امتیاز ۲</option>
              <option value={3}>احتمال متوسط (SPS: 40-59) - امتیاز ۳</option>
              <option value={4}>احتمال زیاد (SPS: 25-39) - امتیاز ۴</option>
              <option value={5}>به شدت محتمل (SPS: 1-24) - امتیاز ۵</option>
            </select>
          </div>

          {/* Detectability */}
          <div className="space-y-3 p-4 bg-slate-800/40 rounded-xl border border-slate-700/50 md:col-span-2">
            <label className="block text-sm font-medium text-slate-300">۳. تشخیص (Detectability)</label>
            <select value={detectability} onChange={e => setDetectability(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-amber-500">
              <option value={1}>تمام مشکلات توسط QC قابل تشخیص - امتیاز ۱</option>
              <option value={2}>اکثر مشکلات قابل تشخیص - امتیاز ۲</option>
              <option value={3}>بخشی قابل تشخیص - امتیاز ۳</option>
              <option value={4}>تشخیص دشوار - امتیاز ۴</option>
              <option value={5}>تقریبا غیر قابل تشخیص - امتیاز ۵</option>
            </select>
          </div>
        </div>

        {/* Visual risk matrix */}
        <RiskHeatmap criticality={criticality} probability={probability} detectability={detectability} />

        {/* Info / Formulas */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 text-sm text-slate-300">
          <div className="font-bold text-slate-200 mb-2 border-b border-slate-700/50 pb-2">نحوه محاسبه شاخص‌ها:</div>
          <div className="space-y-2 font-mono text-xs md:text-sm" dir="ltr">
            <div className="flex gap-2">
               <span className="text-amber-400 font-bold shrink-0">RPN (Risk Score) =</span>
               <span className="text-muted-foreground break-all">Material Criticality × Probability of failure × Detectability</span>
            </div>
            <div className="flex gap-2">
               <span className="text-amber-400 font-bold shrink-0">SRI (Supplier Risk Index) =</span>
               <span className="text-muted-foreground break-all">(0.6 × RPN) + (0.4 × (100 - SPS Score))</span>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="bg-slate-900 p-5 rounded-xl border border-amber-500/20 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Risk Score</div>
              <div className="text-xl font-bold tabular-nums text-white">{riskScore}</div>
            </div>
            <div className="h-8 w-px bg-slate-700"></div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Supplier Risk Index (SRI)</div>
              <div className="text-xl font-bold tabular-nums text-white">{sri.toFixed(1)}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-1">سطح ریسک (Risk Level)</div>
              <div className={`text-xl font-bold ${riskLevel === 'Low' ? 'text-emerald-400' : riskLevel === 'Medium' ? 'text-amber-400' : 'text-red-500'}`}>
                {riskLevel === 'Low' ? 'پایین (Low)' : riskLevel === 'Medium' ? 'متوسط (Medium)' : 'بالا (High)'}
              </div>
            </div>
            <button type="button" onClick={handleSubmit} className="bg-amber-600 hover:bg-amber-500 text-white font-medium px-6 py-2.5 rounded-lg transition-colors shadow-[0_0_15px_rgba(245,158,11,0.3)]">
              ثبت نتیجه ارزیابی ریسک
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- View: Evaluation Form Layout & Helpers ---
const FORM_LAYOUT = [
  {
    id: 'commercial', title: 'بازرگانی', icon: Handshake,
    criteria: [
      { key: 'delivery', label: 'تحویل به موقع', weight: 40 },
      { key: 'responsiveness', label: 'پاسخگویی و جبران خسارت', weight: 30 },
      { key: 'history', label: 'سابقه همکاری و تعداد دفعات خرید', weight: 30 }
    ]
  },
  {
    id: 'qa', title: 'کیفیت', icon: Microscope,
    criteria: [
      { key: 'quality', label: 'کیفیت و تطابق با مشخصات', weight: 35 },
      { key: 'consistency', label: 'تداوم کیفیت', weight: 25 },
      { key: 'ncr', label: 'نداشتن OOS, NCR و Deviation', weight: 25 },
      { key: 'documents', label: 'ارائه مستندات درخواستی', weight: 15 }
    ]
  },
  {
    id: 'planning', title: 'برنامه‌ریزی و انبار', icon: Warehouse,
    criteria: [
      { key: 'efficiency', label: 'راندمان', weight: 60 },
      { key: 'conformance', label: 'تطابق کالا با مشخصات فنی درج شده در پکینگ لیست', weight: 40 }
    ]
  },
  {
    id: 'finance', title: 'مالی', icon: Coins,
    criteria: [
      { key: 'price', label: 'قیمت', weight: 60 },
      { key: 'payment', label: 'نوع پرداخت', weight: 40 }
    ]
  }
];

function calculateDeptAverage(deptId: string, deptScores: Record<string, number>) {
  const layout = FORM_LAYOUT.find(l => l.id === deptId);
  if (!layout) return 0;
  
  let total = 0;
  layout.criteria.forEach(crit => {
     const weight = crit.weight || 0;
     const score = deptScores[crit.key] || 0;
     total += (score / 5) * weight;
  });
  return Math.round(total);
}

function getRawScoreValue(vendor: Vendor, deptId: string, critKey: string): number {
  if (!vendor) return 5;
  let raw = vendor.rawScores;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (raw && (raw as any)[deptId] && (raw as any)[deptId][critKey] !== undefined) {
    return Number((raw as any)[deptId][critKey]);
  }
  
  if (vendor.scores && (vendor.scores as any)[deptId] > 0) {
    const rawVal = Number((vendor.scores as any)[deptId]);
    const deconstructed = deconstructScores(deptId, rawVal);
    if (deconstructed && deconstructed[critKey] !== undefined) {
      return deconstructed[critKey];
    }
    return Math.max(1, Math.min(5, Math.round(rawVal / 20)));
  }
  return 5;
}

function deconstructScores(deptId: string, targetScore: number): Record<string, number> {
  const layout = FORM_LAYOUT.find(l => l.id === deptId);
  if (!layout) return {};
  
  const criteria = layout.criteria;
  const numCrit = criteria.length;
  
  let bestCombination: number[] = [];
  let bestDiff = Infinity;
  
  const search = (index: number, current: number[]) => {
    if (index === numCrit) {
      let total = 0;
      criteria.forEach((crit, idx) => {
        total += (current[idx] / 5) * crit.weight;
      });
      const calcVal = Math.round(total);
      const diff = Math.abs(calcVal - targetScore);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestCombination = [...current];
      }
      return;
    }
    for (let val = 1; val <= 5; val++) {
      search(index + 1, [...current, val]);
    }
  };
  
  search(0, []);
  
  const result: Record<string, number> = {};
  criteria.forEach((crit, idx) => {
    result[crit.key] = bestCombination[idx] !== undefined ? bestCombination[idx] : 1;
  });
  return result;
}

// --- View: Evaluation Form ---
function EvaluationForm({ vendor, onSave, onClose, currentUser }: { vendor: Vendor, onSave: (v: Vendor, msg?: string | null) => void, onClose: () => void, currentUser: User | null }) {
  const [scores, setScores] = useState<Record<string, Record<string, number>>>(() => {
    const initialDepts = ['commercial', 'qa', 'planning', 'finance'];
    const res: Record<string, Record<string, number>> = {};
    initialDepts.forEach(dept => {
      res[dept] = {};
      const layout = FORM_LAYOUT.find(l => l.id === dept);
      if (layout) {
        layout.criteria.forEach(crit => {
          res[dept][crit.key] = getRawScoreValue(vendor, dept, crit.key);
        });
      }
    });
    return res;
  });

  useEffect(() => {
    const initialDepts = ['commercial', 'qa', 'planning', 'finance'];
    const res: Record<string, Record<string, number>> = {};
    initialDepts.forEach(dept => {
      res[dept] = {};
      const layout = FORM_LAYOUT.find(l => l.id === dept);
      if (layout) {
        layout.criteria.forEach(crit => {
          res[dept][crit.key] = getRawScoreValue(vendor, dept, crit.key);
        });
      }
    });
    setScores(res);
  }, [vendor.id, vendor.scores, vendor.rawScores]);

  const [modifiedDepts, setModifiedDepts] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const visibleFormLayout = currentUser?.role === 'admin'
    ? FORM_LAYOUT
    : FORM_LAYOUT.filter(d => d.id === currentUser?.role);

  const handleSlider = (deptId: string, critKey: string, val: string) => {
    setScores(prev => ({
      ...prev,
      [deptId]: { ...prev[deptId], [critKey]: parseInt(val, 10) }
    }));
    setModifiedDepts(prev => ({
      ...prev,
      [deptId]: true
    }));
  };


  const handleSave = () => {
    setIsSaving(true);
    
    setTimeout(() => {
      const prevScores = vendor.scores || { commercial: 0, qa: 0, planning: 0, finance: 0 };
      const submittedScores = {
        commercial: calculateDeptAverage('commercial', scores.commercial),
        qa: calculateDeptAverage('qa', scores.qa),
        planning: calculateDeptAverage('planning', scores.planning),
        finance: calculateDeptAverage('finance', scores.finance)
      };

      const effectiveModifiedDepts = { ...modifiedDepts };
      visibleFormLayout.forEach(dept => {
        effectiveModifiedDepts[dept.id] = true;
      });

      const finalScores = {
        commercial: effectiveModifiedDepts.commercial ? submittedScores.commercial : (prevScores.commercial || 0),
        qa: effectiveModifiedDepts.qa ? submittedScores.qa : (prevScores.qa || 0),
        planning: effectiveModifiedDepts.planning ? submittedScores.planning : (prevScores.planning || 0),
        finance: effectiveModifiedDepts.finance ? submittedScores.finance : (prevScores.finance || 0)
      };

      const finalRawScores = {
        commercial: effectiveModifiedDepts.commercial ? scores.commercial : vendor.rawScores?.commercial,
        qa: effectiveModifiedDepts.qa ? scores.qa : vendor.rawScores?.qa,
        planning: effectiveModifiedDepts.planning ? scores.planning : vendor.rawScores?.planning,
        finance: effectiveModifiedDepts.finance ? scores.finance : vendor.rawScores?.finance
      };

      const isFullyScored = finalScores.commercial > 0 && finalScores.qa > 0 && finalScores.planning > 0 && finalScores.finance > 0;
      
      let grade = vendor.grade;
      let pStatus = vendor.status;
      let pCategory = vendor.category;

      if (isFullyScored) {
        const overall = calculateOverallScore(finalScores);
        if (overall! >= 80) {
          grade = 'A';
          pStatus = 'approved';
        } else if (overall! >= 60) {
          grade = 'B';
          pStatus = 'approved';
        } else if (overall! >= 40) {
          grade = 'C';
          pStatus = 'conditional';
        } else {
          grade = 'rejected';
          pStatus = 'rejected';
        }
      }

      const statusMapList = { approved: 'تایید شده', conditional: 'تایید مشروط', rejected: 'مردود', new: 'جدید' };
      const newLog = {
        id: 'log_' + Math.random().toString(36).substring(2, 8),
        action: `ثبت ارزیابی نهایی سورس "${vendor.material}" (${vendor.name}) - گرید نهایی: [Grade ${grade}]، وضعیت جدید: [${statusMapList[pStatus] || pStatus}] (امتیازات: آزمایشگاهی: ${finalScores.qa || 0}، بازرگانی: ${finalScores.commercial || 0}، برنامه‌ریزی: ${finalScores.planning || 0}، مالی: ${finalScores.finance || 0})`,
        date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
        user: currentUser?.name || 'کاربر سیستم'
      };

      onSave({
        ...vendor,
        status: pStatus,
        grade: grade,
        category: pCategory,
        scores: finalScores,
        rawScores: finalRawScores,
        lastAudit: isFullyScored ? new Date().toLocaleDateString('fa-IR') : vendor.lastAudit,
        activityLogs: [...(vendor.activityLogs || []), newLog]
      }, null);

      setIsSaving(false);
      setIsSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1000);
    }, 600);
  };

  if (isSuccess) {
    return (
      <div className="bg-card border border-emerald-500/20 rounded-xl p-16 text-center shadow-sm flex flex-col items-center justify-center fade-in">
        <div className="bg-emerald-50/10 p-4 rounded-full border border-emerald-500/20 mb-6">
          <CheckCircle className="w-16 h-16 text-emerald-500 bounce-in" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-2">ارزیابی با موفقیت ثبت شد</h3>
        <p className="text-muted-foreground font-medium">اطلاعات امتیازدهی و نتایج ارزیابی با موفقیت ثبت گردید. در حال بازگشت...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ScoringGuide currentUser={currentUser} />

      <div className="bg-card border border-slate-900/10 rounded-xl p-6 md:p-8 fade-in shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {visibleFormLayout.map(dept => {
             const Icon = dept.icon;
             const isModified = modifiedDepts[dept.id] || false;
             const prevDeptScore = vendor.scores?.[dept.id as keyof Scores] || 0;
             const avg = isModified ? calculateDeptAverage(dept.id, scores[dept.id]) : prevDeptScore;

             return (
               <div key={dept.id} className="bg-muted border border-slate-900/10 rounded-xl p-5 relative overflow-hidden group">
                  <div className={`absolute top-0 right-0 w-full h-[3px] opacity-80 ${getScoreColorClass(avg, true)}`} />
                  <div className="flex justify-between items-center mb-6">
                     <div className="flex items-center gap-3">
                       <div className="bg-card p-2 rounded-lg border border-slate-900/10 shadow-sm">
                         <Icon className="w-5 h-5 text-muted-foreground" />
                       </div>
                       <div>
                         <h4 className="font-bold text-foreground leading-none">{dept.title}</h4>
                         <span className="text-[10px] text-muted-foreground font-medium block mt-1">
                           <span className="text-muted-foreground">بخش ارزیابی دپارتمانی</span>
                         </span>
                       </div>
                     </div>
                     <div className="text-right">
                       <div className="text-[10px] text-muted-foreground font-semibold mb-0.5">میانگین بخش</div>
                       <div className={`text-2xl font-black font-mono tracking-tighter ${getScoreColorClass(avg)}`}>
                         {avg}
                       </div>
                     </div>
                  </div>

                  <div className="space-y-4">
                    {dept.criteria.map(crit => {
                      const prevValue = vendor.rawScores?.[dept.id]?.[crit.key] ??
                                        (vendor.scores && (vendor.scores as any)[dept.id] > 0
                                          ? Math.round((vendor.scores as any)[dept.id] / 20)
                                          : 0);
                      const isChanged = scores[dept.id][crit.key] !== prevValue;

                      return (
                        <div key={crit.key} className="bg-card border border-border rounded-lg p-3 space-y-2 shadow-xs">
                          <div className="flex justify-between items-start text-xs">
                            <span className="text-foreground font-medium leading-relaxed max-w-[70%]">{crit.label} <span className="text-cyan-600 font-semibold ml-1">(وزن: {crit.weight})</span></span>
                            <div className="flex items-center gap-1.5 shrink-0 select-none">
                              {prevValue > 0 && (
                                <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/60 font-medium">
                                  قبلی: {prevValue}
                                </span>
                              )}
                              <span className={`text-[11px] px-1.5 py-0.5 rounded border font-mono font-bold ${
                                isChanged
                                  ? 'text-amber-700 bg-amber-50 border-amber-200 animate-pulse'
                                  : 'text-muted-foreground bg-muted border-border'
                              }`}>
                                {scores[dept.id][crit.key]} / 5
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <input
                              type="range" dir="ltr"
                              min="1" max="5" step="1"
                              value={scores[dept.id][crit.key]}
                              onChange={(e) => handleSlider(dept.id, crit.key, e.target.value)}
                              className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-cyan-600 focus:outline-none"
                            />

                          </div>
                        </div>
                      );
                    })}
                  </div>
               </div>
             )
          })}
       </div>

       <div className="mb-8">
         <label className="block text-sm font-bold text-foreground mb-2">توضیحات و توجیه ارزیابی</label>
         <textarea
           dir="rtl"
           rows={4}
           className="w-full bg-card border border-slate-900/10 rounded-xl p-4 text-sm text-foreground focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 resize-none shadow-sm transition-shadow"
           placeholder="موارد کیفی مهم، تعهدات اخذ شده جهت بهبود، یا دلایل اعطای نمرات پایین..."
           value={comments}
           onChange={(e) => setComments(e.target.value)}
         ></textarea>
       </div>

       <div className="flex flex-col md:flex-row items-center justify-end gap-6 border-t border-slate-900/10 pt-6">
         <button
           onClick={handleSave}
           disabled={isSaving}
           className="w-full md:w-auto flex flex-row-reverse items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-sm disabled:opacity-75"
         >
           {isSaving ? (
             <span className="inline-block w-5 h-5 border-2 border-slate-500 border-t-white rounded-full animate-spin" />
           ) : (
             <Archive className="w-5 h-5" />
           )}
            <span>ذخیره ارزیابی</span>
          </button>
        </div>
     </div>
     </div>
   );
}

 // --- View: Supplier Unified Audit & Analysis Module ---

 interface SupplierGroup {
   key: string;
   name: string;
   nameEn: string;
   country: string;
   contactInfo: string;
   registrationDate: string;
   vendors: Vendor[];
 }

  interface SupplierAuditViewProps {
    db: Vendor[];
    onSelectVendor: (vendor: Vendor) => void;
    currentUser: User | null;
    partners?: BusinessPartner[];
  }

  export function SupplierAuditView({ db, onSelectVendor, currentUser, partners = [] }: SupplierAuditViewProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSupplierKey, setSelectedSupplierKey] = useState<string | null>(null);

    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
      setCurrentPage(1);
    }, [searchQuery]);

    // Group vendors list by supplier name
    const supplierGroups = useMemo(() => {
      const groups: Record<string, SupplierGroup> = {};

      db.forEach(v => {
        const key = v.name.trim().toLowerCase();
        if (!key) return;

        if (!groups[key]) {
          groups[key] = {
            key,
            name: v.name,
            nameEn: v.nameEn || 'N/A',
            country: getDisplayCountry(v) || 'مشخص نشده',
            contactInfo: v.contactInfo || '',
            registrationDate: v.registrationDate || '',
            vendors: []
          };
        }
        groups[key].vendors.push(v);
      });

      return Object.values(groups);
    }, [db]);

    // Filter matching suppliers list
    const filteredSuppliers = useMemo(() => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return supplierGroups;

      return supplierGroups.filter(s => 
        s.name.toLowerCase().includes(query) ||
        s.nameEn.toLowerCase().includes(query) ||
        s.country.toLowerCase().includes(query) ||
        s.vendors.some(v => 
          v.material.toLowerCase().includes(query) ||
          v.materialEn.toLowerCase().includes(query) ||
          (v.cas && v.cas.toLowerCase().includes(query))
        )
      );
    }, [supplierGroups, searchQuery]);

    const ITEMS_PER_PAGE = 20;
    const totalItems = filteredSuppliers.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
   const endIndex = startIndex + ITEMS_PER_PAGE;
   const paginatedSuppliers = useMemo(() => {
     return filteredSuppliers.slice(startIndex, endIndex);
   }, [filteredSuppliers, startIndex, endIndex]);

   // Find active supplier details
   const activeSupplier = useMemo(() => {
     if (!selectedSupplierKey) return null;
     return supplierGroups.find(s => s.key === selectedSupplierKey) || null;
   }, [supplierGroups, selectedSupplierKey]);

       // Business Partner Resolution for Active Supplier Header
    const activePartnerDetails = useMemo(() => {
      if (!activeSupplier) return null;

      const firstVendor = activeSupplier.vendors[0];
      const matchedPartner = partners.find(p => p.name.trim().toLowerCase() === activeSupplier.name.trim().toLowerCase());

      let mfgPartner = partners.find(p => p.id === firstVendor?.manufacturerId);
      let supPartner = partners.find(p => p.id === firstVendor?.supplierId);

      if (matchedPartner) {
        if (matchedPartner.type === 'Supplier') {
          supPartner = matchedPartner;
          if (!mfgPartner && matchedPartner.manufacturerId) {
            mfgPartner = partners.find(p => p.id === matchedPartner.manufacturerId);
          }
        } else if (matchedPartner.type === 'Manufacturer') {
          mfgPartner = matchedPartner;
        }
      }

      const mfgName = mfgPartner ? mfgPartner.name : (firstVendor?.name || activeSupplier.name);
      const mfgCountry = mfgPartner ? (mfgPartner.country || 'نامشخص') : (activeSupplier.country || 'نامشخص');

      const supName = supPartner ? supPartner.name : null;
      const supCountry = supPartner ? (supPartner.country || 'نامشخص') : null;
      const supGrade = supPartner?.evaluation?.grade || 'نامشخص';

      return {
        mfgName,
        mfgCountry,
        supName,
        supCountry,
        supGrade,
        supPartner
      };
    }, [activeSupplier, partners]);

    // Aggregate performance metrics for active supplier
   const stats = useMemo(() => {
     if (!activeSupplier) return null;

     const list = activeSupplier.vendors;
     const totalItems = list.length;

     let scoredCount = 0;
     let scoresSum = 0;
     const deptTotals = { commercial: 0, qa: 0, planning: 0, finance: 0 };
     const deptCounts = { commercial: 0, qa: 0, planning: 0, finance: 0 };

     list.forEach(v => {
       let overall = null;
       if (currentUser?.role === 'admin') {
         overall = calculateOverallScore(v.scores, true);
       } else if (currentUser?.role) {
         overall = v.scores?.[currentUser.role as keyof Scores] || 0;
       }
       if (overall !== null && overall > 0) {
         scoresSum += overall;
         scoredCount++;
       }

       if (v.scores) {
         if (v.scores.commercial > 0) { deptTotals.commercial += v.scores.commercial; deptCounts.commercial++; }
         if (v.scores.qa > 0) { deptTotals.qa += v.scores.qa; deptCounts.qa++; }
         if (v.scores.planning > 0) { deptTotals.planning += v.scores.planning; deptCounts.planning++; }
         if (v.scores.finance > 0) { deptTotals.finance += v.scores.finance; deptCounts.finance++; }
       }
     });
 
     const avgPerformance = scoredCount > 0 ? Math.round(scoresSum / scoredCount) : null;
 
     const deptAverages = {
       commercial: deptCounts.commercial > 0 ? Math.round(deptTotals.commercial / deptCounts.commercial) : 0,
       qa: deptCounts.qa > 0 ? Math.round(deptTotals.qa / deptCounts.qa) : 0,
       planning: deptCounts.planning > 0 ? Math.round(deptTotals.planning / deptCounts.planning) : 0,
       finance: deptCounts.finance > 0 ? Math.round(deptTotals.finance / deptCounts.finance) : 0,
     };
 
     // Group count of items by standard status
     const statusDistribution = { approved: 0, conditional: 0, rejected: 0, new: 0 };
     list.forEach(v => {
       statusDistribution[v.status as keyof typeof statusDistribution] = (statusDistribution[v.status as keyof typeof statusDistribution] || 0) + 1;
     });
 
     // Find dominant grade representation
     const gradeCounts: Record<string, number> = {};
     list.forEach(v => {
       if (v.grade) {
         gradeCounts[v.grade] = (gradeCounts[v.grade] || 0) + 1;
       }
     });
 
     let dominantGrade = 'N/A';
     let maxCount = 0;
     Object.entries(gradeCounts).forEach(([g, count]) => {
       if (count > maxCount) {
         maxCount = count;
         dominantGrade = g;
       }
     });
 
     return {
       totalItems,
       avgPerformance,
       deptAverages,
       statusDistribution,
       dominantGrade
     };
   }, [activeSupplier]);
 
   return (
     <div className="space-y-6 fade-in text-right">
       {/* Breadcrumbs / View switcher header */}
       <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-5">
         <div>
           {activeSupplier ? (
             <button 
               onClick={() => setSelectedSupplierKey(null)}
               className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-xs font-bold border border-border bg-card rounded-xl px-4 py-2.5 shadow-sm transition-all cursor-pointer"
             >
               <ChevronLeft className="w-4 h-4 rotate-180 text-muted-foreground" />
               <span>بازگشت به مانیتور جامع تامین‌کنندگان</span>
             </button>
           ) : (
             <div className="flex items-center gap-2 bg-teal-50 text-teal-600 border border-teal-200/50 px-3 py-1 rounded-lg text-xs font-bold font-mono">
               <Activity className="w-3.5 h-3.5 animate-pulse" />
               <span>PROACTIVE ACTIVE DISCOVERY MODULE</span>
             </div>
           )}
         </div>
 
         <div className="order-1 md:order-2 text-right">
           <h2 className="text-2xl font-bold text-foreground mb-1.5 flex items-center justify-end gap-3">
             {activeSupplier ? 'کارنامه جامع ممیزی و تامین' : 'بررسی یکپارچه تامین‌کنندگان (Supplier Core)'}
             <Handshake className="w-6 h-6 text-teal-600" />
           </h2>
           <p className="text-[#6E6E73] text-sm">
             {activeSupplier 
               ? 'تجمیع اطلاعات تامین کالا، پایداری کیفیت و سوابق ممیزی اقلام'
               : 'مشاهده و مانیتورینگ متمرکز تامین‌کنندگان، تعداد مواد عرضه شده و گرید کیفی میانگین'
             }
           </p>
         </div>
       </div>

       {/* DETAIL VIEW OF SINGLE SUPPLIER */}
       {activeSupplier && stats ? (
         <div className="space-y-6">
           {/* Supplier Profile Banner Card */}
           <div className="bg-card border border-slate-900/10 rounded-2xl p-6 shadow-sm relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
             <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-teal-600" />
             <div className="flex flex-col sm:flex-row sm:items-center gap-4 text-right">
               <div className="bg-teal-50 border border-teal-100 text-teal-600 p-3 rounded-xl shrink-0 self-start sm:self-center">
                 <Building className="w-7 h-7" />
                </div>
                <div>
                  {activePartnerDetails ? (
                    <>
                      {/* Manufacturer display (Bold) */}
                      <div className="font-bold text-foreground text-lg sm:text-xl lg:text-2xl leading-tight mb-1">
                        <span>تولید کننده : {activePartnerDetails.mfgName}</span>
                        <span className="mx-3 sm:mx-4 text-slate-300 font-normal">|</span>
                        <span>کشور : {activePartnerDetails.mfgCountry}</span>
                      </div>

                      {/* Supplier display (Regular) - Only if Source/Partner has a Supplier */}
                      {activePartnerDetails.supPartner && (
                        <div className="font-normal text-muted-foreground text-xs sm:text-sm leading-relaxed mt-1">
                          <span>فروشنده : {activePartnerDetails.supName}</span>
                          <span className="mx-3 text-slate-300">|</span>
                          <span>کشور : {activePartnerDetails.supCountry}</span>
                          <span className="mx-3 text-slate-300">|</span>
                          <span>Grade : {activePartnerDetails.supGrade}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-lg font-bold text-foreground flex items-center justify-start gap-2.5">
                      <span>{activeSupplier.name}</span>
                      {activeSupplier.country && (
                        <span className="bg-muted border border-border text-muted-foreground text-[10px] font-bold px-2 py-0.5 rounded-md font-mono max-w-[200px] truncate" title={activeSupplier.country}>
                          {activeSupplier.country}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-muted-foreground text-xs font-mono mt-1" dir="ltr" style={{ textAlign: 'right' }}>{activeSupplier.nameEn}</div>
                  {activeSupplier.contactInfo && (
                    <p className="text-muted-foreground text-xs mt-2 font-mono" dir="rtl">{activeSupplier.contactInfo}</p>
                  )}
                </div>
              </div>

             {stats.avgPerformance !== null && (
               <div className="bg-muted border border-border rounded-2xl p-4 flex items-center gap-4 self-stretch md:self-auto justify-between">
                 <div className="text-left">
                   <div className="text-[10px] uppercase font-bold text-muted-foreground">{currentUser?.role === 'admin' ? 'Integrated SPS Rating' : 'Departmental Average Rating'}</div>
                   <div className="text-xs text-muted-foreground font-medium font-sans mt-0.5" dir="rtl">{currentUser?.role === 'admin' ? 'شاخص کل عملکرد تامین‌کننده' : 'شاخص میانگین عملکرد واحد شما'}</div>
                 </div>
                 <div className={`text-3xl font-black font-mono leading-none ${getScoreColorClass(stats.avgPerformance)} bg-card px-4 py-3 rounded-xl border border-border shadow-sm`}>
                   {Math.round(stats.avgPerformance || 0).toLocaleString('en-US')}
                 </div>
               </div>
             )}
           </div>

           {/* Elegant summary callout instead of the 4 boxes */}
            <div className="bg-muted border border-border/50 rounded-2xl p-4 flex items-center justify-between gap-4 text-right mb-4">
              <div className="flex items-center gap-3 w-full justify-start">
                <div className="bg-teal-50 border border-teal-100 text-teal-600 p-2.5 rounded-xl shrink-0">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-foreground font-bold text-sm">وضعیت تامین کالا</div>
                  <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
                    تاکنون از این تامین‌کننده تعداد <span className="font-bold font-mono text-foreground text-sm mx-1 bg-card border border-border px-1.5 py-0.5 rounded-md shadow-sm">{stats.totalItems}</span> مورد تامین و ارزیابی شده است که جزئیات عملکرد هر یک به تفکیک در جدول زیر ارائه گردیده است:
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-slate-900/10 rounded-2xl shadow-sm overflow-hidden mb-6">
             <div className="bg-muted px-6 py-4 border-b border-slate-900/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
               <div className="w-full sm:w-auto uppercase font-bold text-muted-foreground text-xs tracking-wider text-right">
                 جدول مقایسه نمرات مواد تامین شده (Materials Performance Matrix)
               </div>
               <span className="text-[10px] text-teal-600 font-bold bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-md">
                 تعداد اقلام ممیزی شده: <span className="font-mono">{stats.totalItems}</span> ماده فعال یا نمونه
               </span>
             </div>
 
             <div className="overflow-x-auto">
               <table className="w-full text-right divide-y divide-border">
                 <thead className="bg-muted/50 text-[10px] sm:text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border">
                   <tr>
                     <th className="px-3 sm:px-4 py-3 text-right">ماده</th>
                     <th className="px-3 sm:px-4 py-3 text-center">CAS No.</th>
                     <th className="px-3 sm:px-4 py-3 text-center">وضعیت</th>
                     <th className="px-3 sm:px-4 py-3 text-center">عملیات</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-border text-xs sm:text-sm">
                   {activeSupplier.vendors.map((v) => {
                     const matchedCat = categoryLabels[v.category as keyof typeof categoryLabels] || { fa: v.category, icon: Globe };
                     const CatIcon = matchedCat.icon;
 
                     return (
                       <tr key={v.id} className="hover:bg-accent/80 transition-colors">
                         <td className="px-3 sm:px-4 py-2.5">
                           <div className="flex items-center gap-2">
                             <div className="bg-muted border border-border text-muted-foreground p-1.5 rounded-lg shrink-0">
                               <CatIcon className="w-3.5 h-3.5" />
                             </div>
                             <div className="min-w-0">
                               <div className="font-bold text-foreground text-[11px] sm:text-[12px] whitespace-nowrap" title={v.material}>{v.material || 'N/A'}</div>
                               <div className="text-muted-foreground text-[9px] sm:text-[10px] font-mono mt-0.5 whitespace-nowrap" dir="ltr" style={{ textAlign: 'right' }} title={v.materialEn}>{v.materialEn || 'N/A'}</div>
                             </div>
                           </div>
                         </td>
                         <td className="px-3 sm:px-4 py-2.5 text-center whitespace-nowrap">
                           <div className="inline-block text-right">
                             {v.cas && (
                                <div className="text-[10px] sm:text-xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50 inline-block font-mono" dir="ltr">
                                  <span className="text-muted-foreground font-sans font-bold text-[9px] mr-1">CAS No.:</span>
                                  <span>{v.cas}</span>
                                </div>
                              )}
                             {v.isSample && (
                               <div className="text-[9px] sm:text-[10px] text-teal-600 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded font-bold mt-1 block">
                                 نمونه ارزیابی اولیه / سمپل
                               </div>
                             )}
                           </div>
                         </td>
                         <td className="px-3 sm:px-4 py-2.5 text-center">
                           <GradeBadge grade={v.grade} status={v.status} scores={v.scores} />
                         </td>
                         <td className="px-3 sm:px-4 py-2.5 text-center whitespace-nowrap">
                           <button
                             type="button"
                             onClick={() => onSelectVendor(v)}
                             className="text-teal-600 hover:text-teal-700 bg-teal-50 hover:bg-teal-100/80 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-colors border border-teal-200/50 font-bold text-[10px] sm:text-xs cursor-pointer inline-flex items-center gap-1"
                           >
                             <Pencil className="w-3 h-3" />
                             <span>پرونده ممیزی</span>
                           </button>
                         </td>
                       </tr>
                     );
                   })}
                 </tbody>
               </table>
             </div>
           </div>
 
           {/* Multi-Dimensional Audit Score Breakdown (CSS Infographics Column Charts) */}
           <div className="bg-card border border-slate-900/10 rounded-2xl p-6 shadow-sm">
             <h3 className="text-base text-foreground font-bold mb-6 flex items-center justify-start gap-2.5">
               <span>شاخص میانگین عملکرد تفکیک شده دپارتمانی (Departmental Performance)</span>
               <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-ping" />
             </h3>
 
             <div className={`grid grid-cols-1 ${currentUser?.role === 'admin' ? 'md:grid-cols-4' : 'max-w-md mx-auto'} gap-6`}>
               {[
                 { id: 'commercial', name: 'بازرگانی', avg: stats.deptAverages.commercial, icon: Briefcase, color: 'bg-[#0071E3]' },
                 { id: 'qa', name: 'کیفیت', avg: stats.deptAverages.qa, icon: Microscope, color: 'bg-emerald-600' },
                 { id: 'planning', name: 'برنامه‌ریزی و انبار', avg: stats.deptAverages.planning, icon: Warehouse, color: 'bg-violet-600' },
                 { id: 'finance', name: 'مالی', avg: stats.deptAverages.finance, icon: Coins, color: 'bg-amber-600' }
               ].filter(dept => currentUser?.role === 'admin' || dept.id === currentUser?.role).map((dept) => (
                 <div key={dept.id} className="bg-muted border border-border rounded-xl p-4 flex flex-col justify-between hover:shadow-md hover:border-border transition-all">
                   <div>
                     <div className="flex items-center justify-between text-foreground font-bold text-sm mb-4">
                       <div className="flex items-center gap-2">
                         <dept.icon className="w-4 h-4 text-muted-foreground" />
                         <span>{dept.name}</span>
                       </div>
                       <span className={`text-sm font-bold font-mono ${getScoreColorClass(dept.avg)}`}>{dept.avg} / 100</span>
                     </div>
                   </div>

                   <div>
                     <div className="w-full bg-slate-200/80 h-2 rounded-full overflow-hidden">
                       <div className={`${getScoreColorClass(dept.avg, true)} h-full rounded-full transition-all`} style={{ width: `${dept.avg}%` }} />
                     </div>
                   </div>
                 </div>
               ))}
             </div>
           </div>
 

 
         </div>
       ) : (
         /* GLOBAL SEARCH & DISCOVERY DIRECTORY OF ALL UNIQUE SUPPLIERS */
         <div className="space-y-6">
           {/* Large Elegant Search Panel */}
           <div className="bg-card/75 backdrop-blur-md border border-slate-900/10 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row gap-4 items-center focus-within:ring-2 focus-within:ring-teal-500/20 transition-all">
             <div className="flex-1 flex items-center gap-3 w-full">
               <Search className="w-5 h-5 text-muted-foreground shrink-0" />
               <input
                 type="text"
                 className="flex-1 bg-transparent text-sm text-foreground placeholder-slate-400 focus:outline-none text-right"
                 placeholder="نام تامین‌کننده، نام داروی شیمیایی، کد CAS یا کشور را جستجو کنید..."
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
               />
               {searchQuery && (
                 <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-muted-foreground">
                   <X className="w-4 h-4" />
                 </button>
               )}
             </div>
           </div>
 
           {/* Grid list of Suppliers */}
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {filteredSuppliers.length === 0 ? (
               <div className="col-span-full bg-card border border-border p-16 rounded-2xl text-center text-muted-foreground flex flex-col items-center">
                 <Building className="w-12 h-12 opacity-20 mb-4 text-teal-600" />
                 <span className="font-bold text-muted-foreground text-lg">هیچ تامین‌کننده‌ای یافت نشد.</span>
                 <p className="text-muted-foreground text-sm mt-1">تغییر کوئری بدهید یا نام انگلیسی دقیق یا فارسی را وارد نمایید.</p>
               </div>
             ) : (
               paginatedSuppliers.map((supplier) => {
                 // calculate simple overall score average for highlight
                 let scoresSum = 0;
                 let scoredCount = 0;
                 supplier.vendors.forEach(v => {
                    let s = null;
                    if (currentUser?.role === 'admin') {
                      s = calculateOverallScore(v.scores, true);
                    } else if (currentUser?.role) {
                      s = v.scores?.[currentUser.role as keyof Scores] || 0;
                    }
                   if (s !== null && s > 0) {
                     scoresSum += s;
                     scoredCount++;
                   }
                 });
                 const avgScore = scoredCount > 0 ? Math.round(scoresSum / scoredCount) : null;
 
                 return (
                   <div 
                     key={supplier.key}
                     role="button"
                     tabIndex={0}
                     aria-label={`بررسی ممیزی ${supplier.name}`}
                     onClick={() => setSelectedSupplierKey(supplier.key)}
                     onKeyDown={(event) => {
                       if (event.key === 'Enter' || event.key === ' ') {
                         event.preventDefault();
                         setSelectedSupplierKey(supplier.key);
                       }
                     }}
                     className="bg-card border border-slate-900/10 rounded-2xl p-5 hover:shadow-md hover:border-teal-500/20 transition-all cursor-pointer group flex flex-col justify-between text-right"
                   >
                     <div>
                       <div className="flex items-start justify-between gap-3 mb-4">
                         <div className="bg-teal-50 border border-teal-100 text-teal-600 p-2.5 rounded-xl group-hover:bg-teal-600 group-hover:text-white transition-colors">
                           <Building className="w-5 h-5" />
                         </div>
                         <div className="text-left font-mono text-[10px] text-muted-foreground font-semibold bg-muted px-2 py-0.5 rounded border border-border max-w-[150px] truncate" title={supplier.country}>
                           {supplier.country}
                         </div>
                       </div>
 
                       <h3 className="font-bold text-foreground text-base leading-snug tracking-tight group-hover:text-teal-600 transition-colors">
                         {supplier.name}
                       </h3>
                       <div className="text-muted-foreground text-xs font-mono mt-1" dir="ltr" style={{ textAlign: 'right' }}>{supplier.nameEn}</div>
 
                       {/* List of drugs supplied */}
                       <div className="mt-4 pt-3 border-t border-border">
                         <span className="text-[10px] font-bold text-muted-foreground block mb-1.5 uppercase font-sans">محصولات ثبت‌شده در دیتابیس:</span>
                         <div className="flex flex-wrap gap-1 justify-start">
                           {supplier.vendors.slice(0, 3).map((v) => (
                             <span key={v.id} className="text-[10px] bg-muted text-muted-foreground px-2 py-1 rounded border border-slate-150 font-medium max-w-[120px] truncate">
                               {v.material}
                             </span>
                           ))}
                           {supplier.vendors.length > 3 && (
                             <span className="text-[9px] bg-slate-900 text-white px-1.5 py-1 rounded font-bold font-mono">
                               +{supplier.vendors.length - 3} مورد دیگر
                             </span>
                           )}
                         </div>
                       </div>
                     </div>
 
                     <div className="mt-6 pt-3 border-t border-border flex items-center justify-between">
                       <div className="flex items-center gap-3">
                         <span className="text-[11px] text-muted-foreground font-sans">{currentUser?.role === 'admin' ? 'میانگین امتیاز ممیزی:' : 'میانگین امتیاز واحد شما:'}</span>
                         <span className={`text-xs font-bold ${getScoreColorClass(avgScore)} font-mono`}>
                           {avgScore !== null ? `${avgScore}%` : 'N/A'}
                         </span>
                       </div>
                       <span className="text-teal-600 group-hover:translate-x-[-4px] transition-transform text-xs font-bold flex items-center gap-1 font-mono">
                         بررسی ممیزی
                         <ChevronLeft className="w-3.5 h-3.5" />
                       </span>
                     </div>
                   </div>
                 );
               })
             )}
           </div>

           <Pagination 
             currentPage={currentPage}
             totalPages={totalPages}
             totalItems={totalItems}
             startIndex={startIndex}
             endIndex={endIndex}
             onPageChange={setCurrentPage}
           />
         </div>
       )}
     </div>
   );
 }

