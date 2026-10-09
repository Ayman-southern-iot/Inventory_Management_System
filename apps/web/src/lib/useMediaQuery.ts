import { useCallback, useSyncExternalStore } from 'react';

/** Tailwind's `lg`: the narrowest screen treated as a PC. The 3D room view needs at least this. */
export const DESKTOP_MIN_WIDTH_PX = 1024;
export const DESKTOP_MEDIA = `(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`;

const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * Whether a CSS media query matches, kept current as the window changes. False where there is no
 * `matchMedia` to ask (jsdom, server rendering): a screen that cannot say how wide it is gets the
 * narrow layout, which is the one that works everywhere.
 */
export function useMediaQuery(query: string): boolean {
  // Stable per query, or React would unsubscribe and subscribe again on every render.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canMatch()) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => canMatch() && window.matchMedia(query).matches,
    () => false,
  );
}
