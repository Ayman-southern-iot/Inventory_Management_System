import type { BomDetail, BomLine, RequisitionFootprints } from '@ims/shared';

/**
 * Renders a `BomDetail` to the HTML that the PDF renderer will turn into the document
 * Accounts files. Pure: no DB, no filesystem, no `Date.now()` — the function takes the
 * already-frozen `generatedAt` and `voidedAt` from the detail and the `letterheadUri`
 * (or null) from the renderer.
 *
 * The frozen `sources[].footprints` block is what task 4.2 pinned: a BOM printed in July
 * must still show July's names and designations, even after somebody has been promoted or
 * left. The template reads only the snapshot, never `users` live.
 */
export function renderBomHtml(
  detail: BomDetail,
  letterheadUri: string | null,
): string {
  const approvedTotal = detail.sources.reduce(
    (sum, source) => sum + (source.approvedAmount ?? 0),
    0,
  );
  const variance = detail.subtotal - approvedTotal;
  const variancePct =
    approvedTotal === 0
      ? 'n/a'
      : `${variance > 0 ? '+' : ''}${((variance / approvedTotal) * 100).toFixed(1)}%`;

  const departmentNames = unique(
    detail.sources.map((s) => s.departmentName).filter((name): name is string => name !== null),
  );
  const requisitionsList = detail.requisitionNos.length === 0
    ? '—'
    : detail.requisitionNos.map(escape).join(', ');
  const departmentsText = departmentNames.length === 0 ? '—' : departmentNames.map(escape).join(', ');

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escape(detail.bomNo)}</title>`,
    `<style>${bomStyles(letterheadUri !== null)}</style>`,
    '</head><body>',
    renderHeader(
      detail,
      letterheadUri,
      approvedTotal,
      variance,
      variancePct,
      requisitionsList,
      departmentsText,
    ),
    renderVoidBanner(detail),
    '<h2>Items</h2>',
    detail.sources.map((source) => renderSource(source, detail.lines)).join('\n'),
    '<h2>Approval chain (frozen at generation)</h2>',
    detail.sources.map(renderSourceFootprints).join('\n'),
    renderFooter(),
    '</body></html>',
  ].join('\n');
}

/* ------------------------------------------------------------- header */

function renderHeader(
  detail: BomDetail,
  letterheadUri: string | null,
  approvedTotal: number,
  variance: number,
  variancePct: string,
  requisitionsList: string,
  departmentsText: string,
): string {
  return [
    '<header>',
    letterheadUri !== null
      ? `<img class="letterhead" src="${letterheadUri}" alt="">`
      : '<div class="letterhead-placeholder">Letterhead not configured</div>',
    '<table class="meta">',
    `  <tr><th>BOM number</th><td>${escape(detail.bomNo)}</td></tr>`,
    `  <tr><th>Generated</th><td>${escape(formatDate(detail.generatedAt))} by ${escape(detail.generatedByName)}</td></tr>`,
    `  <tr><th>Source requisition(s)</th><td>${requisitionsList}</td></tr>`,
    `  <tr><th>Department(s)</th><td>${departmentsText}</td></tr>`,
    `  <tr><th>Total approved</th><td class="num">${escape(formatBdt(approvedTotal))}</td></tr>`,
    `  <tr><th>Subtotal (this BOM)</th><td class="num">${escape(formatBdt(detail.subtotal))}</td></tr>`,
    `  <tr><th>Variance</th><td class="num">${escape(formatBdt(variance))} (${escape(variancePct)})</td></tr>`,
    '</table>',
    '</header>',
  ].join('\n');
}

function renderVoidBanner(detail: BomDetail): string {
  if (!detail.isVoid) return '';
  return [
    '<div class="void-banner">',
    '  <strong>VOID</strong> &mdash; ',
    `  Reason: ${escape(detail.voidReason ?? '')}. `,
    detail.voidedAt !== null ? `Voided ${escape(formatDate(detail.voidedAt))}` : '',
    detail.voidedByName !== null ? ` by ${escape(detail.voidedByName)}` : '',
    '</div>',
  ].join('\n');
}

/* ------------------------------------------------------------ per-source */

function renderSource(source: RequisitionFootprints, allLines: BomLine[]): string {
  // A line belongs to a source if its `requisitionNo` matches the source's. This is the
  // explicit join we have in the contract — `bom_lines.requisition_no` is denormalised
  // precisely so the template does not need to re-join the requisition table.
  const lines = allLines.filter((line) => line.requisitionNo === source.requisitionNo);

  return [
    '<section class="source">',
    `  <h3>${escape(source.requisitionNo)} &mdash; ${escape(source.requesterName)}`,
    source.departmentName !== null
      ? ` <span class="muted">(${escape(source.departmentName)})</span>`
      : '',
    '</h3>',
    `  <p class="muted">Approved amount: ${escape(formatBdt(source.approvedAmount ?? 0))}</p>`,
    lines.length === 0
      ? '  <p class="muted">No items.</p>'
      : [
          '  <table class="lines"><thead><tr>',
          '    <th>#</th><th>Item</th><th class="num">Qty</th>',
          '    <th class="num">Unit cost</th><th class="num">Total</th>',
          '    <th>Vendor</th><th>Purpose</th><th>Project</th>',
          '  </tr></thead><tbody>',
          ...lines.map((line, index) => renderLineRow(line, index)),
          '  </tbody></table>',
        ].join('\n'),
    '</section>',
  ].join('\n');
}

function renderLineRow(line: BomLine, index: number): string {
  return [
    '    <tr>',
    `<td>${index + 1}</td>`,
    `<td>${escape(line.itemName)}</td>`,
    `<td class="num">${line.quantity}</td>`,
    `<td class="num">${escape(formatBdt(line.unitCost))}</td>`,
    `<td class="num">${escape(formatBdt(line.totalCost))}</td>`,
    `<td>${escape(line.vendor ?? '—')}</td>`,
    `<td>${escape(line.purpose ?? '—')}</td>`,
    `<td>${escape(line.projectName ?? '—')}</td>`,
    '    </tr>',
  ].join('');
}

function renderSourceFootprints(source: RequisitionFootprints): string {
  if (source.footprints.length === 0) return '';
  return [
    '<section class="footprints">',
    `  <h3>${escape(source.requisitionNo)} — approval chain</h3>`,
    '  <table class="footprints"><thead><tr>',
    '    <th>Stage</th><th>Slot</th><th>Name</th><th>Designation</th>',
    '    <th>Acted at</th><th>On behalf of</th>',
    '  </tr></thead><tbody>',
    ...source.footprints.map((f) =>
      [
        '    <tr>',
        `<td>${escape(f.stage)}</td>`,
        `<td>${f.slot === null ? '—' : String(f.slot)}</td>`,
        `<td>${escape(f.name)}</td>`,
        `<td>${escape(f.designation)}</td>`,
        `<td>${escape(f.actedAt === null ? '—' : formatDate(f.actedAt))}</td>`,
        `<td>${escape(f.onBehalfOf ?? '—')}</td>`,
        '    </tr>',
      ].join(''),
    ),
    '  </tbody></table>',
    '</section>',
  ].join('\n');
}

function renderFooter(): string {
  return '<footer class="muted">Generated by Southern IoT</footer>';
}

/* ------------------------------------------------------------ formatting */

const BDT = new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 });

function formatBdt(value: number): string {
  try {
    return BDT.format(value);
  } catch {
    // Some Node builds lack en-BD currency data; fall back to a sensible prefix.
    return `৳${value.toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* -------------------------------------------------------------- styles */

function bomStyles(hasLetterhead: boolean): string {
  // Page format, margins, orientation all come from the renderer config — not here.
  return `
    body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 11pt; color: #222; }
    h1, h2, h3 { margin-bottom: 4pt; }
    h1 { font-size: 16pt; }
    h2 { font-size: 13pt; margin-top: 14pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; }
    h3 { font-size: 11pt; margin-top: 10pt; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 6pt; }
    th, td { padding: 4pt 6pt; border-bottom: 1px solid #e0e0e0; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; font-weight: 600; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .meta th { width: 30%; background: transparent; border: none; font-weight: 600; }
    .meta td { border: none; }
    .muted { color: #666; font-size: 10pt; }
    .letterhead { display: block; max-width: 100%; max-height: 80pt; margin-bottom: 8pt; object-fit: contain; }
    .letterhead-placeholder { padding: 8pt 12pt; border: 1px dashed #999; color: #666; margin-bottom: 8pt; font-style: italic; }
    .void-banner { padding: 8pt 12pt; border: 2px solid #b00020; background: #fff0f0; color: #b00020; margin-bottom: 8pt; }
    footer { margin-top: 16pt; font-size: 9pt; }
    section.source { page-break-inside: avoid; }
    ${hasLetterhead ? '' : 'header { margin-top: 0; }'}
  `;
}