import React, { useEffect, useId } from 'react';
import { cn } from './utils';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: 'right' | 'left';
  className?: string;
}

export function Drawer({ isOpen, onClose, title, children, footer, side = 'right', className }: DrawerProps) {
  const titleId = useId();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 fade-in" 
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Drawer Content */}
      <div 
        className={cn(
          'relative z-50 flex h-full w-full max-w-md flex-col bg-[var(--color-surface)] shadow-2xl slide-in-drawer',
          side === 'right' ? 'ml-auto border-l border-[var(--color-border)]' : 'mr-auto border-r border-[var(--color-border)]',
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
          <h2 id={titleId} className="text-lg font-semibold text-[var(--color-foreground)]">{title}</h2>
          <button
            type="button"
            aria-label="بستن پنل"
            onClick={onClose}
            className="rounded-full p-2 hover:bg-[var(--color-secondary)] transition-colors text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
        
        {footer && (
          <div className="p-6 border-t border-[var(--color-border)] bg-[var(--color-secondary)]/30">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
