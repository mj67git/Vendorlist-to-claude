// Single source of truth for "is this vendor rejected / blacklisted", and for
// the grade that follows from it.
//
// Rejection used to be *stored* in two places (`status` and `grade`) and written
// one way only: a failing QC result stamped both, but deleting that result
// restored `status` and left `grade === 'rejected'` behind. Every counter reads
// `grade === 'rejected' || status === 'rejected'`, so the source stayed in the
// blacklist and in the dashboard donut forever. Worse, for non-sample sources
// the stale grade forced `status` back to 'rejected' on the next save.
//
// Here rejection is *derived* from the underlying facts instead, and grade is an
// output of that derivation — never an input. A cause that disappears (a lab
// result deleted, an admin restore) therefore clears everywhere at once.

import { calculateOverallScore } from './vendorUtils';

type AnyVendor = any;

export function isSampleVendor(v: AnyVendor): boolean {
  return !!v?.isSample || v?.category === 'sample';
}

/** A single failing QC result is what blacklists a sample. */
export function hasQcReject(v: AnyVendor): boolean {
  return (v?.analysisRecords || []).some((r: any) => r?.decision === 'Reject');
}

/** Reasons written by a QC result are a projection of that result, not an
 *  independent fact — they must not outlive the record they came from. */
const QC_REASON_PREFIX = 'مردود در آزمون QC';

/**
 * The opening words of the line an explicit «رد سورس» decision writes into
 * `rejectionReasons`. It was a bare literal in the reject handler, matched by
 * `startsWith` to replace an earlier decision; the decision box then had no way
 * to find that same line back and so could only say the source *is* blacklisted,
 * never why. One constant, two readers.
 */
export const ADMIN_REJECT_PREFIX = 'رد توسط';

/**
 * The recorded human decision that blacklisted this source, or null.
 *
 * There is at most one: the handler replaces any earlier decision line rather
 * than appending, so a restore-then-reject cycle leaves the current reason and
 * not a stack of superseded ones.
 */
export function adminRejectionReason(v: AnyVendor): string | null {
  if (!Array.isArray(v?.rejectionReasons)) return null;
  const line = v.rejectionReasons.find(
    (r: any) => typeof r === 'string' && r.startsWith(ADMIN_REJECT_PREFIX),
  );
  return typeof line === 'string' && line.trim() ? line.trim() : null;
}

function manualReasons(v: AnyVendor): string[] {
  if (!Array.isArray(v?.rejectionReasons)) return [];
  return v.rejectionReasons.filter((r: any) => typeof r === 'string' && !r.startsWith(QC_REASON_PREFIX));
}

function hasManualRejection(v: AnyVendor): boolean {
  return manualReasons(v).length > 0;
}

/**
 * The one predicate every counter, filter and badge must use.
 * Deliberately does NOT consider `grade`: grade is derived from this, so reading
 * it back here is what created the one-way latch.
 */
export function isVendorRejected(v: AnyVendor): boolean {
  if (!v) return false;
  if (isSampleVendor(v)) {
    // A sample is no longer blacklisted by a lab result on its own.
    //
    // It used to be: one Reject record stamped the sample rejected with nobody
    // deciding it. A laboratory record is evidence — it says what the analysis
    // found, not what the organisation concluded — and in a GxP setting the
    // conclusion is supposed to carry a name, a date and a reason. The quality
    // decision box does that now, exactly as it already did for sources.
    //
    // `status === 'rejected'` stays in the test so that samples rejected under
    // the old automatic rule keep the verdict they were given; nothing is
    // silently un-rejected by this change.
    return hasManualRejection(v) || v.status === 'rejected';
  }
  // A source is never auto-rejected by a single lab failure — only by an
  // explicit decision (the admin reject box, or the vendor form).
  return v.category === 'blacklist' || hasManualRejection(v) || v.status === 'rejected';
}

/**
 * Recompute `status` and `grade` from the facts. Idempotent: applying it twice
 * yields the same result, so it is safe to run on every load and every save.
 */
export function applyDerivedState<T extends Record<string, any>>(v: T): T {
  if (!v) return v;

  if (isVendorRejected(v)) {
    return { ...v, status: 'rejected', grade: 'rejected' };
  }

  // Not rejected: clear any stale rejection stamp left by a cause that is gone.
  //
  // Only `grade` can be stale now. A rejected `status` *is* the verdict — for a
  // sample as much as for a source — so this branch is only reached when the
  // status already says something else, and there is no status to restore. The
  // helper that used to guess one back from `initialSampleStatus` is gone with
  // the dropdown that wrote that field.
  const next: AnyVendor = { ...v };
  if (next.grade === 'rejected') next.grade = 'new';

  if (isSampleVendor(next)) return next as T;

  // Sources carry a scored grade; keep the existing scoring rules.
  const s = next.scores;
  const fullyScored = s && s.commercial > 0 && s.qa > 0 && s.planning > 0 && s.finance > 0;
  if (!fullyScored) return next as T;

  const rounded = calculateOverallScore(s, true) || 0;
  if (rounded >= 80) { next.grade = 'A'; next.status = 'approved'; }
  else if (rounded >= 60) { next.grade = 'B'; next.status = 'approved'; }
  else if (rounded >= 40) { next.grade = 'C'; next.status = 'conditional'; }
  else { next.grade = 'rejected'; next.status = 'rejected'; }
  return next as T;
}

/** Blacklist membership for the category view (samples live in their own list). */
export function isInBlacklistCategory(v: AnyVendor): boolean {
  return !isSampleVendor(v) && isVendorRejected(v);
}

/**
 * The opening words of the activity-log line a sample's quality decision writes.
 *
 * A sample's verdict lives in `status`, which says *what* was decided but not
 * why or by whom. The reason is written into the source's own activity log with
 * this prefix so the decision box can read the current decision back — the same
 * arrangement `ADMIN_REJECT_PREFIX` gives a source's rejection.
 */
export const SAMPLE_DECISION_PREFIX = 'تصمیم کیفی نمونه';

/** The most recent recorded sample verdict, or null. */
export function sampleDecisionLog(v: AnyVendor): { action: string; date?: string; user?: string } | null {
  const logs = Array.isArray(v?.activityLogs) ? v.activityLogs : [];
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entry = logs[i];
    if (entry && typeof entry.action === 'string' && entry.action.startsWith(SAMPLE_DECISION_PREFIX)) return entry;
  }
  return null;
}

/**
 * The opening words of the activity-log line a departmental scoring writes.
 *
 * A source whose weighted score falls below 40 is blacklisted by the derivation
 * itself — no reason is written into `rejectionReasons`, because nobody typed
 * one. The scoring form does log who saved it and when, so the banner can name
 * a person and a date instead of standing there with an empty list.
 */
export const SCORE_EVALUATION_PREFIX = 'ثبت ارزیابی نهایی سورس';

/** The most recent scoring entry in a source's own history, or null. */
export function latestScoreEvaluationLog(v: AnyVendor): { action: string; date?: string; user?: string } | null {
  const logs = Array.isArray(v?.activityLogs) ? v.activityLogs : [];
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entry = logs[i];
    if (entry && typeof entry.action === 'string' && entry.action.startsWith(SCORE_EVALUATION_PREFIX)) return entry;
  }
  return null;
}
