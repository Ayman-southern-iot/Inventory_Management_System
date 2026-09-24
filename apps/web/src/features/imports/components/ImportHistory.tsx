import { useState } from 'react';
import { ImportJobStatus, type ImportJob } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';
import { messageForError } from '@/lib/error-message';
import { webConfig } from '@/api/config';
import { useDeleteSnapshot, useImportHistory, useRestoreImport } from '../api';

/**
 * Every past import, and what can still be done about it (`importing_data.md` §10, part F).
 *
 * The list exists for one question — *"can I put it back?"* — so the snapshot column is the point
 * and the counts are context. A run whose backup has been deleted says so plainly rather than
 * offering a Restore button that would fail.
 */
export function ImportHistory({
  onRestored,
}: {
  onRestored: (jobId: string) => void;
}): JSX.Element {
  const history = useImportHistory();

  if (history.isPending) return <p className="text-sm text-ink-subtle">{t.common.loading}</p>;
  if (history.error) return <p className="text-sm text-danger">{messageForError(history.error)}</p>;

  const jobs = history.data ?? [];
  if (jobs.length === 0) {
    return <p className="text-sm text-ink-subtle">{t.imports.history.empty}</p>;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium text-ink">{t.imports.history.title}</h2>
      <ul className="divide-y divide-border rounded-md border border-border">
        {jobs.map((job, index) => (
          <HistoryRow
            key={job.id}
            job={job}
            // How many *later* runs a restore would undo. The list is newest first, so everything
            // before this row happened after it (§10: "every change since will be undone").
            laterRuns={jobs.slice(0, index).filter(isCompleted).length}
            onRestored={onRestored}
          />
        ))}
      </ul>
    </section>
  );
}

const isCompleted = (job: ImportJob): boolean => job.status === ImportJobStatus.COMPLETED;

function HistoryRow({
  job,
  laterRuns,
  onRestored,
}: {
  job: ImportJob;
  laterRuns: number;
  onRestored: (jobId: string) => void;
}): JSX.Element {
  const restore = useRestoreImport();
  const remove = useDeleteSnapshot();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{formatDateTime(job.createdAt)}</span>
        <span className="text-xs text-ink-subtle">
          {t.imports.history.by(job.createdByName, job.status)}
        </span>
      </div>

      {job.diff ? (
        <p className="text-xs text-ink-subtle">
          {t.imports.history.summary(
            job.diff.productsCreated,
            job.diff.productsUpdated,
            job.diff.productsDeactivated,
            job.diff.shelvesChanged,
          )}
        </p>
      ) : null}

      {job.restoredFromJobId ? (
        <p className="text-xs text-ink-subtle">{t.imports.history.wasRestore}</p>
      ) : null}

      {job.canRestore ? (
        <div className="space-y-2">
          {confirming ? (
            <p className="rounded bg-danger-subtle p-2 text-xs text-ink">
              {t.imports.history.undoWarning(formatDateTime(job.createdAt), laterRuns)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <a
              className="text-xs underline text-brand"
              href={`${webConfig.apiBaseUrl}/inventory/imports/${job.id}/snapshot`}
            >
              {t.imports.history.download}
            </a>
            <Button
              size="sm"
              variant="secondary"
              isLoading={restore.isPending}
              onClick={() => {
                // Two steps on purpose: restoring undoes everything since, and §10 says that has
                // to be stated rather than discovered.
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                restore.mutate(job.id, {
                  onSuccess: (created) => onRestored(created.id),
                  onError: (error) => toast.error(messageForError(error)),
                });
              }}
            >
              {confirming ? t.imports.history.restoreConfirm : t.imports.history.restore}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              isLoading={remove.isPending}
              onClick={() =>
                remove.mutate(job.id, {
                  onError: (error) => toast.error(messageForError(error)),
                })
              }
            >
              {t.imports.history.deleteSnapshot}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-subtle">{t.imports.history.noSnapshot}</p>
      )}
    </li>
  );
}
