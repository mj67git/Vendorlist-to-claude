import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

/**
 * The single overlay shell for every dialog in the app.
 *
 * Forms used to each carry their own copy of the backdrop, the panel classes
 * and the open animation — five different entrance mechanisms and nine panel
 * widths had drifted apart, none of them closed on Escape, and none had a
 * closing animation at all (they were conditionally rendered, so they simply
 * vanished). This owns all of that once:
 *
 *   - portal, backdrop, click-outside and Escape to close
 *   - symmetric enter/exit animation (the caller renders it unconditionally,
 *     `open` drives AnimatePresence, so closing is animated too)
 *   - background scroll lock, focus move-in and focus restore on close
 *   - three panel sizes instead of ad-hoc max-widths
 *
 * The caller keeps its own header/body/footer markup as children, so adopting
 * this is a matter of deleting boilerplate rather than rewriting a form.
 */

export type FormModalSize = 'sm' | 'md' | 'lg';

/**
 * Width plus height behaviour. Only the record-sized panel stretches to fill a
 * phone screen; a short confirmation staying `h-auto` there is the point.
 */
const SIZE_CLASS: Record<FormModalSize, string> = {
  sm: 'max-w-md max-h-[92vh]',                    // confirmations, single-question dialogs
  md: 'max-w-2xl max-h-[92vh]',                   // focused, single-purpose forms
  lg: 'max-w-4xl max-h-[92vh] h-full sm:h-auto',  // full record forms (material, business partner)
};

interface FormModalProps {
  open: boolean;
  onClose: () => void;
  size?: FormModalSize;
  /** Set false to require an explicit button press (destructive confirmations). */
  closeOnBackdrop?: boolean;
  /** 'alertdialog' for a confirmation that interrupts a destructive path. */
  role?: 'dialog' | 'alertdialog';
  /** id of the element naming this dialog, for screen readers. */
  labelledBy?: string;
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
}

export function FormModal({
  open,
  onClose,
  size = 'lg',
  closeOnBackdrop = true,
  role = 'dialog',
  labelledBy,
  ariaLabel,
  className = '',
  children,
}: FormModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();

  // Escape closes, and Tab is kept inside the panel while it is open.
  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    // Lock the page behind the overlay.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus in without stealing it from an element the panel autofocuses.
    const t = window.setTimeout(() => {
      if (panelRef.current && !panelRef.current.contains(document.activeElement)) {
        panelRef.current.focus();
      }
    }, 40);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  // Hold on to the last rendered children so the panel still has content while
  // it animates out — callers usually clear the record being shown in the same
  // tick they close, which would otherwise flash an empty panel.
  const lastChildren = useRef<React.ReactNode>(null);
  if (open) lastChildren.current = children;
  const body = open ? children : lastChildren.current;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 md:p-6 overflow-hidden" dir="rtl">
          <motion.div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: 'easeOut' }}
            onClick={closeOnBackdrop ? onClose : undefined}
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            role={role}
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-label={labelledBy ? undefined : ariaLabel}
            tabIndex={-1}
            className={`relative z-10 w-full ${SIZE_CLASS[size]} bg-card rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden text-right focus:outline-none ${className}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.965 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: reduce ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            {body}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
