import { useEffect, useState } from 'react';
import { authFetch } from '../services/authFetch';
import { fetchAllVendors } from '../services/vendorPages';
import { isAllowedVendor, normalizeAndCleanVendor } from '../utils/vendorNormalize';
import type { Vendor } from '../types';

/**
 * The rows for a read-only view, read through the route that guards it.
 *
 * The archive and the supplier directory used to render from the shared store —
 * the same array every other page uses — and their permission was checked in
 * the browser. That check is UX only: `currentUser` comes from localStorage and
 * can be edited (rule 14). Now each of these views asks the server for its own
 * dataset at `GET /api/vendors?view=<view>`, and what it draws is whatever came
 * back from a request the server was free to refuse.
 *
 * Be precise about what this does and does not buy. It does NOT hide rows the
 * account already holds: both views are readings of the source list, which any
 * account with `vendor.read` receives for the category pages. What it does is
 * make the data on these two pages the product of an authorised response rather
 * than of a client-side flag, so revoking the permission empties them on the
 * next entry even if the store still has the rows. The rows an account may not
 * see at all — samples, the blacklist — are dropped by the server before they
 * are sent (`readableVendors`), on this route as on every other.
 *
 * The cost is one extra read of the register when either view is opened. It is
 * paid only on those two pages, and only for accounts that may open them.
 */
export type GatedAccess = 'checking' | 'allowed' | 'denied';

export interface GatedVendorList {
  access: GatedAccess;
  /** What the guarded response contained; empty until it has. */
  rows: Vendor[];
  loading: boolean;
  /** Set when the read failed for a reason that is not a refusal. */
  error: string | null;
}

export function useGatedVendorList(
  view: string | null,
  enabled: boolean,
  /** The signed-in account, so a different one asks again rather than inheriting. */
  identity?: string | null,
  /** Bumped when the register changes elsewhere, to keep this copy in step. */
  revision = 0,
): GatedVendorList {
  const [state, setState] = useState<GatedVendorList>({
    access: 'checking', rows: [], loading: true, error: null,
  });

  useEffect(() => {
    if (!view || !enabled) {
      setState({ access: 'allowed', rows: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState(prev => ({ ...prev, access: 'checking', loading: true, error: null }));

    // A refusal has to be told apart from a failure. `fetchAllVendors` only
    // knows that a page did not arrive, so the status is carried out in the
    // thrown error and read back here: 403 closes the view, anything else is a
    // load that went wrong and says so.
    const loaded: Vendor[] = [];
    fetchAllVendors<Vendor>({
      fetchPage: async (page, limit) => {
        const res = await authFetch(
          `/api/vendors?view=${encodeURIComponent(view)}&page=${page}&limit=${limit}`,
        );
        if (!res.ok) throw new Error(`view:${res.status}`);
        return res.json();
      },
      onPage: rows => {
        // Painted as they land, exactly as the shared load does: the archive is
        // the longest table in the application and holding the first page back
        // until the last one arrives is the wait this paging exists to avoid.
        loaded.push(...rows.filter(isAllowedVendor).map(normalizeAndCleanVendor));
        if (!cancelled) {
          setState({ access: 'allowed', rows: [...loaded], loading: true, error: null });
        }
      },
    })
      .then(() => {
        if (cancelled) return;
        setState({ access: 'allowed', rows: [...loaded], loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const denied = err instanceof Error && err.message === 'view:403';
        setState({
          access: denied ? 'denied' : 'allowed',
          rows: [],
          loading: false,
          error: denied ? null : 'خواندن اطلاعات این نما از سرور ناموفق بود.',
        });
      });

    return () => { cancelled = true; };
  }, [view, enabled, identity, revision]);

  return state;
}
