import React from 'react';
import { cn } from './utils';

export type BadgeVariant = 'success' | 'warning' | 'critical' | 'info' | 'neutral';

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  const baseClasses = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none';
  
  const variants = {
    success: 'bg-[var(--color-success)] text-[var(--color-success-foreground)]',
    warning: 'bg-[var(--color-warning)] text-[var(--color-warning-foreground)]',
    critical: 'bg-[var(--color-danger)] text-[var(--color-danger-foreground)]',
    info: 'bg-[var(--color-info)] text-[var(--color-info-foreground)]',
    neutral: 'bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)] border border-[var(--color-border)]',
  };

  return (
    <div className={cn(baseClasses, variants[variant], className)} {...props} />
  );
}
