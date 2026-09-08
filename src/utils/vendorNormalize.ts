// How a source record is admitted and cleaned on the way in.
//
// Both of these used to live in `App.tsx`, one of them inside the component.
// They moved out when the archive and the supplier directory started loading
// their own rows through a permission-checked route: two loaders reading the
// register have to clean it the same way, or the same source would be rejected
// on one page and rated on another.

import { applyDerivedState, isVendorRejected } from './vendorState';
import type { Vendor } from '../types';

/**
 * Sources the application will show at all.
 *
 * A batch of demo records with ids above vF128 was imported once and never
 * belonged to the real register. Defined once here because several call sites
 * need it — the seed load, the initial fetch, the re-read after a refused write,
 * and the archive's own gated load — and copies of a filter are chances to let
 * one drift.
 */
export const isAllowedVendor = (v: any) => {
  if (!v || !v.id) return false;
  if (typeof v.id === 'string' && v.id.startsWith('vF')) {
    const numPart = parseInt(v.id.substring(2), 10);
    if (!isNaN(numPart) && numPart > 128) return false;
  }
  return true;
};

export function normalizeAndCleanVendor(v: any): Vendor {
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
}
