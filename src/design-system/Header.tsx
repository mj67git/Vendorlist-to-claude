import React from 'react';
import { cn } from './utils';

export function HeaderContainer({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <header
      className={cn(
        'h-16 flex items-center justify-between px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)]',
        className
      )}
      {...props}
    >
      {children}
    </header>
  );
}

export function HeaderTitle({ className, title, context, ...props }: React.HTMLAttributes<HTMLDivElement> & { title: React.ReactNode, context?: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col', className)} {...props}>
      {context && <span className="text-xs text-[var(--color-muted-foreground)] uppercase tracking-wider">{context}</span>}
      <h1 className="text-lg font-semibold text-[var(--color-foreground)]">{title}</h1>
    </div>
  );
}

export function HeaderActions({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center gap-4', className)} {...props}>
      {children}
    </div>
  );
}
