import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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

interface ImportLockContextValue {
  /** Registers a suppressor; call the returned function to remove it. */
  suppress: () => () => void;
}

const ImportLockContext = createContext<ImportLockContextValue | null>(null);

/**
 * Hides the block while this component is showing a live import's progress.
 *
 * **Why this exists.** §8 allow-lists `GET /inventory/imports/:id` precisely so the manager
 * running an import can watch it. But nothing *else* on that page is allow-listed — the
 * notification bell's unread count 503s like everything else — so without this the block would
 * be thrown over the very screen the allow-list was written to keep usable, by a background
 * query that has no idea it is doing it. Deny-by-default still holds for every other screen that
 * manager opens; the exception is the one view whose whole purpose is watching the thing that is
 * blocking everyone.
 *
 * **It is scoped to a live job being displayed, not to a page being open.** A manager who leaves
 * the import view mounted in a background tab and works elsewhere must still be blocked
 * elsewhere, so the suppression lives and dies with the component actually rendering progress,
 * and lifts the moment the job reaches a terminal state.
 *
 * **It grants nothing.** The lockout is enforced by a guard on the server; this only decides
 * whether a courtesy overlay is drawn. A session that suppressed it without cause would see its
 * own screens fail one by one instead of seeing one clear explanation — worse for them, and no
 * more permitted than before. There is no data behind the block to reach.
 */
export function useSuppressImportBlock(active: boolean): void {
  const context = useContext(ImportLockContext);

  useEffect(() => {
    if (!active || !context) return undefined;
    return context.suppress();
  }, [active, context]);
}

export function ImportLockProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lock, setLock] = useState<{ estimatedFinishAt: string | null } | null>(null);
  /*
   * Counted, not a boolean. Two components could legitimately be showing progress at once — the
   * ring and a summary row, say — and a boolean would let the first to unmount un-suppress while
   * the second is still on screen.
   */
  const [suppressors, setSuppressors] = useState(0);

  useEffect(() => {
    setSystemLockedHandler((estimatedFinishAt) => {
      setLock({ estimatedFinishAt });
    });
    return () => setSystemLockedHandler(null);
  }, []);

  const suppress = useCallback(() => {
    setSuppressors((count) => count + 1);
    return () => setSuppressors((count) => Math.max(0, count - 1));
  }, []);

  const cleared = useCallback(() => setLock(null), []);
  const value = useMemo(() => ({ suppress }), [suppress]);

  return (
    <ImportLockContext.Provider value={value}>
      {children}
      {lock && suppressors === 0 ? (
        <SystemImportBlock estimatedFinishAt={lock.estimatedFinishAt} onCleared={cleared} />
      ) : null}
    </ImportLockContext.Provider>
  );
}
