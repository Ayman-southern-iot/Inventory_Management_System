import { useEffect, useRef } from 'react';

/** Anything a person at the panel does. Pointer covers touch, pen and mouse. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/**
 * Calls `onIdle` once `timeoutMs` passes with no activity anywhere on the page, and again after
 * every later quiet spell. A touch restarts the clock; nothing else does, so a background poll
 * landing never keeps a stale drawer open.
 */
export function useIdleReset(onIdle: () => void, timeoutMs: number): void {
  const latest = useRef(onIdle);
  latest.current = onIdle;

  useEffect(() => {
    let timer = window.setTimeout(() => latest.current(), timeoutMs);
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current(), timeoutMs);
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, restart, { capture: true, passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, restart, { capture: true });
      }
    };
  }, [timeoutMs]);
}
