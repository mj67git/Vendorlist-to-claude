import React from 'react';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { describeVendorRank, type SourceGrade } from '../utils/vendorRank';
import type { Vendor } from '../types';

const VARIANTS: Record<SourceGrade, 'gradeA' | 'gradeB' | 'gradeC' | 'gradeReject'> = {
  A: 'gradeA',
  B: 'gradeB',
  C: 'gradeC',
  D: 'gradeReject',
};

/**
 * The rank a source *earned*, for the places where `GradeBadge` cannot speak.
 *
 * `GradeBadge` reads the stored `grade` column, and for a blacklisted source
 * that column has been stamped `'rejected'` by `applyDerivedState` (rule 11).
 * On the blacklist page that makes every row say «لیست سیاه» — the name of the
 * page itself, which is why the column was hidden there and the reader was left
 * with a bare number.
 *
 * The rank is derived from the recorded department scores instead, through the
 * one source scale in `vendorRank.ts` (rule 13), so a rejected source can still
 * report the assessment it actually received before it was rejected.
 */
export function RankBadge({ vendor, className }: { vendor: Pick<Vendor, 'scores' | 'grade'> | null | undefined; className?: string }) {
  const rank = describeVendorRank(vendor);
  if (!rank.evaluated || !rank.grade) {
    return <span className={cn('text-2xs text-muted-foreground', className)}>{rank.label}</span>;
  }
  return (
    <Badge variant={VARIANTS[rank.grade]} className={cn('text-2xs font-bold px-2 py-0', className)}>
      {rank.label}
    </Badge>
  );
}
