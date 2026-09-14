/**
 * The words a source's qualification and grade are allowed to be.
 *
 * These two columns were deliberately left as free strings so that roughly
 * thirty endpoints would not have to change at once (rule 6), and they stay
 * free strings in PostgreSQL. What was missing is a written-down vocabulary:
 * with nobody stating the permitted values, four spellings of one idea grew up
 * in four files — `applyDerivedState` wrote `grade: 'rejected'`, the server's
 * tier table said `'black list'`, the seller rubric in `sopEvaluation.ts` says
 * `'Blacklist'`, and clearing a stale grade wrote the literal `'new'` into a
 * column whose other values are A, B and C.
 *
 * Two of those are category errors rather than spelling differences:
 *
 *   - **A grade is not a verdict.** `A`, `B`, `C` and `D` are bands of a
 *     weighted score. «Blacklisted» is not a band — it is the answer to a
 *     different question, and `isVendorRejected` is the only thing entitled to
 *     answer it (rule 11). Writing the verdict into the grade column is what
 *     built the one-way latch that rule exists because of: the grade was read
 *     back as evidence of the verdict that had written it.
 *   - **`'new'` is not a grade.** It is the absence of one, and the absence of
 *     a grade is spelled `null`. Written as a string it sorted, filtered and
 *     printed as though somebody had assessed the source.
 *
 * So: the grade says what the departments scored, `status` says where the
 * source stands, and neither is consulted to decide whether a source is
 * rejected. Retired spellings keep being understood on the way in — the same
 * arrangement `LEGACY_PERMISSIONS` has — and are never written again.
 */

/** Where a source stands. The output of the derivation, never an input to it. */
export type SourceQualification = 'new' | 'approved' | 'conditional' | 'rejected';

/** The band a source's weighted score falls in. `null` means unscored. */
export type SourceGrade = 'A' | 'B' | 'C' | 'D';

export const SOURCE_QUALIFICATIONS: readonly SourceQualification[] =
  ['new', 'approved', 'conditional', 'rejected'] as const;

export const SOURCE_GRADES: readonly SourceGrade[] = ['A', 'B', 'C', 'D'] as const;

/**
 * Spellings that were once written into the grade column and are still read.
 *
 * `'rejected'` and `'black list'` both meant «this source is disqualified», and
 * a disqualified source that had been scored was, by the numbers, a D. Mapping
 * them to `D` keeps the one fact the value actually carried — the score was
 * failing — and drops the verdict, which is derived now and belongs to
 * `isVendorRejected`. A row disqualified by a *decision* rather than by its
 * score keeps that decision in `rejectedByDecision`, so nothing is lost.
 *
 * `'new'`, `'unrated'` and `'Not Evaluated'` all meant «no grade», which is
 * `null`.
 */
const RETIRED_GRADES: Record<string, SourceGrade | null> = {
  'rejected': 'D',
  'black list': 'D',
  'blacklist': 'D',
  'new': null,
  'unrated': null,
  'not evaluated': null,
  '': null,
};

/**
 * Read a grade as one of the permitted values, or `null` for «no grade».
 *
 * Applied on the way in rather than trusted, because the column holds whatever
 * every version of this application ever wrote into it.
 */
export function normalizeSourceGrade(value: unknown): SourceGrade | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  const upper = raw.toUpperCase();
  if (upper === 'A' || upper === 'B' || upper === 'C' || upper === 'D') return upper as SourceGrade;
  const retired = RETIRED_GRADES[raw.toLowerCase()];
  return retired ?? null;
}

/** True when the stored grade is one of the four bands. */
export function isSourceGrade(value: unknown): value is SourceGrade {
  return typeof value === 'string' && (SOURCE_GRADES as readonly string[]).includes(value);
}

/**
 * Read a qualification as one of the permitted values.
 *
 * Anything unrecognised reads as `'new'` — the state a source is in before
 * anybody has said otherwise — rather than being passed through. An unknown
 * word in this column cannot be acted on by any screen, so keeping it only
 * preserves the appearance of information.
 */
export function normalizeSourceQualification(value: unknown): SourceQualification {
  const raw = String(value ?? '').trim().toLowerCase();
  if ((SOURCE_QUALIFICATIONS as readonly string[]).includes(raw)) return raw as SourceQualification;
  // The spellings the seller rubric and older imports used for the same states.
  if (raw === 'blacklisted' || raw === 'black list' || raw === 'blacklist') return 'rejected';
  if (raw === 'active' || raw === 'approved supplier') return 'approved';
  return 'new';
}
