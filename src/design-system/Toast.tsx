import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { cn } from './utils';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (message: Omit<ToastMessage, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((message: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...message, id }]);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "toast-enter flex items-start justify-between p-4 rounded-[var(--radius)] border shadow-lg bg-[var(--color-surface)]",
              t.type === 'success' ? 'border-[var(--color-success)]' :
              t.type === 'warning' ? 'border-[var(--color-warning)]' :
              t.type === 'error' ? 'border-[var(--color-danger)]' :
              'border-[var(--color-info)]'
            )}
            role="alert"
          >
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-[var(--color-foreground)]">{t.title}</h4>
              {t.description && <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{t.description}</p>}
            </div>
            <button
              type="button"
              aria-label="بستن اعلان"
              onClick={() => removeToast(t.id)} 
              className="ml-4 shrink-0 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
