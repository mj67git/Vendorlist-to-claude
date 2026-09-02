import type { Vendor } from '../types';
import { calculateOverallScore } from './vendorUtils';

/**
 * The one rank scale for a *source*.
 *
 * There are two unrelated grade scales in this application and they were being
 * mixed up. `sopEvaluation.ts` grades a **supplier's SOP documents** on
 * 80/60/40/30 → A, B, C, Pending Review, Blacklist (rule 13). A **source** is
 * graded on a different scale entirely — A 80-100, B 60-79, C 40-59, D 0-39 —
 * and the Excel export had quietly copied the SOP boundaries, so a source
 * scoring 35 printed as "Grade D" on the signed form and as "Blacklist" in the
 * spreadsheet exported from the same screen on the same day.
 *
 * Everything that puts a source's rank in front of a person reads it from here.
 */
export type SourceGrade = 'A' | 'B' | 'C' | 'D';

/** What every surface says when nobody has evaluated the source yet. */
export const UNEVALUATED_LABEL = 'ارزیابی نشده';

const GRADE_RANGES: Record<SourceGrade, string> = {
  A: '80 - 100',
  B: '60 - 79',
  C: '40 - 59',
  D: '0 - 39',
};

export function gradeForScore(score: number): SourceGrade {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

export interface VendorRank {
  /** False when no department has scored this source and no grade was stored. */
  evaluated: boolean;
  /** The weighted total, or null when there is nothing to total. */
  score: number | null;
  grade: SourceGrade | null;
  /** «Grade B (72)» or «ارزیابی نشده» — what a reader should see. */
  label: string;
  /** The band the grade stands for, for the legend on the printed form. */
  range: string;
}

/**
 * The rank of one source.
 *
 * The score is derived, not read from the `grade` column: those two diverge in
 * the data (rule 13) and the column is an output, never an input to a decision
 * (rule 11). The stored grade is used only as a fallback for old records that
 * carry a grade but no department scores — dropping those to "not evaluated"
 * would erase a real assessment.
 */
export function describeVendorRank(vendor: Pick<Vendor, 'scores' | 'grade'> | null | undefined): VendorRank {
  const unevaluated: VendorRank = {
    evaluated: false,
    score: null,
    grade: null,
    label: UNEVALUATED_LABEL,
    range: UNEVALUATED_LABEL,
  };
  if (!vendor) return unevaluated;

  const s = vendor.scores;
  const anyScored = !!s && [s.commercial, s.qa, s.planning, s.finance].some(n => (n || 0) > 0);
  const score = anyScored ? calculateOverallScore(s ?? null, true) : null;

  if (score !== null) {
    const grade = gradeForScore(score);
    return { evaluated: true, score, grade, label: `Grade ${grade} (${score})`, range: GRADE_RANGES[grade] };
  }

  const stored = String(vendor.grade || '').toUpperCase();
  if (stored === 'A' || stored === 'B' || stored === 'C' || stored === 'D') {
    const grade = stored as SourceGrade;
    return { evaluated: true, score: null, grade, label: `Grade ${grade}`, range: GRADE_RANGES[grade] };
  }

  return unevaluated;
}
