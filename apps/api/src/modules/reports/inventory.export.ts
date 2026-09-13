import type { InventoryReport, InventoryReportRow } from '@ims/shared';

/**
 * EX-02, requirements §10: "Bill of Materials and inventory records can be exported as PDF for
 * the Inventory Manager to submit physical copies to the accounts department."
 *
 * Separate from `reports.export.ts` because the two share no columns and no shape — the expense
 * report is money in buckets, this is quantities in places. Folding them into one file would mean
 * one set of helpers pretending to serve both.
 */

/** RFC 4180 quoting: wrap a field whenever it contains a comma, a quote, or a newline. */
function csvField(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * `Holding` says what kind of line each row is — `Shelf` or `On loan`.
 *
 * The product-level "owned" total is deliberately *not* a column here. This file is one line per
 * holding so it can be pivoted, and a product total repeated across a product's rows would be
 * summed once per compartment by any pivot that touched it. Owned is `Quantity` summed over both
 * kinds of line, which a pivot derives correctly on its own.
 */
const HEADERS = [
  'Storage ID',
  'Product',
  'Category',
  'Unit',
  'Holding',
  'Zone',
  'Compartment',
  'Quantity',
  'Reserved',
  'Quarantined',
  'Available',
  'Status',
] as const;

const SHELF = 'Shelf';
const ON_LOAN = 'On loan';

/** A product holding nothing still has to appear — see the note in `ReportsRepository.inventory`. */
function csvRowsFor(row: InventoryReportRow): string[] {
  const common = [
    csvField(row.productCode),
    csvField(row.name),
    csvField(row.categoryName ?? ''),
    csvField(row.unit),
  ];
  const status = row.isActive ? 'Active' : 'Deactivated';

  const shelf = row.placements.map((placement) =>
    [
      ...common,
      SHELF,
      csvField(placement.zoneName),
      csvField(placement.compartmentName),
      placement.quantity,
      placement.reserved,
      placement.quarantined,
      placement.quantity - placement.reserved - placement.quarantined,
      status,
    ].join(','),
  );

  /*
   * Borrowed stock has left its compartment, so it has no zone and no shelf — but it is still
   * owned, and a stock file that omits it understates the company's holdings. It cannot be
   * issued to anyone else while it is out, so Available is 0.
   */
  const loan =
    row.totalOnLoan > 0
      ? [[...common, ON_LOAN, '', '', row.totalOnLoan, 0, 0, 0, status].join(',')]
      : [];

  if (shelf.length === 0 && loan.length === 0) {
    return [[...common, SHELF, '', '', 0, 0, 0, 0, status].join(',')];
  }

  return [...shelf, ...loan];
}

/**
 * One line per **placement**, not per product.
 *
 * A spreadsheet is going to be filtered and pivoted, and a nested breakdown does not survive
 * either. Flat rows repeat the product columns, which is the shape a pivot table wants and the
 * shape someone counting a single shelf can filter down to.
 */
export function inventoryReportToCsv(report: InventoryReport): string {
  const lines = [HEADERS.join(','), ...report.rows.flatMap(csvRowsFor)];

  lines.push(
    [
      csvField('TOTAL'),
      csvField(`${report.totals.productCount} products`),
      '',
      '',
      '',
      '',
      '',
      // Quantity across both kinds of line: on a shelf plus out with borrowers. This is the
      // owned figure, and it reconciles with "Total owned" on the products list.
      report.totals.totalOwned,
      report.totals.totalReserved,
      report.totals.totalQuarantined,
      report.totals.totalAvailable,
      '',
    ].join(','),
  );

  return lines.join('\n');
}

/**
 * The printed copy. Grouped by product with its locations indented underneath, because this one
 * is read by a person walking a store room rather than pivoted in a spreadsheet.
 */
export function inventoryReportToHtml(report: InventoryReport, timeZone: string): string {
  const body = report.rows
    .map((row) => {
      const shelfRows =
        row.placements.length === 0
          ? row.totalOnLoan > 0
            ? '' // Entirely out with borrowers; the loan line below says so.
            : `<tr class="placement empty"><td colspan="7">Held in no compartment</td></tr>`
          : row.placements
              .map(
                (placement) => `
                <tr class="placement">
                  <td>${escapeHtml(placement.zoneName)} / ${escapeHtml(placement.compartmentName)}</td>
                  <td class="num dim">&mdash;</td>
                  <td class="num">${placement.quantity}</td>
                  <td class="num dim">&mdash;</td>
                  <td class="num">${placement.reserved}</td>
                  <td class="num">${placement.quarantined}</td>
                  <td class="num">${placement.quantity - placement.reserved - placement.quarantined}</td>
                </tr>`,
              )
              .join('');

      /*
       * Borrowed stock has no compartment, so without a line of its own the breakdown under a
       * product would not add up to the product's own total — the reader is left asking where
       * the rest went. This is that line.
       */
      const loanRow =
        row.totalOnLoan > 0
          ? `<tr class="placement loan">
               <td>With borrowers</td>
               <td class="num dim">&mdash;</td>
               <td class="num dim">&mdash;</td>
               <td class="num">${row.totalOnLoan}</td>
               <td class="num dim">&mdash;</td>
               <td class="num dim">&mdash;</td>
               <td class="num dim">&mdash;</td>
             </tr>`
          : '';

      return `
        <tr class="product">
          <td>
            <strong>${escapeHtml(row.name)}</strong>
            <span class="code">${escapeHtml(row.productCode)}</span>
            ${row.categoryName ? `<span class="cat">${escapeHtml(row.categoryName)}</span>` : ''}
            ${row.isActive ? '' : '<span class="inactive">deactivated</span>'}
          </td>
          <td class="num"><strong>${row.totalOwned}</strong></td>
          <td class="num">${row.totalQuantity}</td>
          <td class="num">${row.totalOnLoan}</td>
          <td class="num">${row.totalReserved}</td>
          <td class="num">${row.totalQuarantined}</td>
          <td class="num"><strong>${row.totalAvailable}</strong></td>
        </tr>
        ${shelfRows}
        ${loanRow}`;
    })
    .join('');

  // The business's own zone, so a report printed from a UTC server still reads as the local
  // moment to whoever receives the paper copy.
  const stamp = new Date(report.generatedAt).toLocaleString('en-GB', { timeZone });

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Inventory report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #111; }
          h1 { font-size: 18px; margin: 0 0 4px 0; }
          .meta { font-size: 11px; color: #555; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          thead th { text-align: left; border-bottom: 1px solid #444; padding: 6px; }
          td { padding: 5px 6px; }
          tr.product td { border-top: 1px solid #bbb; }
          tr.placement td { color: #555; font-size: 10px; padding-left: 18px; }
          tr.placement.empty td { font-style: italic; color: #888; }
          tr.placement.loan td { font-style: italic; }
          .dim { color: #bbb; }
          .num { text-align: right; font-variant-numeric: tabular-nums; }
          .code { color: #666; font-family: monospace; margin-left: 6px; }
          .cat { color: #666; margin-left: 6px; }
          .inactive { color: #a00; margin-left: 6px; }
          tfoot td { border-top: 2px solid #444; font-weight: 600; padding: 6px; }
          .footnote { margin-top: 14px; font-size: 10px; color: #666; }
        </style>
      </head>
      <body>
        <h1>Inventory report</h1>
        <p class="meta">${report.totals.productCount} products · generated ${escapeHtml(stamp)}</p>
        <table>
          <thead>
            <tr>
              <th>Product / location</th>
              <th class="num">Owned</th>
              <th class="num">On shelf</th>
              <th class="num">On loan</th>
              <th class="num">Reserved</th>
              <th class="num">Quarantined</th>
              <th class="num">Available</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td class="num">${report.totals.totalOwned}</td>
              <td class="num">${report.totals.totalQuantity}</td>
              <td class="num">${report.totals.totalOnLoan}</td>
              <td class="num">${report.totals.totalReserved}</td>
              <td class="num">${report.totals.totalQuarantined}</td>
              <td class="num">${report.totals.totalAvailable}</td>
            </tr>
          </tfoot>
        </table>
        <p class="footnote">
          <strong>Owned</strong> is everything the company is responsible for: what is on a shelf
          plus what is out with borrowers. <strong>On loan</strong> is issued and not yet
          returned, so it sits in no compartment and is listed against the product rather than a
          location. <strong>Available</strong> is on-shelf stock less reserved and quarantined:
          reserved stock is committed to a borrow request and quarantined stock is physically
          present but unserviceable, so neither can be issued.
          Stock moves, so this report is only true as at the time above.
        </p>
      </body>
    </html>`;
}
