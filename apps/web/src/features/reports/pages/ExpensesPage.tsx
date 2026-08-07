import { useMemo, useState } from 'react';
import type { ExpenseGroupBy, ExpenseReportQuery } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { PageHeader, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatBdt } from '@/lib/format';
import { useExpenseReport, expenseExportUrl } from '../api';

/** `YYYY-MM-DD` in the business's own calendar, matching what the API expects. */
function localDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA').format(date);
}

/**
 * Preset ranges, because "this month" is the question people actually ask and typing two dates to
 * get it is friction. `null` means an open end — the API treats a missing bound as unbounded.
 */
function presets(): Array<{ label: string; from: string | null; to: string | null }> {
  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  return [
    { label: t.expenses.thisMonth, from: localDate(startOfThisMonth), to: localDate(now) },
    { label: t.expenses.lastMonth, from: localDate(startOfLastMonth), to: localDate(endOfLastMonth) },
    { label: t.expenses.thisYear, from: localDate(startOfYear), to: localDate(now) },
    { label: t.expenses.allTime, from: null, to: null },
  ];
}

/**
 * A right-aligned, tabular-figure cell. Money columns only line up for comparison when the digits
 * are monospaced and the decimals agree, which is the whole reason this table exists.
 */
function Amount({
  value,
  plain = false,
  emphasis = false,
}: {
  value: number;
  /** A count, not money — no forced decimals. */
  plain?: boolean;
  emphasis?: boolean;
}) {
  return (
    <td
      className={cn(
        'px-4 py-2.5 text-right tabular-nums',
        emphasis && 'font-semibold text-ink',
      )}
    >
      {plain ? value : formatBdt(value)}
    </td>
  );
}

export function ExpensesPage() {
  const [groupBy, setGroupBy] = useState<ExpenseGroupBy>('month');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const query = useMemo<ExpenseReportQuery>(
    () => ({ groupBy, ...(from ? { from } : {}), ...(to ? { to } : {}) }),
    [groupBy, from, to],
  );

  const report = useExpenseReport(query);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.expenses.title} subtitle={t.expenses.subtitle} />

      <Panel>
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">{t.expenses.groupBy}</span>
            <select
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value as ExpenseGroupBy)}
              className="rounded-[--radius-control] border border-border bg-surface px-2.5 py-1.5 text-sm"
            >
              <option value="month">{t.expenses.groupByMonth}</option>
              <option value="department">{t.expenses.groupByDepartment}</option>
              <option value="project">{t.expenses.groupByProject}</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">{t.expenses.from}</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="rounded-[--radius-control] border border-border bg-surface px-2.5 py-1.5 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">{t.expenses.to}</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="rounded-[--radius-control] border border-border bg-surface px-2.5 py-1.5 text-sm"
            />
          </label>

          <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
            {presets().map((preset) => (
              <Button
                key={preset.label}
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFrom(preset.from ?? '');
                  setTo(preset.to ?? '');
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          {/* Anchors, not buttons: the browser handles the download, the auth cookie rides along
              because the URL is same-origin, and there is no in-app loading state to manage.
              Plain anchor styling matches the ghost-variant button — no nested interactive element. */}
          <div className="ml-auto flex flex-wrap items-center gap-1.5 pb-0.5">
            <a
              href={expenseExportUrl(query, 'csv')}
              download
              className="inline-flex h-8 items-center justify-center rounded-[--radius-control] px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              {t.expenses.downloadCsv}
            </a>
            <a
              href={expenseExportUrl(query, 'pdf')}
              download
              className="inline-flex h-8 items-center justify-center rounded-[--radius-control] px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              {t.expenses.downloadPdf}
            </a>
          </div>
        </div>

        <QueryBoundary
          isLoading={report.isPending}
          error={report.error}
          data={report.data}
          onRetry={() => void report.refetch()}
          loadingFallback={<SkeletonRows rows={6} />}
        >
          {(data) =>
            data.buckets.length === 0 ? (
              <EmptyState title={t.expenses.emptyTitle} body={t.expenses.emptyBody} />
            ) : (
              <>
                <Table
                  headers={[
                    t.expenses.bucket,
                    t.expenses.count,
                    t.expenses.requested,
                    t.expenses.approved,
                    t.expenses.funded,
                    t.expenses.spent,
                    t.expenses.returned,
                    t.expenses.netCash,
                  ]}
                >
                  {data.buckets.map((bucket) => (
                    <tr key={bucket.key}>
                      <td className="px-4 py-2.5 font-medium text-ink">{bucket.label}</td>
                      <Amount value={bucket.requisitionCount} plain />
                      <Amount value={bucket.requested} />
                      <Amount value={bucket.approved} />
                      <Amount value={bucket.funded} />
                      <Amount value={bucket.spent} />
                      <Amount value={bucket.returned} />
                      <Amount value={bucket.netCash} emphasis />
                    </tr>
                  ))}
                  {/* The totals ride in the body because the shared Table owns thead/tbody. The
                      heavier top border is what makes it read as a summary rather than a row. */}
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="px-4 py-2.5">{t.expenses.total}</td>
                    <Amount value={data.totals.requisitionCount} plain />
                    <Amount value={data.totals.requested} />
                    <Amount value={data.totals.approved} />
                    <Amount value={data.totals.funded} />
                    <Amount value={data.totals.spent} />
                    <Amount value={data.totals.returned} />
                    <Amount value={data.totals.netCash} emphasis />
                  </tr>
                </Table>
                {/* The two different date bases are the one thing that surprises people reading
                    this table, so it is stated rather than left to be discovered. */}
                <p className="border-t border-border px-4 py-2 text-xs text-ink-subtle">
                  {t.expenses.attributionHint}
                </p>
              </>
            )
          }
        </QueryBoundary>
      </Panel>
    </div>
  );
}
