import React from 'react';
import { Grade, Scores } from '../types';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { isVendorRejected } from '../utils/vendorState';

interface GradeBadgeProps {
  /** The record itself, so the verdict is asked of `isVendorRejected`. */
  vendor: any;
  /**
   * A grade to show instead of the stored one — the archive shows the rank it
   * recomputes from the scores. The verdict is unaffected either way.
   */
  grade?: Grade;
  className?: string;
}

export type GradeBadgeTone = 'gradeA' | 'gradeB' | 'gradeC' | 'gradeReject' | 'stage';

export interface VendorGradeVerdict {
  label: string;
  variant: GradeBadgeTone;
  /** Null for a process step, which carries no colour of its own. */
  dotColor: string | null;
}

/**
 * What a source's badge should say, as a pure function so it can be held to it.
 *
 * Only `A`, `B`, `C` and `D` are grades. Everything else means «no grade yet».
 *
 * The verdict is `isVendorRejected`, not a comparison written here (rule 11).
 * It used to be `status === 'rejected' || grade === 'rejected' || grade ===
 * 'black list'`, which is the hand-written pair that rule exists to forbid, and
 * it could disagree with the registers: a row carrying a rejected `status` with
 * no decision behind it — an import, a script, a fixture written straight into
 * the table — printed «لیست سیاه» on the badge while the blacklist page, asking
 * the predicate, showed no such source. The retired grade spellings are still
 * understood, but through `normalizeSourceGrade` on the way in, not here.
 */
export function describeVendorGrade(vendor: any, gradeOverride?: Grade): VendorGradeVerdict {
  const grade = gradeOverride !== undefined ? gradeOverride : (vendor?.grade as Grade);
  const scores = (vendor?.scores ?? null) as Scores | null;
  const isFullyScored = !!scores && scores.commercial > 0 && scores.qa > 0 && scores.planning > 0 && scores.finance > 0;
  const hasSomeScores = !!scores && (scores.commercial > 0 || scores.qa > 0 || scores.planning > 0 || scores.finance > 0);

  if (isVendorRejected(vendor)) {
    return { label: 'لیست سیاه', variant: 'gradeReject', dotColor: 'bg-rose-500' };
  }
  if (grade === 'A') return { label: 'گرید A', variant: 'gradeA', dotColor: 'bg-emerald-500' };
  if (grade === 'B') return { label: 'گرید B', variant: 'gradeB', dotColor: 'bg-blue-500' };
  if (grade === 'C') return { label: 'گرید C', variant: 'gradeC', dotColor: 'bg-amber-500' };
  // D is the failing band of the source scale (`vendorRank.ts`), and it is a
  // grade like the other three — the verdict that usually accompanies it is
  // said by `status` above, not here. Before the grade column stopped carrying
  // the verdict this branch was unreachable, and a stored D fell through to
  // «ارزیابی‌نشده»: a scored source reported as unassessed.
  if (grade === 'D') return { label: 'گرید D', variant: 'gradeReject', dotColor: 'bg-rose-500' };

  // No grade. Part-way through the departmental scoring is worth saying, since
  // it is the difference between "nobody has started" and "three of four are in".
  if (hasSomeScores && !isFullyScored) {
    return { label: 'در حال ارزیابی', variant: 'stage', dotColor: null };
  }
  return { label: 'ارزیابی‌نشده', variant: 'stage', dotColor: null };
}

export function GradeBadge({ vendor, grade, className }: GradeBadgeProps) {
  const { label, variant, dotColor } = describeVendorGrade(vendor, grade);

  return (
    <Badge variant={variant} className={cn("gap-1.5 py-1 px-3 text-2xs font-bold tracking-normal shadow-xs", className)}>
      {dotColor && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />}
      <span>{label}</span>
    </Badge>
  );
}
