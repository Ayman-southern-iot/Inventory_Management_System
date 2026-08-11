import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/en';
import { Button } from './Button';

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-[--radius-panel] border border-border bg-surface shadow-[--shadow-panel]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

type BadgeTone = 'neutral' | 'success' | 'pending' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-muted',
  success: 'bg-success-subtle text-success',
  pending: 'bg-pending-subtle text-pending',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
};

export function Badge({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: BadgeTone;
  /** Optional tooltip text — rendered as a native `title` attribute. */
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        // A wrapped badge reads as two badges — role names must stay on one line.
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Tables always carry a header row — the accessibility floor for a data-heavy tool. */
export function Table({
  headers,
  headerAligns,
  children,
}: {
  headers: string[];
  /**
   * Per-column header alignment. Use `end` for numeric columns so figures line up
   * vertically with the right-aligned body cells. Defaults to start-aligned for
   * everything (unchanged from when the primitive only supported text columns).
   */
  headerAligns?: Array<'start' | 'end'>;
  children: ReactNode;
}) {
  const aligns = headerAligns ?? headers.map(() => 'start' as const);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted/60">
            {headers.map((header, index) => (
              <th
                key={header}
                scope="col"
                className={cn(
                  'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted',
                  aligns[index] === 'end' ? 'text-right' : 'text-left',
                )}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  limit,
  total,
  onPageChange,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;

  return (
    <nav
      aria-label={t.common.page}
      className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm"
    >
      <p className="text-ink-muted">
        {total} {t.common.results}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t.common.previous}
        </Button>
        <span className="text-ink-muted">
          {t.common.page} {page} {t.common.of} {lastPage}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => onPageChange(page + 1)}
        >
          {t.common.next}
        </Button>
      </div>
    </nav>
  );
}
