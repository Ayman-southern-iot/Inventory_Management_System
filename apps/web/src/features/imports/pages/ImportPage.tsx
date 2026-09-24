import { useRef, useState } from 'react';
import { ImportJobStatus, type ImportJob } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useConfirmImport, useCancelImport, useImportJob, useUploadImport } from '../api';
import { ImportDiffPreview, IssueList } from '../components/ImportDiffPreview';
import { ImportHistory } from '../components/ImportHistory';
import { ImportProgressRing } from '../components/ImportProgressRing';
import { useSuppressImportBlock } from '../components/ImportLockProvider';

/**
 * The import screen (`importing_data.md` §5).
 *
 * One page, four states, driven entirely by the job's status rather than by local flags: choose a
 * file, read what it would do, watch it happen, see how it ended. Holding the state in the job
 * means closing the browser mid-import and coming back lands on the right screen (C33) — there is
 * nothing in this component that the server does not already know.
 */
export function ImportPage(): JSX.Element {
  const [jobId, setJobId] = useState<string | null>(null);
  const { data: job } = useImportJob(jobId);

  /*
   * While this page is showing a live job, the lockout's full-screen block stays down — see
   * `useSuppressImportBlock`. Without it a background query's 503 would cover the one screen §8
   * allow-lists the progress endpoint for. The hook takes the job, so it lifts by itself the
   * moment the import ends.
   */
  useSuppressImportBlock(job);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-xl font-semibold text-ink">{t.imports.upload.title}</h1>
      {job ? (
        <JobView job={job} onDiscard={() => setJobId(null)} />
      ) : (
        <>
          <Upload onStarted={setJobId} />
          {/* A restore produces an ordinary job, so it lands on the same confirm screen. */}
          <ImportHistory onRestored={setJobId} />
        </>
      )}
    </div>
  );
}

function JobView({ job, onDiscard }: { job: ImportJob; onDiscard: () => void }): JSX.Element {
  switch (job.status) {
    case ImportJobStatus.AWAITING_CONFIRMATION:
      return <Confirm job={job} onDiscard={onDiscard} />;
    case ImportJobStatus.APPLYING:
    case ImportJobStatus.VALIDATING:
      return <ImportProgressRing job={job} />;
    case ImportJobStatus.FAILED:
      return <Failed job={job} onDiscard={onDiscard} />;
    default:
      return <Finished job={job} onDiscard={onDiscard} />;
  }
}

function Upload({ onStarted }: { onStarted: (jobId: string) => void }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadImport();
  const toast = useToast();

  const choose = (file: File | undefined): void => {
    if (!file) return;
    upload.mutate(file, {
      onSuccess: (job) => onStarted(job.id),
      onError: (error) => {
        // A validation failure comes back as a *job*, not an error — this is the upload itself
        // being refused, which is a different thing and deserves the reason verbatim.
        toast.error(messageForError(error));
      },
      onSettled: () => {
        // Cleared so choosing the same file twice in a row fires `change` the second time.
        if (input.current) input.current.value = '';
      },
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-subtle">{t.imports.upload.help}</p>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label={t.imports.upload.choose}
        onChange={(event) => choose(event.target.files?.[0])}
      />
      <Button onClick={() => input.current?.click()} isLoading={upload.isPending}>
        {upload.isPending ? t.imports.upload.uploading : t.imports.upload.choose}
      </Button>
    </div>
  );
}

function Confirm({ job, onDiscard }: { job: ImportJob; onDiscard: () => void }): JSX.Element {
  const confirm = useConfirmImport();
  const cancel = useCancelImport();
  const toast = useToast();

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-medium text-ink">{t.imports.preview.title}</h2>
      {job.diff ? <ImportDiffPreview diff={job.diff} /> : null}
      <p className="text-sm text-ink-subtle">{t.imports.preview.backup}</p>

      <div className="flex gap-3">
        <Button
          isLoading={confirm.isPending}
          onClick={() =>
            confirm.mutate(job.id, {
              onError: (error) => toast.error(messageForError(error)),
            })
          }
        >
          {confirm.isPending ? t.imports.preview.applying : t.imports.preview.apply}
        </Button>
        <Button
          variant="secondary"
          isLoading={cancel.isPending}
          onClick={() => cancel.mutate(job.id, { onSuccess: onDiscard })}
        >
          {t.imports.preview.cancel}
        </Button>
      </div>
    </div>
  );
}

function Failed({ job, onDiscard }: { job: ImportJob; onDiscard: () => void }): JSX.Element {
  return (
    <div className="space-y-4">
      <IssueList issues={job.errors} tone="error" />
      <Button variant="secondary" onClick={onDiscard}>
        {t.imports.preview.cancel}
      </Button>
    </div>
  );
}

function Finished({ job, onDiscard }: { job: ImportJob; onDiscard: () => void }): JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink">{t.imports.finished(job.status)}</p>
      {job.diff ? <ImportDiffPreview diff={job.diff} /> : null}
      <Button variant="secondary" onClick={onDiscard}>
        {t.imports.startAnother}
      </Button>
    </div>
  );
}
