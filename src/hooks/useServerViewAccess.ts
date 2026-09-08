import { useEffect, useState } from 'react';
import { authFetch } from '../services/authFetch';

/**
 * Ask the server whether this account may open a read-only view.
 *
 * The archive and the supplier directory read the same rows as every other
 * source page, so their permissions cannot be a row filter — what they gate is
 * the view itself. Without this the tick in the permission form would be
 * decided entirely in the browser, where `currentUser` comes from localStorage
 * and can be edited; rule 14 says the server decides and the screen only
 * arranges. So the view asks, on entry, and the answer is the server's.
 *
 * One row is requested rather than the list: the page renders from the shared
 * store either way, and this call exists for its status code.
 */
export type ViewAccess = 'checking' | 'allowed' | 'denied';

export function useServerViewAccess(view: string | null, enabled = true): ViewAccess {
  const [state, setState] = useState<ViewAccess>('checking');

  useEffect(() => {
    if (!view || !enabled) { setState('allowed'); return; }
    let cancelled = false;
    setState('checking');
    authFetch(`/api/vendors?view=${encodeURIComponent(view)}&page=1&limit=1`)
      .then(res => {
        if (cancelled) return;
        // Only a refusal closes the view. A network failure or a server error
        // must not read as "you are not allowed" — the page would accuse the
        // administrator of a restriction nobody made, and the data is already
        // on screen from the shared store.
        setState(res.status === 403 ? 'denied' : 'allowed');
      })
      .catch(() => { if (!cancelled) setState('allowed'); });
    return () => { cancelled = true; };
  }, [view, enabled]);

  return state;
}
