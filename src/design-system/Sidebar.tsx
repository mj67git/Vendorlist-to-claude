import React from 'react';
import { cn } from './utils';

export function SidebarContainer({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <aside
      className={cn(
        'flex flex-col h-screen w-64 border-l border-[var(--color-border)] bg-[var(--color-surface)] transition-all duration-300',
        className
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

export function SidebarHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('h-16 flex items-center px-4 border-b border-[var(--color-border)]', className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex-1 overflow-y-auto py-4', className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarItem({ 
  className, 
  active, 
  icon, 
  children, 
  ...props 
}: React.HTMLAttributes<HTMLButtonElement> & { active?: boolean; icon?: React.ReactNode }) {
  return (
    <button
      className={cn(
        'w-full flex items-center px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)]',
        active ? 'bg-[var(--color-secondary)] text-[var(--color-primary)] border-r-4 border-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)] border-r-4 border-transparent',
        className
      )}
      {...props}
    >
      {icon && <span className="ml-3 shrink-0">{icon}</span>}
      <span className="truncate">{children}</span>
    </button>
  );
}

export function SidebarFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-4 border-t border-[var(--color-border)]', className)} {...props}>
      {children}
    </div>
  );
}
