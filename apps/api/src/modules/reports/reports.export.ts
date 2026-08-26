import type { ExpenseReport } from '@ims/shared';

/** `Intl.NumberFormat` is the same call the BOM PDF uses; reusing the locale keeps the printed
 *  numbers consistent across documents. */
const BDT = new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  maximumFractionDigits: 2,
});

function formatBdt(value: number): string {
  try {
    return BDT.format(value);
  } catch {
    // Some Node builds lack en-BD currency data; fall back to a sensible prefix.
    return `৳${value.toFixed(2)}`;
  }
}

/** RFC 4180 quoting: wrap a field in quotes whenever it contains a comma, quote, or newline. */
function csvField(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * The CSV mirrors the on-screen layout: header row, one row per bucket, a totals row.
 *
 * `Requisitions` is the only integer column; every money figure prints with two decimal places
 * because Excel will treat numbers-without-decimals as integers and refuse to sum them as currency.
 * The audit trail is the round-trip — totals row must reconcile with the JSON endpoint's totals
 * to the paisa — so the test in `reports.int-spec.ts` parses this back and compares.
 */
export function expenseReportToCsv(report: ExpenseReport): string {
  const headers = [
    'Bucket',
    'Requisitions',
    'Requested',
    'Approved',
    'Funded',
    'Spent',
    'On purchases',
    'On transportation',
    'Returned',
    'Net cash',
  ];

  const rows = report.buckets.map((bucket) =>
    [
      csvField(bucket.label),
      bucket.requisitionCount,
      bucket.requested.toFixed(2),
      bucket.approved.toFixed(2),
      bucket.funded.toFixed(2),
      bucket.spent.toFixed(2),
      bucket.purchased.toFixed(2),
      bucket.transportation.toFixed(2),
      bucket.returned.toFixed(2),
      bucket.netCash.toFixed(2),
    ].join(','),
  );

  const totals = report.totals;
  const totalsRow = [
    'Total',
    totals.requisitionCount,
    totals.requested.toFixed(2),
    totals.approved.toFixed(2),
    totals.funded.toFixed(2),
    totals.spent.toFixed(2),
    totals.purchased.toFixed(2),
    totals.transportation.toFixed(2),
    totals.returned.toFixed(2),
    totals.netCash.toFixed(2),
  ].join(',');

  // Trailing newline so the last row is well-formed for parsers that respect text-mode line endings.
  return [headers.join(','), ...rows, totalsRow, ''].join('\n');
}

/** HTML entity escaping for the four characters that can break a `<td>`. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Printable HTML for the expense report. The renderer is `PdfRendererService` — same Chromium
 * path the BOM PDF uses. We deliberately keep the styling inline (Chromium loads no stylesheet
 * via `setContent`) and minimal: a header, the table, the totals row, and a one-line footnote
 * that names what each money column means so the printed page is self-explanatory.
 */
export function expenseReportToHtml(report: ExpenseReport, timeZone: string): string {
  const rows = report.buckets
    .map(
      (bucket) => `
        <tr>
          <td>${escapeHtml(bucket.label)}</td>
          <td class="num">${bucket.requisitionCount}</td>
          <td class="num">${formatBdt(bucket.requested)}</td>
          <td class="num">${formatBdt(bucket.approved)}</td>
          <td class="num">${formatBdt(bucket.funded)}</td>
          <td class="num">${formatBdt(bucket.spent)}</td>
          <td class="num">${formatBdt(bucket.purchased)}</td>
          <td class="num">${formatBdt(bucket.transportation)}</td>
          <td class="num">${formatBdt(bucket.returned)}</td>
          <td class="num"><strong>${formatBdt(bucket.netCash)}</strong></td>
        </tr>`,
    )
    .join('');

  const totals = report.totals;
  // The stamp is in the business's own time zone so a Dhaka-headquartered report printed from
  // a UTC server still reads as "generated 2:14 PM, 31 July 2026" to the recipient.
  const stamp = new Date().toLocaleString('en-GB', { timeZone });
  const dateRange = `${escapeHtml(report.from ?? 'All time')} → ${escapeHtml(report.to ?? 'today')}`;
  const groupLabel = report.groupBy[0]!.toUpperCase() + report.groupBy.slice(1);

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Expense report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #111; }
          h1 { font-size: 18px; margin: 0 0 4px 0; }
          .meta { font-size: 11px; color: #555; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          thead th { text-align: left; border-bottom: 1px solid #444; padding: 6px; }
          tbody td { padding: 6px; border-bottom: 1px solid #ddd; }
          .num { text-align: right; font-variant-numeric: tabular-nums; }
          tfoot td { border-top: 2px solid #444; font-weight: 600; padding: 6px; }
          .footnote { margin-top: 14px; font-size: 10px; color: #666; }
        </style>
      </head>
      <body>
        <h1>Expense report</h1>
        <p class="meta">${dateRange} · grouped by ${groupLabel} · generated ${escapeHtml(stamp)}</p>
        <table>
          <thead>
            <tr>
              <th>Bucket</th>
              <th class="num">Requisitions</th>
              <th class="num">Requested</th>
              <th class="num">Approved</th>
              <th class="num">Funded</th>
              <th class="num">Spent</th>
              <th class="num">Returned</th>
              <th class="num">Net cash</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td class="num">${totals.requisitionCount}</td>
              <td class="num">${formatBdt(totals.requested)}</td>
              <td class="num">${formatBdt(totals.approved)}</td>
              <td class="num">${formatBdt(totals.funded)}</td>
              <td class="num">${formatBdt(totals.spent)}</td>
              <td class="num">${formatBdt(totals.purchased)}</td>
              <td class="num">${formatBdt(totals.transportation)}</td>
              <td class="num">${formatBdt(totals.returned)}</td>
              <td class="num">${formatBdt(totals.netCash)}</td>
            </tr>
          </tfoot>
        </table>
        <p class="footnote">
          Spent is the purchase total. Returned is money refunded to Accounts. Net cash is funded minus returned.
        </p>
      </body>
    </html>`;
}
