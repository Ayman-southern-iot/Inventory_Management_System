import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LIVE_IMPORT_STATUSES, type ImportJob } from '@ims/shared';
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
 * **It takes the job, not a boolean, and that is the point.** "Suppress while a live job is on
 * screen" and "suppress while this page is open" are one careless argument apart, and the second
 * is a bug: a manager who leaves the import view mounted in a background tab while working
 * elsewhere would stop being blocked elsewhere. A caller cannot express that here — it hands over
 * the job and this decides, so the suppression lifts by itself the moment the job reaches a
 * terminal state, with nothing for the page to remember to do.
 *
 * **It grants nothing.** The lockout is enforced by a guard on the server; this only decides
 * whether a courtesy overlay is drawn. A session that suppressed it without cause would see its
 * own screens fail one by one instead of seeing one clear explanation — worse for them, and no
 * more permitted than before. There is no data behind the block to reach.
 */
export function useSuppressImportBlock(job: ImportJob | null | undefined): void {
  const context = useContext(ImportLockContext);
  const live = job != null && LIVE_IMPORT_STATUSES.includes(job.status);

  useEffect(() => {
    if (!live || !context) return undefined;
    return context.suppress();
  }, [live, context]);
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
