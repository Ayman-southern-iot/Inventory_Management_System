import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';

/**
 * What everyone who is not running the import sees while it applies (`importing_data.md` §8).
 *
 * A full-screen block rather than a toast or a disabled form, because the lockout is not about
 * one screen: every request is refused, so any page left visible underneath would be showing
 * numbers that are being rewritten as they are read.
 *
 * **It never sees a job id, and must not start.** A blocked user's own request did not create
 * the import and carries no reference to it — all they were handed is the 503 body. The
 * progress endpoint needs an id, so the ring the *importing* manager watches is a different
 * component on a different data source (`useImportJob`); coupling this to it would mean the
 * block could only render for the one person who does not need it.
 *
 * **It says when, not just that.** `estimatedFinishAt` comes from the 503's own body — the server
 * puts it there precisely because, while the lockout is up, every route that could have answered
 * "when will this end" is itself refused. The estimate already carries
 * `IMPORT_LOCKOUT_PADDING_MINUTES`, so it is deliberately pessimistic: better to say ten minutes
 * and take five.
 */
export function SystemImportBlock({
  estimatedFinishAt,
  onCleared,
}: {
  estimatedFinishAt: string | null;
  onCleared: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);

  /*
   * Poll rather than make them click. The import ends on its own, and a screen that sits there
   * until somebody thinks to retry is a screen people close. Any successful request means the
   * lockout is gone — the client's own handler is what put this up, so nothing here needs to
   * know which request proved it.
   *
   * **Not `{ type: 'active' }`.** There is no endpoint a blocked user can ask "is it over yet":
   * of the four allow-listed routes, progress needs an id they do not have, refresh and health
   * answer regardless of the lock, and abandon is not a question. So the probe has to be some
   * other request failing or succeeding — and filtering to *active* queries means a user sitting
   * on a screen with none would never poll at all, leaving the block up until they pressed the
   * button. Refetching everything in the cache costs a request every five seconds and removes
   * that dead end.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      void queryClient.refetchQueries();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [queryClient]);

  const retry = async (): Promise<void> => {
    setChecking(true);
    try {
      await queryClient.refetchQueries();
      onCleared();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="system-import-title"
      aria-describedby="system-import-body"
    >
      <div className="w-full max-w-md rounded-lg bg-surface p-6 text-center shadow-lg">
        <Spinner />
        <h1 id="system-import-title" className="mt-4 text-lg font-semibold text-ink">
          {t.imports.locked.title}
        </h1>
        <p id="system-import-body" className="mt-2 text-sm text-ink-subtle">
          {t.imports.locked.body}
        </p>
        <p className="mt-3 text-sm text-ink" aria-live="polite">
          {estimatedFinishAt
            ? t.imports.locked.until(formatDateTime(estimatedFinishAt))
            : t.imports.locked.unknown}
        </p>
        <Button
          className="mt-5"
          variant="secondary"
          onClick={() => void retry()}
          disabled={checking}
        >
          {checking ? t.imports.locked.retrying : t.imports.locked.retry}
        </Button>
      </div>
    </div>
  );
}

/** Long enough not to hammer an API that is busy, short enough that nobody stares at it. */
const POLL_INTERVAL_MS = 5_000;

function Spinner(): JSX.Element {
  return (
    <div
      className="mx-auto size-10 animate-spin rounded-full border-4 border-border border-t-brand"
      // Decorative: the heading and body already say what is happening, and a screen reader
      // announcing "loading" on a loop over the top of them is noise.
      aria-hidden="true"
    />
  );
}
