import React, { useEffect, useId } from 'react';
import { cn } from './utils';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Dialog({ isOpen, onClose, title, description, children, footer, className }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm fade-in" 
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Dialog Content */}
      <div 
        className={cn(
          'relative z-50 w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg dialog-enter flex flex-col',
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="p-6 border-b border-[var(--color-border)]">
          <h2 id={titleId} className="text-lg font-semibold text-[var(--color-foreground)]">{title}</h2>
          {description && <p id={descriptionId} className="mt-1 text-sm text-[var(--color-muted-foreground)]">{description}</p>}
        </div>
        
        <div className="p-6">
          {children}
        </div>
        
        {footer && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-[var(--color-border)] bg-[var(--color-secondary)]/30 rounded-b-[var(--radius-lg)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
