import type { Category, Vendor } from '../types';
import type { TaskKey } from './navRoutes';

/**
 * The navigation stack, as pure transitions.
 *
 * The stack — not the URL, and not a router library — is the source of truth
 * for where the user is (project rule 10). The URL mirrors it, and `popstate`
 * is the only thing that unwinds it, so the browser's own Back and Forward stay
 * in step with the breadcrumb.
 *
 * Every rule below was learned from a bug, and each one is easy to reintroduce
 * while editing 2,000 lines of component:
 *
 *   - Top-level navigation is a **tab switch, not a drill-down**. Pushing a
 *     duplicate made Back re-enter a source detail the user had deliberately
 *     left, so an existing entry is unwound to instead.
 *   - A detail page is **never** a form page. Saving a new source lands on its
 *     record, and if `formMode` came along the form rendered again on top of it.
 *   - Arriving at a record **from** the form replaces the form entry, because
 *     Back should return to the list, not into the form that was just finished.
 *   - `expandedMaterial` lives in the entry, so returning to a category list
 *     reopens the material the user had open.
 *
 * These were the least testable and most consequential lines in the frontend.
 * As functions of `(stack, argument) => stack` they are just data.
 */

export type ViewName =
  | 'home' | 'category' | 'archive' | 'supplier-audit'
  | 'audit-trail' | 'materials' | 'business-partners' | 'users' | 'tasks';

export interface ViewState {
  view: ViewName;
  categoryId: Category | null;
  selectedVendor: Vendor | null;
  /** Which backlog the worklist page is showing. */
  taskKey?: TaskKey | null;
  expandedMaterial?: string | null;
  /** The source form is a page, not an overlay — this is which page. */
  formMode?: 'create' | 'edit' | null;
}

/** A long session must not grow the stack without bound. */
export const MAX_VIEW_HISTORY = 25;

export function capHistory(stack: ViewState[]): ViewState[] {
  return stack.length > MAX_VIEW_HISTORY ? stack.slice(stack.length - MAX_VIEW_HISTORY) : stack;
}

export const HOME: ViewState = { view: 'home', categoryId: null, selectedVendor: null };

/**
 * Go to a top-level destination.
 *
 * Home resets the stack: it is the root, and stacking entries beneath it only
 * ever produced a Back button that went somewhere surprising.
 */
export function pushView(
  stack: ViewState[],
  view: ViewName,
  categoryId: Category | null = null,
  taskKey: TaskKey | null = null,
): ViewState[] {
  if (view === 'home') return [HOME];

  const existing = stack
    .map((s, i) => ({ s, i }))
    .filter(({ s }) =>
      s.view === view &&
      s.categoryId === categoryId &&
      (s.taskKey ?? null) === taskKey &&
      s.selectedVendor === null)
    .pop();

  if (existing) return stack.slice(0, existing.i + 1);
  return capHistory([...stack, { view, categoryId, selectedVendor: null, taskKey }]);
}

/** Open a source's detail page one level down. */
export function pushVendor(stack: ViewState[], vendor: Vendor): ViewState[] {
  const last = stack[stack.length - 1];
  if (last && last.selectedVendor?.id === vendor.id && !last.formMode) return stack;

  const base: ViewState = {
    ...last,
    formMode: null,
    selectedVendor: null,
    expandedMaterial: vendor.materialEn || last?.expandedMaterial || null,
  };
  // Coming from the form page means that page is finished: the record replaces
  // it rather than sitting on top of it.
  const head = last?.formMode ? stack.slice(0, -1) : [...stack.slice(0, -1), base];
  return capHistory([...head, { ...base, selectedVendor: vendor }]);
}

/**
 * Open the source form as a page of its own.
 *
 * A page rather than an overlay because the form opens its own "new partner"
 * dialog, and a modal inside a modal is a trap; as a page it also gets a URL,
 * a breadcrumb and a working Back button for nothing.
 */
export function pushForm(
  stack: ViewState[],
  mode: 'create' | 'edit',
  categoryId?: Category | null,
): ViewState[] {
  const last = stack[stack.length - 1];
  if (last?.formMode === mode) return stack;
  const base: ViewState = mode === 'edit'
    ? last
    : { ...last, view: 'category', categoryId: categoryId ?? last?.categoryId ?? 'domestic', selectedVendor: null };
  return capHistory([...stack, { ...base, formMode: mode }]);
}

/** Leave the form page after a save, landing somewhere definite. */
export function popForm(stack: ViewState[]): ViewState[] {
  return stack[stack.length - 1]?.formMode ? stack.slice(0, -1) : stack;
}

/** One level up. Never empties the stack — there is always somewhere to be. */
export function popView(stack: ViewState[]): ViewState[] {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

/** Jump straight to a depth of the stack (a breadcrumb click). */
export function truncateTo(stack: ViewState[], index: number): ViewState[] {
  if (index < 0 || index >= stack.length - 1) return stack;
  return stack.slice(0, index + 1);
}

/**
 * Replace the id-only stub at the top of the stack with the real record.
 *
 * A deep link carries only a vendor id, so the stack briefly holds `{ id }` and
 * the breadcrumb would read as a blank name until the data arrives. Only the
 * top entry is hydrated, and only while it is still a stub — a record the user
 * navigated to normally already carries its name, and rewriting it would
 * replace the object React is rendering for no reason.
 */
export function hydrateVendor(stack: ViewState[], vendor: Vendor): ViewState[] {
  const last = stack[stack.length - 1];
  if (!last?.selectedVendor) return stack;
  if (last.selectedVendor.id !== vendor.id || last.selectedVendor.name) return stack;
  const next = [...stack];
  next[next.length - 1] = {
    ...last,
    selectedVendor: vendor,
    expandedMaterial: last.expandedMaterial ?? vendor.materialEn ?? null,
  };
  return next;
}
