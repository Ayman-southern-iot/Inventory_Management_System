import { useMemo, useState } from 'react';
import type { ExpenseGroupBy, ExpenseReport, ExpenseReportQuery } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useToast } from '@/components/ui/Toast';
import { ExpenseFlow } from '../components/ExpenseFlow';
import { ExpenseLedger } from '../components/ExpenseLedger';
import { SpendTrendChart } from '../components/SpendTrendChart';
import { TopSpendItems } from '../components/TopSpendItems';
import {
  useExpenseReport,
  useSpendTrend,
  useTopSpendItems,
  expenseExportPath,
} from '../api';
import { useExportDownload } from '../use-export-download';

/** Stem of the saved filename; the date and the extension are appended per download. */
const EXPORT_FILE_STEM = 'expenses';

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
 * What the flow header calls this period.
 *
 * Read from the report's own `from`/`to` rather than the filter inputs: the server applies the
 * reporting time zone when it resolves the window, so a label built from the raw inputs would
 * drift from the figures underneath it. With a single month in view the month name is friendlier
 * than a date range, and with no bounds at all the honest answer is that it covers everything.
 */
function periodLabel(report: ExpenseReport): string {
  const { from, to } = report;
  if (!from && !to) return t.expenses.allTime;
  if (from && to) {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    const sameMonth =
      start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
    if (sameMonth) {
      return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
  }
  return [from, to].filter(Boolean).join(' – ');
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
  // Independent of the page filter on purpose: the trend answers a different question from the
  // range picker, so it must not shrink to the selected month.
  const trend = useSpendTrend();
  // Same query as the report, so the ranking cannot disagree with the Items figure above it.
  const topItems = useTopSpendItems(query);

  // One hook per button, so a slow PDF render cannot disable the CSV button and a double
  // click on either is a no-op rather than a second request.
  const csv = useExportDownload();
  const pdf = useExportDownload();
  const toast = useToast();

  async function runExport(format: 'csv' | 'pdf'): Promise<void> {
    try {
      await (format === 'csv' ? csv : pdf).download(
        expenseExportPath(query, format),
        `${EXPORT_FILE_STEM}-${localDate(new Date())}.${format}`,
      );
    } catch (error) {
      // The old anchor could not report a failure at all — it saved whatever came back. A
      // toast is the least this owes the user, given the figures go to Accounts.
      toast.error(messageForError(error));
    }
  }

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

          {/* Buttons, not anchors: the endpoint is behind the JWT guard and a browser cannot
              attach a bearer token to a top-level navigation, so the bytes come through
              `api.blob()` and reach the user as an object URL. Same reasoning, and the same
              shape, as SupportingDocumentCard. */}
          <div className="ml-auto flex flex-wrap items-center gap-1.5 pb-0.5">
            <Button
              variant="ghost"
              size="sm"
              isLoading={csv.pending}
              onClick={() => void runExport('csv')}
            >
              {t.expenses.downloadCsv}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isLoading={pdf.pending}
              onClick={() => void runExport('pdf')}
            >
              {t.expenses.downloadPdf}
            </Button>
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
                <ExpenseFlow totals={data.totals} periodLabel={periodLabel(data)} />
                <div className="border-t border-border">
                  <ExpenseLedger report={data} groupBy={groupBy} />
                </div>
                {/* Side by side above `lg`: the trend answers "when" and the list answers
                    "on what", and they are read together. Stacked below it, because a
                    twelve-point chart in half of a phone is unreadable. */}
                <div className="grid grid-cols-1 border-t border-border lg:grid-cols-[3fr_2fr]">
                  {trend.data ? (
                    <section>
                      <div className="px-4 pb-1 pt-4">
                        <h2 className="text-base font-semibold text-ink">
                          {t.expenses.trendHeading}
                        </h2>
                        <p className="mt-0.5 text-xs text-ink-subtle">
                          {t.expenses.trendSubtitle.replace('{range}', trend.data.rangeLabel)}
                        </p>
                      </div>
                      <div className="px-2 pb-3">
                        <SpendTrendChart trend={trend.data} />
                      </div>
                    </section>
                  ) : null}

                  {topItems.data ? (
                    <section className="border-t border-border lg:border-l lg:border-t-0">
                      <div className="px-4 pb-3 pt-4">
                        <h2 className="text-base font-semibold text-ink">
                          {t.expenses.topItemsHeading}
                        </h2>
                        <p className="mt-0.5 text-xs text-ink-subtle">
                          {t.expenses.topItemsSubtitle}
                        </p>
                      </div>
                      <TopSpendItems data={topItems.data} />
                    </section>
                  ) : null}
                </div>

                {/* The two different date bases are the one thing that surprises people reading
                    these figures, so it is stated rather than left to be discovered. */}
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
