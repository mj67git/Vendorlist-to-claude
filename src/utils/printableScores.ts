import type { Vendor } from '../types';

/**
 * What the printed evaluation form is allowed to say about a score.
 *
 * The form used to print `5` — full marks — for any criterion with nothing
 * recorded against it: a source nobody had evaluated came out of the printer
 * with a perfect scorecard, and the "امتیاز کسب شده" column was computed from
 * those fives. On a document that goes into a regulatory file, a number nobody
 * entered is worse than a blank.
 *
 * Two rules, and both are about not inventing evidence:
 *   - a criterion prints only a score somebody actually recorded for it;
 *   - a department total is never spread back over its criteria. A department
 *     scored 80/100 does not mean each criterion scored 4 of 5, and printing
 *     that estimate in the criterion column makes a guess look like data.
 */

/** The raw per-criterion scores, whether they arrive as an object or as JSON text. */
function readRawScores(vendor: Vendor | null | undefined): Record<string, Record<string, unknown>> | null {
  if (!vendor) return null;
  let raw: unknown = (vendor as any).rawScores;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, Record<string, unknown>>) : null;
}

/**
 * The score recorded for one criterion, or `null` when none was.
 *
 * `null` is a real answer here and the caller prints it as a dash; it is not a
 * missing value to be filled in with a default.
 */
export function criterionScore(
  vendor: Vendor | null | undefined,
  deptId: string,
  critKey: string,
): number | null {
  const raw = readRawScores(vendor);
  const value = raw?.[deptId]?.[critKey];
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The department's own total, or `null` when the department has not scored. */
export function departmentTotal(vendor: Vendor | null | undefined, deptId: string): number | null {
  const value = vendor?.scores ? (vendor.scores as any)[deptId] : null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type DepartmentState = 'detailed' | 'total-only' | 'unscored';

/**
 * How much this department actually recorded, which decides what the form may
 * print for it.
 */
export function departmentState(vendor: Vendor | null | undefined, deptId: string): DepartmentState {
  const raw = readRawScores(vendor)?.[deptId];
  const hasAnyCriterion = !!raw && Object.values(raw).some(v => v !== undefined && v !== null && v !== '');
  if (hasAnyCriterion) return 'detailed';
  return departmentTotal(vendor, deptId) === null ? 'unscored' : 'total-only';
}

/** The line printed under a department's name when its record is incomplete. */
export function departmentNote(vendor: Vendor | null | undefined, deptId: string): string | null {
  switch (departmentState(vendor, deptId)) {
    case 'unscored': return 'ارزیابی این واحد ثبت نشده است';
    case 'total-only': return 'تفکیک معیارها ثبت نشده؛ فقط امتیاز کل این واحد ثبت شده است';
    default: return null;
  }
}

/** What goes in the criterion's score cell: the recorded figure, or a dash. */
export function criterionCell(vendor: Vendor | null | undefined, deptId: string, critKey: string): string {
  const score = criterionScore(vendor, deptId, critKey);
  return score === null ? '—' : String(score);
}

/**
 * What goes in the criterion's weighted cell.
 *
 * Blank whenever the criterion itself is blank: a weighted score computed from
 * a score nobody gave is the same fabrication one column to the left.
 */
export function earnedCell(
  vendor: Vendor | null | undefined,
  deptId: string,
  critKey: string,
  weight: number,
): string {
  const score = criterionScore(vendor, deptId, critKey);
  return score === null ? '—' : String(Math.round((score / 5) * weight));
}
