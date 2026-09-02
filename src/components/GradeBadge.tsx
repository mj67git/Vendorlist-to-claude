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

export function GradeBadge({ grade, status, scores, className }: GradeBadgeProps) {
  let variant: 'gradeA' | 'gradeB' | 'gradeC' | 'gradeReject' | 'warning' | 'info' = 'info';
  let label = 'جدید';
  let dotColor = 'bg-blue-500';

  const isFullyScored = scores && scores.commercial > 0 && scores.qa > 0 && scores.planning > 0 && scores.finance > 0;
  const hasSomeScores = scores && (scores.commercial > 0 || scores.qa > 0 || scores.planning > 0 || scores.finance > 0);

  if (status === 'rejected' || grade === 'rejected' || grade === 'black list') {
    variant = 'gradeReject';
    label = 'لیست سیاه';
    dotColor = 'bg-rose-500';
  } else if (status === 'new' || grade === null) {
    if (hasSomeScores && !isFullyScored) {
      variant = 'warning';
      label = 'در حال ارزیابی';
      dotColor = 'bg-amber-500';
    } else {
      variant = 'info';
      label = 'جدید';
      dotColor = 'bg-blue-500';
    }
  } else {
    // Has a grade
    if (grade === 'A') {
      variant = 'gradeA';
      label = 'Grade A';
      dotColor = 'bg-emerald-500';
    } else if (grade === 'B') {
      variant = 'gradeB';
      label = 'Grade B';
      dotColor = 'bg-blue-500';
    } else {
      variant = 'gradeC';
      label = 'Grade C';
      dotColor = 'bg-amber-500';
    }
  }

  return (
    <Badge variant={variant} className={cn("gap-1.5 py-1 px-3 text-2xs font-bold tracking-normal shadow-xs", className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 animate-pulse", dotColor)} />
      <span>{label}</span>
    </Badge>
  );
}
