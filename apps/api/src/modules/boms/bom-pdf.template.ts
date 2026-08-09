import type { BomDetail, BomLine, RequisitionFootprints } from '@ims/shared';

/**
 * Renders a `BomDetail` to the HTML the PDF renderer turns into the document Accounts files.
 *
 * Pure: no DB, no filesystem, no `Date.now()`. Everything time- or file-dependent is resolved by
 * the caller and passed in — the frozen `generatedAt`/`voidedAt` from the detail, the company
 * identity from config, and the signature images already read from disk.
 *
 * `sources[].footprints` is the snapshot task 4.2 pinned: a BOM printed in July must still show
 * July's names and designations after somebody is promoted or leaves, so the template reads only
 * the snapshot and never `users` live.
 *
 * **Layout brief (operator, 2026-07-30):** the first version was congested — a meta table, a
 * per-source section, a line table carrying vendor/purpose/project, and a dense footprints table
 * of stage/slot/designation/acted-at/on-behalf-of. This one prints a letterhead, nine header
 * fields, one clean item table, and a signature block. Working detail that belongs on screen was
 * removed from the page Accounts signs.
 */

export interface CompanyIdentity {
  name: string;
  addressLines: readonly string[];
  /** Data URI, or null when no logo is configured. */
  logoUri: string | null;
}

export interface BomRenderContext {
  company: CompanyIdentity;
  /**
   * Signature images by `stored_files.id`, already read and base64-encoded by the service. A
   * missing entry renders as a blank signature line rather than a broken image — a document is
   * better incomplete than obviously broken.
   */
  signatureUris: Readonly<Record<string, string>>;
}

export function renderBomHtml(detail: BomDetail, context: BomRenderContext): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escape(detail.bomNo)}</title>`,
    `<style>${bomStyles()}</style>`,
    '</head><body>',
    renderLetterhead(context.company),
    renderVoidBanner(detail),
    '<h1>Bill of Materials</h1>',
    detail.sources.map((source) => renderHeaderBlock(detail, source)).join('\n'),
    renderItems(detail),
    renderSignatures(detail, context),
    renderFooter(context.company),
    '</body></html>',
  ].join('\n');
}

/* --------------------------------------------------------- letterhead */

function renderLetterhead(company: CompanyIdentity): string {
  return [
    '<header class="letterhead">',
    company.logoUri !== null
      ? `  <img class="logo" src="${company.logoUri}" alt="">`
      : '  <div class="logo-missing"></div>',
    '  <div class="identity">',
    `    <div class="company">${escape(company.name)}</div>`,
    ...company.addressLines.map((line) => `    <div class="address">${escape(line)}</div>`),
    '  </div>',
    '</header>',
  ].join('\n');
}

/* ------------------------------------------------------- header block */

/**
 * The nine fields the operator specified, in their order. One block per source requisition,
 * because a batched BOM has a different requester, department and project per source and
 * collapsing them into a comma-joined list is what made the old version unreadable.
 */
function renderHeaderBlock(detail: BomDetail, source: RequisitionFootprints): string {
  const rows: Array<[string, string]> = [
    ['BOM Number', detail.bomNo],
    ['Requisition From', source.requesterName],
    ['Date', formatDate(detail.generatedAt)],
    ['Department', source.departmentName ?? '—'],
    ['Project', source.projectName ?? '—'],
    ['Description', source.description ?? '—'],
    ['Total Money Requested', money(source.requestedAmount)],
    ['Approved Money', money(source.approvedAmount)],
    // OQ-18: what the approvers did not sanction. Requested 15,000 approved 10,000 leaves 5,000.
    ['Remaining', money(source.remainingAmount)],
  ];

  return [
    '<table class="header-block">',
    ...rows.map(
      ([label, value]) =>
        `  <tr><th>${escape(label)}</th><td>${escape(value)}</td></tr>`,
    ),
    '</table>',
  ].join('\n');
}

/* -------------------------------------------------------------- items */

function renderItems(detail: BomDetail): string {
  if (detail.lines.length === 0) {
    return '<p class="muted">No items on this BOM.</p>';
  }

  // Per-source transportation line above the subtotal. Only sources that actually carry a
  // transportation cost get a row; otherwise the PDF keeps the same compact subtotal block.
  // The description is truncated to 60 chars in the PDF — the full text is in the snapshot
  // and on the requisition detail.
  const transportationRows = detail.sources
    .filter((source) => source.transportationCost !== null && source.transportationCost > 0)
    .map((source) => {
      const description = (source.transportationDescription ?? '').trim();
      const truncated = description.length > 60 ? `${description.slice(0, 57)}…` : description;
      return [
        '    <tr class="transportation">',
        `      <td colspan="3" class="transportation-source">${escape(source.requisitionNo)} — Transportation</td>`,
        `      <td colspan="1" class="transportation-description">${escape(truncated)}</td>`,
        `      <td class="num">${escape(money(source.transportationCost))}</td>`,
        '    </tr>',
      ].join('\n');
    });

  return [
    '<table class="items">',
    '  <thead><tr>',
    '    <th class="idx">#</th><th>Item</th>',
    '    <th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Amount</th>',
    '  </tr></thead>',
    '  <tbody>',
    ...detail.lines.map((line, index) => renderItemRow(line, index)),
    '  </tbody>',
    ...(transportationRows.length > 0
      ? [
          '  <tfoot>',
          ...transportationRows,
          '    <tr>',
          '      <td colspan="4" class="total-label">Subtotal</td>',
          `      <td class="num total">${escape(money(detail.subtotal))}</td>`,
          '    </tr>',
          '  </tfoot>',
        ]
      : [
          '  <tfoot><tr>',
          '    <td colspan="4" class="total-label">Subtotal</td>',
          `    <td class="num total">${escape(money(detail.subtotal))}</td>`,
          '  </tr></tfoot>',
        ]),
    '</table>',
  ].join('\n');
}

function renderItemRow(line: BomLine, index: number): string {
  const amount = line.unitCost * line.quantity;
  return [
    '    <tr>',
    `      <td class="idx">${index + 1}</td>`,
    `      <td>${escape(line.itemName)}</td>`,
    `      <td class="num">${line.quantity}</td>`,
    `      <td class="num">${escape(money(line.unitCost))}</td>`,
    `      <td class="num">${escape(money(amount))}</td>`,
    '    </tr>',
  ].join('\n');
}

/* --------------------------------------------------------- signatures */

/**
 * One cell per approver, in chain order.
 *
 * Every cell prints the name and the word **Approved** — whether or not a signature was applied.
 * Approving without signing is a deliberate choice (task 5.2), so the document must not imply the
 * approval is somehow lesser; the signature area simply stays blank for a wet signature. Both
 * variants reserve the same height so the layout does not shift between documents.
 */
function renderSignatures(detail: BomDetail, context: BomRenderContext): string {
  const footprints = detail.sources.flatMap((source) => source.footprints);
  if (footprints.length === 0) return '';

  return [
    '<section class="signatures">',
    '  <div class="signature-row">',
    ...footprints.map((footprint) => {
      const uri = footprint.signatureFileId
        ? context.signatureUris[footprint.signatureFileId]
        : undefined;
      const image =
        footprint.signedWithSignature && uri
          ? `<img class="signature-image" src="${uri}" alt="">`
          : '';
      return [
        '    <div class="signature-cell">',
        `      <div class="signature-area">${image}</div>`,
        '      <div class="signature-line"></div>',
        `      <div class="signature-name">${escape(footprint.name)}</div>`,
        `      <div class="signature-designation">${escape(footprint.designation)}</div>`,
        '      <div class="signature-approved">Approved</div>',
        footprint.onBehalfOf
          ? `      <div class="signature-behalf">for ${escape(footprint.onBehalfOf)}</div>`
          : '',
        `      <div class="signature-date">Date: ${escape(
          footprint.actedAt ? formatDateOnly(footprint.actedAt) : '',
        )}</div>`,
        '    </div>',
      ]
        .filter(Boolean)
        .join('\n');
    }),
    '  </div>',
    '</section>',
  ].join('\n');
}

/* ------------------------------------------------------- void / footer */

function renderVoidBanner(detail: BomDetail): string {
  if (!detail.isVoid) return '';
  const when = detail.voidedAt ? formatDate(detail.voidedAt) : '';
  const reason = detail.voidReason ?? '';
  return `<div class="void-banner">VOID — ${escape(when)}${reason ? ` · ${escape(reason)}` : ''}</div>`;
}

function renderFooter(company: CompanyIdentity): string {
  return `<footer class="muted">${escape(company.name)}</footer>`;
}

/* ------------------------------------------------------------ formatting */

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

/** A null amount prints as an em dash, never as ৳0.00 — "unknown" is not "zero". */
function money(value: number | null): string {
  return value === null ? '—' : formatBdt(value);
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

function formatDateOnly(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${date.getFullYear()}`;
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

function bomStyles(): string {
  // Page format, margins and orientation all come from the renderer config — never from here.
  return `
    body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 10.5pt; color: #1a1a1a; }

    header.letterhead {
      display: flex; align-items: center; gap: 14pt;
      padding-bottom: 10pt; margin-bottom: 16pt; border-bottom: 1.5pt solid #1a1a1a;
    }
    header.letterhead .logo { max-height: 52pt; max-width: 150pt; object-fit: contain; }
    header.letterhead .logo-missing { width: 0; }
    header.letterhead .company { font-size: 15pt; font-weight: 700; letter-spacing: 0.2pt; }
    header.letterhead .address { font-size: 9pt; color: #555; line-height: 1.35; }

    h1 { font-size: 13pt; margin: 0 0 10pt; text-transform: uppercase; letter-spacing: 0.6pt; }

    /* Two columns of label/value, so nine fields cost far less vertical space than nine rows. */
    table.header-block {
      width: 100%; border-collapse: collapse; margin-bottom: 14pt;
      page-break-inside: avoid;
    }
    table.header-block th, table.header-block td {
      padding: 3pt 6pt 3pt 0; text-align: left; vertical-align: top; border: none;
      font-size: 10pt;
    }
    table.header-block th { width: 33%; font-weight: 600; color: #555; }

    table.items { width: 100%; border-collapse: collapse; margin-bottom: 18pt; }
    table.items th, table.items td {
      padding: 5pt 6pt; text-align: left; vertical-align: top;
      border-bottom: 0.5pt solid #ddd;
    }
    table.items thead th {
      border-bottom: 1pt solid #1a1a1a; font-weight: 600; font-size: 9.5pt;
      text-transform: uppercase; letter-spacing: 0.3pt;
    }
    table.items .idx { width: 22pt; color: #777; }
    table.items .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.items tfoot td { border-bottom: none; border-top: 1pt solid #1a1a1a; font-weight: 700; }
    table.items .total-label { text-align: right; }

    /* Transportation: a line between the items and the Subtotal that itemizes the rolled-up
       travel cost on a per-source basis. Distinct from the items so it does not look like one
       of them. */
    table.items tr.transportation td { font-size: 9.5pt; color: #555; border-bottom: 0.5pt solid #ddd; }
    table.items tr.transportation .transportation-source { font-weight: 600; }
    table.items tr.transportation .transportation-description { font-style: italic; color: #777; }

    /* Signatures must never be split across a page break — half a signature block reads as a
       document that was tampered with. */
    section.signatures { margin-top: 22pt; page-break-inside: avoid; }
    .signature-row { display: flex; gap: 18pt; flex-wrap: wrap; }
    .signature-cell { flex: 1 1 150pt; max-width: 200pt; }
    /* Fixed height whether or not an image lands, so signed and unsigned cells align. */
    .signature-area { height: 42pt; display: flex; align-items: flex-end; }
    .signature-image { max-height: 40pt; max-width: 100%; object-fit: contain; }
    .signature-line { border-bottom: 0.75pt solid #1a1a1a; margin-bottom: 4pt; }
    .signature-name { font-weight: 600; font-size: 10pt; }
    .signature-designation { font-size: 9pt; color: #555; }
    .signature-approved { font-size: 9.5pt; font-weight: 600; margin-top: 2pt; }
    .signature-behalf { font-size: 8.5pt; color: #777; font-style: italic; }
    .signature-date { font-size: 9pt; color: #555; margin-top: 3pt; }

    .void-banner {
      padding: 7pt 10pt; border: 1.5pt solid #b00020; background: #fff0f0; color: #b00020;
      font-weight: 700; margin-bottom: 12pt; letter-spacing: 0.4pt;
    }
    .muted { color: #777; font-size: 8.5pt; }
    footer { margin-top: 20pt; padding-top: 6pt; border-top: 0.5pt solid #ddd; }
  `;
}
