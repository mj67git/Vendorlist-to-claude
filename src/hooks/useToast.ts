import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The one-line report of what just happened.
 *
 * This lived in `App` as three pieces of state, a timer ref and a function —
 * and, in sixteen other places, as a bare `setToastMsg` followed by a
 * `setTimeout`. Those sixteen cleared no timer and set no kind, so a failed
 * save could be announced in the styling of the last success, and a second
 * message could cut the first one short. One way in fixes both.
 */

export type ToastKind = 'success' | 'error';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  message: string;
  kind: ToastKind;
  action: ToastAction | null;
}

/**
 * How long a toast that carries a button must stay.
 *
 * Long enough to be read and pressed: a three-second offer is one the user
 * watches disappear.
 */
const ACTION_MIN_LIFE = 7000;

export interface UseToast {
  toast: Toast | null;
  /**
   * Show a message. `kind` is stated by the caller rather than guessed from
   * the words — the screen used to infer it with a keyword regex, and
   * «عدم دسترسی…» matched none of them, so a refusal came up with a green
   * check.
   */
  notify: (message: string, kind?: ToastKind, ms?: number, action?: ToastAction | null) => void;
  /** Take it off the screen now, cancelling its timer. */
  dismiss: () => void;
}

export function useToast(): UseToast {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const notify = useCallback<UseToast['notify']>(
    (message, kind = 'success', ms = kind === 'error' ? 6000 : 3000, action = null) => {
      // The previous timer goes first, so a second toast cannot dismiss the
      // one that replaced it.
      clearTimer();
      setToast({ message, kind, action: action ?? null });
      const life = action ? Math.max(ms, ACTION_MIN_LIFE) : ms;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setToast(null);
      }, life);
    },
    [clearTimer],
  );

  // A timer outliving the tree that owns it would call `setToast` on nothing.
  useEffect(() => clearTimer, [clearTimer]);

  return { toast, notify, dismiss };
}
