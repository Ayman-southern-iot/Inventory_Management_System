import { useEffect, useState } from 'react';

/**
 * Trails `value` by `delayMs`. Used to keep a keystroke from becoming a request: the product
 * search hits a trigram index, and typing "monitor" should be one query, not seven.
 *
 * This is UI state, not server state — the query itself still goes through TanStack Query.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
