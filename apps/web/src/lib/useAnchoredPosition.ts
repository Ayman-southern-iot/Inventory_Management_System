import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Positions a portalled popover against an anchor element.
 *
 * Extracted from `DateField`, which needed it because `Panel` carries `overflow-hidden` to keep
 * its children inside its rounded corners — so anything absolutely positioned inside a Panel is
 * clipped by it. A portal has no such ancestor, but then it needs to be told where to go.
 *
 * The item-row suggestion list has the same problem and the same fix, which is what justifies a
 * shared hook rather than a second copy: two call sites is where copied positioning logic starts
 * drifting.
 *
 * Flips above the anchor when there is not enough room below, so a field near the bottom of a
 * long form does not put its popover off the end of the window.
 */
export function useAnchoredPosition<TAnchor extends HTMLElement, TPopover extends HTMLElement>(
  open: boolean,
  width: number,
) {
  const anchorRef = useRef<TAnchor>(null);
  const popoverRef = useRef<TPopover>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const popoverHeight = popoverRef.current?.offsetHeight ?? 0;
    const GAP = 4;

    // Below unless it would overflow the viewport *and* there is genuinely more room above.
    const roomBelow = window.innerHeight - rect.bottom;
    const flipUp = popoverHeight > 0 && roomBelow < popoverHeight + GAP && rect.top > roomBelow;

    setPosition({
      top: flipUp ? rect.top - popoverHeight - GAP : rect.bottom + GAP,
      // Kept inside the right edge on a narrow window, and never off the left.
      left: Math.max(GAP, Math.min(rect.left, window.innerWidth - width - GAP)),
    });
  }, [width]);

  // Before paint, so the popover never renders at the wrong place for a frame.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    reposition();
  }, [open, reposition]);

  // Scrolling or resizing moves the anchor; the popover has to follow. `capture` so a scrolling
  // ancestor counts, not only the window.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  return { anchorRef, popoverRef, position, reposition };
}
