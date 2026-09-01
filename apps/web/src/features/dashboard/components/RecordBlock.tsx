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
    // Full height with the value pushed to the bottom, so three figures in a row line up even
    // when one label wraps to two lines and its neighbours do not. Without this the numbers
    // stagger down the row and stop being comparable at a glance, which is the only thing a row
    // of figures is for.
    <div className="flex h-full flex-col">
      <dt className="text-xs font-medium leading-tight text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'mt-auto pt-1 text-2xl font-semibold tabular-nums',
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
  grouped,
  columns = 3,
  asList,
  children,
}: {
  title: string;
  hint?: string;
  /** When true the figures are replaced by one line, rather than a wall of zeroes. */
  isEmpty?: boolean;
  /**
   * The children are `Group`s, each bringing its own list. Six numbers in one undivided grid
   * read as six unrelated facts; "in motion" and "settled" are two questions, and saying so
   * costs one line of heading.
   */
  grouped?: boolean;
  /** Figures per row. Four figures in a three-column grid leave a lonely orphan on row two. */
  columns?: 2 | 3;
  /**
   * One figure per row, label left and amount right, the way a bill reads.
   *
   * Money labels are long — "Total Money in Purchasing" — and four of them in a grid inside a
   * third of the page wrapped onto two lines each and left the card looking crammed. Down the
   * page each label has the full width to itself and the amounts share a right edge, which is
   * where anybody reads a column of money from anyway.
   */
  asList?: boolean;
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
        ) : grouped ? (
          <div className="mt-4 flex flex-col gap-5">{children}</div>
        ) : asList ? (
          <dl className="mt-4 flex flex-col">{children}</dl>
        ) : (
          <dl
            className={cn(
              'mt-4 grid gap-4',
              columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3',
            )}
          >
            {children}
          </dl>
        )}
      </section>
    </Panel>
  );
}

/**
 * A named run of figures inside a block — "In motion", "Settled".
 *
 * The heading is small and quiet on purpose: it is a label for the row beneath it, not a
 * competitor to the block title above. The rule under it is what actually separates the groups;
 * without it two headings in one card read as two cards that failed to draw their borders.
 */
export function Group({
  title,
  columns = 3,
  children,
}: {
  title: string;
  columns?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
        {title}
      </p>
      <dl
        className={cn(
          'mt-3 grid gap-4',
          columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3',
        )}
      >
        {children}
      </dl>
    </div>
  );
}

/**
 * One line of a money statement: what it is on the left, how much on the right.
 *
 * The amounts are `tabular-nums` and right-aligned so the digits line up column-wise — four
 * figures you are meant to compare are unreadable when the decimal points wander.
 */
export function AmountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="shrink-0 text-lg font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
