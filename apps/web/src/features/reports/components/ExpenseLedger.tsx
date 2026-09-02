import type { ExpenseGroupBy, ExpenseReport } from '@ims/shared';
import { Table } from '@/components/ui/primitives';
import { t } from '@/i18n/en';
import { formatBdt } from '@/lib/format';

/**
 * The period ledger: one row per month (or department, or project), split into items and
 * transport, with a bar for relative size.
 *
 * The footer total must equal the flow header's Spent for the same range. Three places, one
 * number — that is the page's promise, and a footer that does not balance is worse than no footer.
 */

function headingFor(groupBy: ExpenseGroupBy): string {
  if (groupBy === 'department') return t.expenses.ledgerHeadingDepartment;
  if (groupBy === 'project') return t.expenses.ledgerHeadingProject;
  return t.expenses.ledgerHeading;
}

/**
 * A bar sized against the largest row, not the total.
 *
 * Against the total, every bar in a twelve-month view is a sliver and the comparison the bar
 * exists to make — this month against last — becomes unreadable.
 *
 * `style` carries the width because it is a computed datum, not a theme value; the colours are
 * tokens. A Tailwind class cannot express "62% of the widest row".
 */
function Bar({ value, widest }: { value: number; widest: number }) {
  return (
    <div className="h-1.5 w-full min-w-24 rounded-full bg-surface-muted">
      <div
        className="h-1.5 rounded-full bg-brand"
        style={{ width: widest > 0 ? `${(value / widest) * 100}%` : '0%' }}
      />
    </div>
  );
}

export function ExpenseLedger({
  report,
  groupBy,
}: {
  report: ExpenseReport;
  groupBy: ExpenseGroupBy;
}) {
  const { buckets, totals } = report;
  const widest = buckets.reduce((max, b) => Math.max(max, b.spent), 0);

  return (
    <section>
      <div className="px-4 pb-3 pt-4">
        <h2 className="text-base font-semibold text-ink">{headingFor(groupBy)}</h2>
        <p className="mt-0.5 text-xs text-ink-subtle">{t.expenses.ledgerSubtitle}</p>
      </div>

      <Table
        headers={[
          t.expenses.bucket,
          t.expenses.splitItems,
          t.expenses.splitTransport,
          t.expenses.total,
          // Deliberately unlabelled: the bar restates the Total column, and a header over it would
          // imply a fifth figure to read rather than a way of seeing the fourth.
          '',
        ]}
        headerAligns={['start', 'end', 'end', 'end', 'start']}
      >
        {buckets.map((bucket) => (
          <tr key={bucket.key}>
            <td className="px-4 py-2.5 font-medium text-ink">{bucket.label}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
              {formatBdt(bucket.purchased)}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
              {formatBdt(bucket.transportation)}
            </td>
            <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
              {formatBdt(bucket.spent)}
            </td>
            <td className="px-4 py-2.5">
              <Bar value={bucket.spent} widest={widest} />
            </td>
          </tr>
        ))}
        {/* The totals ride in the body because the shared Table owns thead/tbody. The heavier top
            border is what makes it read as a summary rather than another row. */}
        <tr className="border-t-2 border-border font-semibold">
          <td className="px-4 py-2.5">{t.expenses.total}</td>
          <td className="px-4 py-2.5 text-right tabular-nums">{formatBdt(totals.purchased)}</td>
          <td className="px-4 py-2.5 text-right tabular-nums">
            {formatBdt(totals.transportation)}
          </td>
          <td className="px-4 py-2.5 text-right tabular-nums text-ink">
            {formatBdt(totals.spent)}
          </td>
          <td />
        </tr>
      </Table>
    </section>
  );
}
