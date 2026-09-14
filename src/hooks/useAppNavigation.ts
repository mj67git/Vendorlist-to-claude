import React, { useEffect, useRef, useState } from 'react';
import type { Category, Vendor } from '../types';
import { categoryLabels } from '../constants/categories';
import {
  buildStackFromRoute, decodeRoute, encodeRoute, routeKey,
  type RouteState, type TaskKey,
} from '../utils/navRoutes';
import {
  capHistory, hydrateVendor, popForm, popView, pushForm, pushVendor,
  pushView, refreshVendorEverywhere, type ViewState,
} from '../utils/navStack';

/**
 * Where the user is, how they got there, and what may not be left behind.
 *
 * This is the whole of the navigation model described in project rule 10 — the
 * `viewHistory` stack, the hash routing that keeps a link shareable, the
 * browser history entries that make Back and Forward work natively, and the
 * unsaved-changes guard every route has to pass through. It was ~420 lines
 * split across two distant regions of `App.tsx`: the hooks near the top (they
 * must stay above the sign-in early return or the order of hooks breaks) and
 * the actions far below it. Reading one half never told you what the other did.
 *
 * It stays one hook rather than four because the parts are not separable: the
 * guard decides whether a push happens, the push writes the URL, `popstate`
 * is the only thing that unwinds the stack, and `replaceUrlRef` exists to tell
 * one of those about the other.
 *
 * Nothing about the behaviour changed in the move.
 */

/**
 * The stack as it is stored, which is not the stack as it is used.
 *
 * What is kept of the selected source is enough to name the record in a
 * breadcrumb and no more; the full record is re-read from the register by id.
 * The distinction used to be made with `as any`.
 */
type PersistedViewState = Omit<ViewState, 'selectedVendor'> & {
  selectedVendor: Pick<Vendor, 'id' | 'name' | 'material' | 'materialEn'> | null;
};

export interface AppNavigationDeps {
  /** The register, for turning a route's source id back into a record. */
  vendors: Vendor[];
  /** Navigating closes the mobile sidebar; the rail itself belongs to the shell. */
  closeSidebar: () => void;
  /**
   * The two refs the background poll also reads — «is a form dirty» and «where
   * is the user standing».
   *
   * They are created by the caller rather than here because the register hook
   * needs them too, and the register is what this hook is given (`vendors`).
   * One of the two has to own them, and neither can: `App` does.
   */
  navGuardRef: React.MutableRefObject<(() => boolean) | null>;
  historyRef: React.MutableRefObject<ViewState[]>;
}

export function useAppNavigation({
  vendors, closeSidebar, navGuardRef, historyRef,
}: AppNavigationDeps) {
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
    // The ref is owned by the caller now and never changes identity, so naming
    // it here is free and keeps the dependency list truthful.
  }, [navGuardRef]);
  
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
  }, [navGuardRef]);
  
  // --- Hash routing / browser history ---------------------------------------
  // The URL hash is the shareable source of truth for the current location, and
  // each in-app push creates a real browser history entry — so Back, Forward
  // and the browser's history menu all behave natively.
  // NOTE: these hooks must stay above the early returns below so that hook
  // order stays stable across the login / change-password screens.
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
  }, [historyRef, navGuardRef]);
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
      closeSidebar();
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
      closeSidebar();
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

  return {
    viewHistory, setViewHistory,
    currentViewState, view, categoryId, formMode,
    selectedVendor, vendorLinkPending,
    expandedMaterial, setExpandedMaterial,
    scrollContainerRef,
    registerNavGuard, navGuardRef,
    /**
     * The live stack, for callbacks that fire after an await and must ask «is
     * the user still on the page they started from» before acting (rule 10).
     */
    historyRef,
    /** Set by a caller whose next stack change replaces the current page. */
    replaceUrlRef,
    /** The stub a deep link carries: an id, before the record has arrived. */
    pendingVendor,
    savesInFlight, setSavesInFlight,
    pendingNav, setPendingNav, pendingNavRef,
    runGuarded, navigate, handleSelectVendor, goBack,
    openSourceForm, closeSourceForm,
    getViewStateLabel, breadcrumbTrail, goToCrumb,
    updateCurrentVendorInHistory,
    routeToViewState, viewStateToRoute,
  };
}
