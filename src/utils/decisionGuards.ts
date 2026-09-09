// Business decisions, separated from record maintenance.
//
// Some permissions guard a *decision* rather than an endpoint: disqualifying a
// source, ruling on a sample, grading a seller's documents, deactivating a
// partner. Each of those travels inside a payload that also carries ordinary
// edits — the profile endpoint replaces the whole record, the scores endpoint
// replaces the whole scores object — so an allow/deny check on the route cannot
// express them. The check has to compare what was sent against what is stored
// and refuse the fields the caller may not decide, which is exactly what
// `forbiddenScoreChanges` already does for department scores.
//
// Every function here returns the offending fields rather than a boolean, so
// the handler can name them in the refusal and in the audit record. An empty
// array means the payload contains no decision the caller is not entitled to
// make — including the common case of a payload that repeats the stored verdict
// unchanged, which every full-record save does.

import { can, type PermissionSubject, type Permission } from './permissions';
import { isVendorRejected, isSampleVendor } from './vendorState';

type AnyRecord = Record<string, any> | null | undefined;

/**
 * The columns a verdict is written in.
 *
 * Named here so the source-profile handler can tell a payload that only states
 * a verdict from one that also edits the record — the two need different
 * permissions and arrive through the same endpoint.
 */
export const VERDICT_FIELDS = ['status', 'grade', 'rejectionReasons', 'initialSampleStatus'] as const;

/** The refusal a handler needs: what was decided, and by which permission. */
export interface DecisionRefusal {
  permission: Permission;
  fields: string[];
}

/**
 * The stated grounds for a rejection, compared as a set.
 *
 * Order is not meaningful — the list is rebuilt from scratch on every verdict —
 * so a reordered but otherwise identical list must not read as a new decision.
 */
function reasonSet(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return [...new Set(value.map(r => String(r ?? '').trim()).filter(Boolean))].sort().join('|');
}

/**
 * The qualification verdict on a source or a sample.
 *
 * Deliberately not "any change to `status`". A source moving from «جدید» to
 * «تأییدشده» as its evaluation fills in is record maintenance and stays with
 * `vendor.edit`; what needs its own permission is the disqualification itself
 * and the restoration that undoes it, which is what the permission is named
 * for. So the comparison is made on the derived state (rule 11) plus the stated
 * grounds — the two things that decide whether the company may buy from this
 * source — rather than on the raw columns, which diverge.
 *
 * The sample and the source verdicts are different decisions held by different
 * people: quality rules on what quality tested, while ending a commercial
 * relationship is not the laboratory's call. Which one applies is read from the
 * *stored* record, so relabelling a source as a sample in the same payload
 * cannot buy the weaker permission.
 */
export function forbiddenVerdictChange(
  subject: PermissionSubject | string | undefined | null,
  current: AnyRecord,
  incoming: AnyRecord,
): DecisionRefusal | null {
  if (!current || !incoming) return null;
  const permission: Permission = isSampleVendor(current) ? 'sample.decide' : 'vendor.decide';
  if (can(subject, permission)) return null;

  const fields: string[] = [];
  // The incoming record is merged over the stored one before comparing, so a
  // partial payload — the contact endpoint, say — is judged on the verdict it
  // would actually leave behind rather than on the fields it happens to omit.
  const merged = { ...current, ...incoming };
  if (isVendorRejected(merged) !== isVendorRejected(current)) fields.push('status');
  if ('rejectionReasons' in incoming
    && reasonSet(incoming.rejectionReasons) !== reasonSet(current.rejectionReasons)) {
    fields.push('rejectionReasons');
  }
  return fields.length > 0 ? { permission, fields } : null;
}

/** The five SOP documents, compared by the fields an evaluation decides. */
function documentVerdicts(evaluation: AnyRecord): string {
  const docs = evaluation?.documents;
  if (!docs || typeof docs !== 'object') return '';
  return Object.keys(docs).sort()
    .map(key => `${key}:${docs[key]?.status ?? ''}:${docs[key]?.expiryDate ?? ''}`)
    .join('|');
}

/**
 * Grading a seller's documents, and switching a partner on or off.
 *
 * Both arrive through the one endpoint that replaces the whole partner record,
 * so commercial — which owns the record and collects the papers — could
 * otherwise set the grade that quality is supposed to award. And because only a
 * grade-A seller may be attached to a source (rule 13), that grade decides
 * whether the company can buy through this seller at all: it is a quality
 * decision wearing the clothes of a record edit.
 *
 * The grade itself is derived from the document statuses, so only those are
 * compared. A caller who may not evaluate cannot move them, and therefore
 * cannot move the grade either.
 */
export function forbiddenPartnerDecisions(
  subject: PermissionSubject | string | undefined | null,
  current: AnyRecord,
  incoming: AnyRecord,
): DecisionRefusal[] {
  if (!current || !incoming) return [];
  const refusals: DecisionRefusal[] = [];

  // Compared even when the payload omits the evaluation entirely, because the
  // repository deletes an evaluation the payload does not mention — so an
  // omission is not "no opinion", it is "remove the grade".
  if (documentVerdicts(incoming.evaluation) !== documentVerdicts(current.evaluation)
    && !can(subject, 'partner.evaluate')) {
    refusals.push({ permission: 'partner.evaluate', fields: ['evaluation.documents'] });
  }

  if ('status' in incoming
    && (incoming.status ?? null) !== (current.status ?? null)
    && !can(subject, 'partner.status')) {
    refusals.push({ permission: 'partner.status', fields: ['status'] });
  }

  return refusals;
}

/**
 * The source rows an account is allowed to see.
 *
 * Samples and the blacklist are categories of source, not separate tables, so
 * "may read the samples" can only be answered per row — and it has to be
 * answered on the server, or the list arrives complete and the category page
 * merely declines to draw it (rule 14).
 *
 * Both tests use the derived state rather than the stored columns, for the
 * reason in rule 11: `status` and `grade` diverge, and a row that is blacklisted
 * in every counter in the application must not be visible here because its
 * column says something else.
 */
export function readableVendors<T>(
  subject: PermissionSubject | string | undefined | null,
  rows: T[],
): T[] {
  const samples = can(subject, 'sample.read');
  const blacklist = can(subject, 'blacklist.read');
  if (samples && blacklist) return rows;
  return rows.filter(row => {
    if (!samples && isSampleVendor(row)) return false;
    // A rejected sample is filtered by whichever read is missing: it is both
    // a sample and a blacklisted record, and either permission alone is not
    // enough to be shown a row the other one covers.
    if (!blacklist && isVendorRejected(row)) return false;
    return true;
  });
}

/** True when every source row is readable, so no filtering pass is needed. */
export function readsEverySource(subject: PermissionSubject | string | undefined | null): boolean {
  return can(subject, 'sample.read') && can(subject, 'blacklist.read');
}

/**
 * The departments a payload would score on a record that is a sample.
 *
 * A sample is judged by a laboratory verdict, not by a weighted score of the
 * four departments: no view shows a sample a grade, `applyDerivedState` skips
 * the scoring rules for one, and the evaluation form is not offered on a sample
 * at all. The endpoint took the numbers anyway and stored them — data written
 * into the register that nothing ever reads back, and that a later reader could
 * easily mistake for an evaluation somebody performed.
 *
 * Zero is not a score, for the same reason it is not one in
 * `forbiddenScoreChanges`: the form fills the departments the user cannot edit
 * with zeros, and a payload that merely repeats stored zeros has decided
 * nothing. Only a department whose value actually moves is reported.
 */
export function forbiddenSampleScoring(
  current: AnyRecord,
  next: AnyRecord,
): string[] {
  if (!isSampleVendor(current)) return [];
  const before = (current?.scores || {}) as Record<string, unknown>;
  const after = (next?.scores || {}) as Record<string, unknown>;
  const offending = Object.keys(after).filter(department => {
    const from = Number(before[department]) || 0;
    const to = Number(after[department]) || 0;
    return from !== to;
  });

  // The per-question raw scores are the same decision one level down, so a
  // payload that skipped `scores` and sent only `rawScores` must not slip past.
  const rawBefore = (current?.rawScores || {}) as Record<string, unknown>;
  const rawAfter = (next?.rawScores || {}) as Record<string, unknown>;
  for (const department of Object.keys(rawAfter)) {
    if (offending.includes(department)) continue;
    if (JSON.stringify(rawAfter[department] ?? null) !== JSON.stringify(rawBefore[department] ?? null)) {
      offending.push(department);
    }
  }
  return offending;
}
