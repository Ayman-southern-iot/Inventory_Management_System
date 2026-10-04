import { useEffect, useState } from 'react';

/**
 * The query a search runs on: the typed text once typing pauses for `delayMs`, or nothing.
 *
 * Unlike a plain trailing debounce, an empty query settles at once and wipes the last settled
 * value. Otherwise Clear (or the idle reset) followed by quick typing showed the results of the
 * query from before the clear until the new one settled — caught by the timing run.
 */
export function useSettledQuery(query: string, delayMs: number): string {
  const isEmpty = query.trim() === '';
  const [settled, setSettled] = useState('');

  useEffect(() => {
    if (isEmpty) {
      setSettled('');
      return;
    }
    const timer = window.setTimeout(() => setSettled(query), delayMs);
    return () => window.clearTimeout(timer);
  }, [query, isEmpty, delayMs]);

  return isEmpty ? '' : settled;
}
