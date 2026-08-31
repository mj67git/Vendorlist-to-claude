import { useCallback, useEffect, useState } from 'react';

/**
 * Reports whether an element's text is actually being clipped.
 *
 * Used to decide whether a name needs a tooltip at all. A tooltip that repeats
 * a name the reader can already see in full is noise, so it is only attached
 * once the text genuinely does not fit.
 *
 * The 1px tolerance is deliberate: sub-pixel layout rounding routinely makes
 * `scrollWidth` exceed `clientWidth` by a fraction on text that is plainly
 * visible, which would otherwise mark almost every element as overflowing.
 *
 * Both axes are checked because the two clamping strategies fail differently —
 * a single-line clamp overflows horizontally, a two-line clamp vertically.
 *
 * Two details keep this stable, and both came from watching it misbehave rather
 * than from reasoning about it:
 *
 *  - The ref is a callback, not a `useRef`. Attaching a tooltip re-parents the
 *    element, so React unmounts the node that was measured and mounts a new
 *    one. With a plain ref the observer stays bound to the old, now-detached
 *    node forever. A callback ref re-runs the effect against the live node.
 *  - Measurements of a detached or zero-sized node are discarded. The outgoing
 *    node reports 0x0 on its way out, which otherwise reads as "fits fine" and
 *    silently switches the tooltip back off again.
 */
export function useIsOverflowing<T extends HTMLElement>(text: string) {
  const [node, setNode] = useState<T | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const ref = useCallback((el: T | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;

    const check = () => {
      // A node on its way out of the tree measures 0x0; that is not a fit.
      if (!node.isConnected) return;
      if (node.clientWidth === 0 && node.clientHeight === 0) return;
      setIsOverflowing(
        node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
      );
    };

    check();

    // Fonts load after first paint; Vazirmatn arriving late changes the metrics
    // this measurement depends on, so the observer has to outlive the initial
    // check rather than running once.
    const observer = new ResizeObserver(check);
    observer.observe(node);
    return () => observer.disconnect();
    // `text` is a dependency so a changed name is re-measured even when the box
    // it sits in keeps exactly the same size.
  }, [node, text]);

  return { ref, isOverflowing };
}
