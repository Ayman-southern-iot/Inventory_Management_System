import { useEffect, useState } from 'react';
import { type ImportJob } from '@ims/shared';
import { t } from '@/i18n/en';

/**
 * What the manager running the import watches (the brief: *"in this loader time and percentage
 * must be mentioned and continuous updating"*).
 *
 * **Two sources, deliberately.** The percentage comes from the server, polled; the elapsed clock
 * runs locally, once a second. Driving the clock from the poll would make it stutter — it would
 * advance only when a response arrived, and stop dead the moment one was slow, which reads as
 * "the import has hung" at exactly the moment it has not.
 */
export function ImportProgressRing({ job }: { job: ImportJob }): JSX.Element {
  const elapsed = useElapsedSince(job.startedAt);
  const percent = job.percent ?? 0;

  return (
    <div className="flex flex-col items-center gap-3" data-testid="import-progress">
      <div className="relative size-40">
        <Ring percent={job.percent} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/*
            One live region for both numbers rather than two. A screen reader announcing the
            percentage and the clock as separate updates every second is unusable; together,
            once a second, it is a sentence.
          */}
          <span className="text-2xl font-semibold text-ink" aria-live="polite" aria-atomic="true">
            {job.percent === null ? '—' : t.imports.progress.percent(percent)}
          </span>
          <span className="text-xs text-ink-subtle">{t.imports.progress.elapsed(elapsed)}</span>
        </div>
      </div>

      <p className="text-sm font-medium text-ink">{t.imports.progress.title}</p>
      <p className="text-xs text-ink-subtle">{describe(job)}</p>
      <p className="text-xs text-ink-subtle">{t.imports.progress.doNotClose}</p>
    </div>
  );
}

/**
 * The ring itself. An indeterminate spin until the server knows the row count, because a ring
 * sitting at 0% looks identical to a ring that is stuck.
 */
function Ring({ percent }: { percent: number | null }): JSX.Element {
  if (percent === null) {
    return (
      <div
        className="size-40 animate-spin rounded-full border-8 border-border border-t-brand"
        aria-hidden="true"
      />
    );
  }

  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * CIRCUMFERENCE;

  return (
    <svg viewBox="0 0 100 100" className="size-40 -rotate-90" aria-hidden="true">
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        className="fill-none stroke-border"
        strokeWidth={STROKE_WIDTH}
      />
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        className="fill-none stroke-brand transition-[stroke-dasharray] duration-500"
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
      />
    </svg>
  );
}

const RADIUS = 42;
const STROKE_WIDTH = 8;

/** Where the run has got to, in words, for the stages a percentage cannot describe. */
function describe(job: ImportJob): string {
  if (job.totalRows === null) return t.imports.progress.starting;
  if (job.processedRows === 0) return t.imports.progress.snapshot;
  if (job.processedRows >= job.totalRows) return t.imports.progress.finishing;
  return t.imports.progress.shelves(job.processedRows, job.totalRows);
}

/**
 * A clock that ticks whether or not the network does.
 *
 * Counts from the server's `startedAt` rather than from when this component mounted, so
 * reopening the page mid-import shows how long the import has been running — not how long this
 * tab has been watching it (C33).
 */
function useElapsedSince(startedAt: string | null): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  if (!startedAt) return formatClock(0);
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return formatClock(0);
  return formatClock(Math.max(0, now - started));
}

const TICK_MS = 1_000;

/** `m:ss` up to an hour, `h:mm:ss` past it. An import should never reach the second form. */
export function formatClock(elapsedMs: number): string {
  const total = Math.floor(elapsedMs / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
