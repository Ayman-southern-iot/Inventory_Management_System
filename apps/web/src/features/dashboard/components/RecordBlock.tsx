import type { ReactNode } from 'react';
import { Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/en';

/**
 * One figure. Kept deliberately plain — a tile with a border, an icon and a trend arrow around a
 * single integer is decoration, and twelve of them side by side stop being readable.
 *
 * `tone` exists for the three condition counts. A damaged return is not a neutral fact about
 * yourself, and colouring a zero would be worse than not colouring it, so the tone applies only
 * when the figure is non-zero.
 */
export function Figure({
  label,
  value,
  suffix,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  suffix?: string;
  tone?: 'neutral' | 'warning' | 'danger';
}) {
  const isZero = value === 0 || value === '0';
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-2xl font-semibold tabular-nums',
          tone === 'neutral' || isZero
            ? 'text-ink'
            : tone === 'warning'
              ? 'text-pending'
              : 'text-danger',
        )}
      >
        {value}
        {suffix ? <span className="ml-1 text-xs font-normal text-ink-subtle">{suffix}</span> : null}
      </dd>
    </div>
  );
}

/**
 * One section of the personal record: a heading, an optional line of explanation, and a grid of
 * figures. Three of these make the dashboard, and they share this shell so the columns line up
 * across sections rather than each block inventing its own grid.
 */
export function RecordBlock({
  title,
  hint,
  isEmpty,
  children,
}: {
  title: string;
  hint?: string;
  /** When true the figures are replaced by one line, rather than a wall of zeroes. */
  isEmpty?: boolean;
  children: ReactNode;
}) {
  return (
    <Panel className="p-5">
      {/* A labelled region rather than a bare div: three blocks of numbers are three separate
          things to navigate, and "Approved" means one thing under Requisitions and another under
          Money. The heading names the block for a screen reader exactly as it does on screen. */}
      <section aria-label={title}>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-sm text-ink-muted">{hint}</p> : null}

        {isEmpty ? (
          <p className="mt-4 text-sm text-ink-subtle">{t.dashboard.nothingYet}</p>
        ) : (
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">{children}</dl>
        )}
      </section>
    </Panel>
  );
}
