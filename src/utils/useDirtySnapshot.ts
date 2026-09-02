import { useEffect, useRef } from 'react';

/**
 * "Has this form been touched since it opened?", for the unsaved-changes
 * warning in `FormModal`.
 *
 * It compares the live form state against a snapshot taken when the dialog
 * opened, rather than treating an open form as dirty. That distinction is the
 * whole point: a warning that fires on a form the user opened and left alone is
 * noise, and a warning people learn to click past protects nothing.
 *
 * `extraDirty` covers state that does not live in the compared object — a
 * picked file held outside the form data, for instance — so the caller can add
 * to the answer without restructuring its state.
 *
 * Returns a getter rather than a boolean because `FormModal` asks at the moment
 * of closing; handing it a value computed a render earlier would answer for the
 * wrong keystroke.
 */
export function useDirtySnapshot<T>(
  open: boolean,
  value: T,
  extraDirty: () => boolean = () => false,
): () => boolean {
  const pristine = useRef<string>('');
  const latest = useRef<T>(value);
  latest.current = value;

  const extraRef = useRef(extraDirty);
  extraRef.current = extraDirty;

  useEffect(() => {
    // Taken on open, so reopening a form starts a fresh comparison and a save
    // that closes and reopens does not inherit the previous edit's snapshot.
    if (open) pristine.current = JSON.stringify(latest.current);
  }, [open]);

  return () => {
    if (!open) return false;
    if (extraRef.current()) return true;
    return JSON.stringify(latest.current) !== pristine.current;
  };
}
