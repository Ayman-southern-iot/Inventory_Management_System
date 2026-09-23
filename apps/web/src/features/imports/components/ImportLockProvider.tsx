import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { setSystemLockedHandler } from '@/api/client';
import { SystemImportBlock } from './SystemImportBlock';

/**
 * Raises the full-screen block the moment any request comes back 503 (`importing_data.md` §8).
 *
 * It listens to the API client rather than to a query, because during a lockout **every** request
 * fails — so the news arrives from whichever call happened to be in flight, not from a screen
 * that thought to ask. Catching it in one place means the block appears once, rather than every
 * open screen rendering its own error state simultaneously.
 *
 * There is no polling for the *start* of a lockout and there should not be: a client that asks
 * "are we locked?" on a timer is a request per client per interval, for a state that is false
 * virtually always. The 503 itself is the notification.
 */
export function ImportLockProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lock, setLock] = useState<{ estimatedFinishAt: string | null } | null>(null);

  useEffect(() => {
    setSystemLockedHandler((estimatedFinishAt) => {
      setLock({ estimatedFinishAt });
    });
    return () => setSystemLockedHandler(null);
  }, []);

  const cleared = useCallback(() => setLock(null), []);

  return (
    <>
      {children}
      {lock ? (
        <SystemImportBlock estimatedFinishAt={lock.estimatedFinishAt} onCleared={cleared} />
      ) : null}
    </>
  );
}
