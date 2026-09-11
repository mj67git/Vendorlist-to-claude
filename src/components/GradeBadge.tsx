import React from 'react';
import { Grade, Status, Scores } from '../types';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

interface GradeBadgeProps {
  grade: Grade;
  status: Status;
  scores?: Scores | null;
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
 * Only `A`, `B` and `C` are grades. Everything else means "no grade yet", and
 * that includes the literal `'new'` that `applyDerivedState` writes when it
 * clears a stale rejected grade — which the old `else` branch read as Grade C
 * and printed as a scored verdict for a source nobody had scored.
 */
export function describeVendorGrade(
  grade: Grade,
  status: Status,
  scores?: Scores | null,
): VendorGradeVerdict {
  const isFullyScored = !!scores && scores.commercial > 0 && scores.qa > 0 && scores.planning > 0 && scores.finance > 0;
  const hasSomeScores = !!scores && (scores.commercial > 0 || scores.qa > 0 || scores.planning > 0 || scores.finance > 0);

  if (status === 'rejected' || grade === 'rejected' || grade === 'black list') {
    return { label: 'لیست سیاه', variant: 'gradeReject', dotColor: 'bg-rose-500' };
  }
  if (grade === 'A') return { label: 'گرید A', variant: 'gradeA', dotColor: 'bg-emerald-500' };
  if (grade === 'B') return { label: 'گرید B', variant: 'gradeB', dotColor: 'bg-blue-500' };
  if (grade === 'C') return { label: 'گرید C', variant: 'gradeC', dotColor: 'bg-amber-500' };

  // No grade. Part-way through the departmental scoring is worth saying, since
  // it is the difference between "nobody has started" and "three of four are in".
  if (hasSomeScores && !isFullyScored) {
    return { label: 'در حال ارزیابی', variant: 'stage', dotColor: null };
  }
  return { label: 'ارزیابی‌نشده', variant: 'stage', dotColor: null };
}

export function GradeBadge({ grade, status, scores, className }: GradeBadgeProps) {
  const { label, variant, dotColor } = describeVendorGrade(grade, status, scores);

  return (
    <Badge variant={variant} className={cn("gap-1.5 py-1 px-3 text-2xs font-bold tracking-normal shadow-xs", className)}>
      {dotColor && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />}
      <span>{label}</span>
    </Badge>
  );
}
