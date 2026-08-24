// Hash-based route encoding for the navigation stack.
//
// The app has no router library; the URL hash is the shareable representation
// of "where the user is". Hash (rather than path) routing is deliberate: the
// app is deployed both to Vercel and to an on-premise company server, and a
// hash URL needs no server-side rewrite rule to survive a refresh or a deep
// link.

export type RouteView =
  | 'home' | 'category' | 'archive' | 'supplier-audit'
  | 'audit-trail' | 'materials' | 'business-partners';

export interface RouteState {
  view: RouteView;
  categoryId: string | null;
  vendorId: string | null;
  expandedMaterial?: string | null;
}

export const CATEGORY_IDS = ['foreign', 'domestic', 'veterinary', 'packaging', 'sample', 'blacklist'];

const SIMPLE_VIEWS: RouteView[] = ['archive', 'supplier-audit', 'audit-trail', 'materials', 'business-partners'];

/** Stable identity of a location, used to match a URL against the nav stack. */
export function routeKey(s: { view: string; categoryId?: string | null; vendorId?: string | null }): string {
  return `${s.view}|${s.categoryId ?? ''}|${s.vendorId ?? ''}`;
}

/** Serialize a location to a hash string (including the leading '#'). */
export function encodeRoute(s: RouteState): string {
  const q = s.view === 'category' && s.expandedMaterial
    ? `?m=${encodeURIComponent(s.expandedMaterial)}`
    : '';

  if (s.vendorId) {
    // Keep the parent category in the URL when there is one, so a shared link
    // restores a meaningful breadcrumb rather than a bare detail page.
    return s.categoryId
      ? `#/category/${encodeURIComponent(s.categoryId)}/vendor/${encodeURIComponent(s.vendorId)}`
      : `#/vendor/${encodeURIComponent(s.vendorId)}`;
  }
  if (s.view === 'category' && s.categoryId) {
    return `#/category/${encodeURIComponent(s.categoryId)}${q}`;
  }
  if (SIMPLE_VIEWS.includes(s.view)) return `#/${s.view}`;
  return '#/';
}

/** Parse a hash string back into a location. Returns null when unparseable. */
export function decodeRoute(rawHash: string): RouteState | null {
  const hash = (rawHash || '').replace(/^#/, '');
  if (!hash || hash === '/') return { view: 'home', categoryId: null, vendorId: null };

  const [pathPart, queryPart] = hash.split('?');
  const segs = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  if (segs.length === 0) return { view: 'home', categoryId: null, vendorId: null };

  let expandedMaterial: string | null = null;
  if (queryPart) {
    const m = new URLSearchParams(queryPart).get('m');
    if (m) expandedMaterial = m;
  }

  if (segs[0] === 'category') {
    const categoryId = segs[1];
    if (!categoryId || !CATEGORY_IDS.includes(categoryId)) return null;
    if (segs[2] === 'vendor' && segs[3]) {
      return { view: 'category', categoryId, vendorId: segs[3], expandedMaterial };
    }
    if (segs.length > 2) return null;
    return { view: 'category', categoryId, vendorId: null, expandedMaterial };
  }

  if (segs[0] === 'vendor' && segs[1] && segs.length === 2) {
    return { view: 'home', categoryId: null, vendorId: segs[1] };
  }

  if (segs.length === 1 && SIMPLE_VIEWS.includes(segs[0] as RouteView)) {
    return { view: segs[0] as RouteView, categoryId: null, vendorId: null };
  }

  if (segs.length === 1 && segs[0] === 'home') {
    return { view: 'home', categoryId: null, vendorId: null };
  }

  return null;
}

/**
 * Expand a location into a full navigation stack, synthesizing the ancestors a
 * user would have walked through. This is what gives a deep link a usable
 * breadcrumb and Back button.
 */
export function buildStackFromRoute(r: RouteState): RouteState[] {
  const home: RouteState = { view: 'home', categoryId: null, vendorId: null };
  if (r.view === 'home' && !r.vendorId) return [home];

  const stack: RouteState[] = [home];
  if (r.view === 'category' && r.categoryId) {
    stack.push({ view: 'category', categoryId: r.categoryId, vendorId: null, expandedMaterial: r.expandedMaterial ?? null });
  } else if (r.view !== 'home') {
    stack.push({ view: r.view, categoryId: null, vendorId: null });
  }

  if (r.vendorId) stack.push({ ...r });
  return stack;
}
