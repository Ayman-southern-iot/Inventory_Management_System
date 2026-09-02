import type { BomDetail, BomLine, RequisitionFootprints } from '@ims/shared';
import { amountInWords } from '../../common/amount-in-words';

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
  /**
   * Facts first, then the reason, then the money — three blocks rather than one list of seven
   * label/value rows.
   *
   * A requisition reason runs to a paragraph, and sitting it in a two-column grid beside
   * "Department" squeezed it into a third of the page. The approved amount had the opposite
   * problem: the one figure Accounts pays against, indistinguishable from the project name
   * above it.
   */
  const facts: Array<[string, string]> = [
    ['BOM Number', detail.bomNo],
    ['Requisition From', source.requesterName],
    ['Date', formatDate(detail.generatedAt)],
    ['Department', source.departmentName ?? '—'],
    ['Project', source.projectName ?? '—'],
    ['Reference', source.requisitionNo],
  ];

  return [
    '<section class="source-block">',
    '<table class="header-block">',
    ...facts.map(
      ([label, value]) =>
        `  <tr><th>${escape(label)}</th><td>${escape(value)}</td></tr>`,
    ),
    '</table>',

    // The reason, given room to be a paragraph.
    '<div class="desc-block">',
    '  <div class="section-label">Description</div>',
    `  <div class="desc-body">${escape(source.description ?? '—')}</div>`,
    '</div>',

    /**
     * One money figure on the document, and it is the approved one. Ayman's ruling, 2026-08-29:
     * "bom will only show the approved money so that no confusion will occur".
     *
     * This reverses OQ-18, which added a "Remaining" line — requested minus approved — so the
     * reader could see what the approvers had trimmed. The reasoning was sound for somebody
     * auditing the approval; it is wrong for the person this document is actually for. The BOM
     * goes to Accounts to be paid against, and printing three figures where one is payable
     * invites the wrong one being read. The requested and remaining amounts are still on the
     * requisition, which is where the approval story belongs.
     *
     * Safe to be the only figure because a BOM can no longer commit more than this: the
     * approved-amount ceiling refuses generation above it (`BOM_EXCEEDS_APPROVED_AMOUNT`), so
     * the grand total below is guaranteed to be at or under the figure printed here.
     */
    '<div class="approved-summary">',
    '  <div class="fin-label">Approved amount</div>',
    `  <div class="fin-value">${escape(money(source.approvedAmount))}</div>`,
    '</div>',
    '</section>',
  ].join('\n');
}

/* -------------------------------------------------------------- items */

function renderItems(detail: BomDetail): string {
  if (detail.lines.length === 0) {
    return '<p class="muted">No items on this BOM.</p>';
  }

  // Per-source transportation line above the totals. Only sources that actually carry a
  // transportation cost get a row; otherwise the PDF keeps the same compact single-Subtotal
  // block. The description is truncated to 60 chars in the PDF — the full text is in the
  // snapshot and on the requisition detail.
  //
  // The grand total must reconcile against the header's "Total Money Requested / Approved" —
  // both already include transportation, so the bottom number has to as well. `detail.subtotal`
  // is the items-only sum (what `POST /boms` line totals write), so we add the per-source
  // transportation on top. The breakdown prints three rows when transportation exists
  // (Items subtotal / Transportation / Grand total) and one row when it does not (Subtotal).
  // The transportation row sits *between* items subtotal and grand total so the eye travels
  // from itemised cost → rolled-up travel → what Accounts pays — the order the operator
  // asked for.
  const transportationSources = detail.sources.filter(
    (source) => source.transportationCost !== null && source.transportationCost > 0,
  );
  const transportationRows = transportationSources.map((source) => {
    const description = (source.transportationDescription ?? '').trim();
    const truncated = description.length > 60 ? `${description.slice(0, 57)}…` : description;
    return [
      '    <tr class="transportation">',
      `      <td colspan="3" class="transportation-source">Transportation</td>`,
      `      <td colspan="1" class="transportation-description">${escape(truncated)}</td>`,
      `      <td class="num">${escape(money(source.transportationCost))}</td>`,
      '    </tr>',
    ].join('\n');
  });
  const transportationTotal = transportationSources.reduce(
    (sum, source) => sum + (source.transportationCost ?? 0),
    0,
  );
  const grandTotal = detail.subtotal + transportationTotal;

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
          '    <tr>',
          '      <td colspan="4" class="total-label">Items subtotal</td>',
          `      <td class="num total-subtotal">${escape(money(detail.subtotal))}</td>`,
          '    </tr>',
          ...transportationRows,
          '    <tr>',
          '      <td colspan="4" class="total-label">Grand total</td>',
          `      <td class="num total-grand">${escape(money(grandTotal))}</td>`,
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
    /**
     * The total again, in words.
     *
     * This is the document Accounts pays against, and digits on a printout can be altered with
     * a pen while a misplaced comma is invisible. The words are here to disagree loudly when
     * either happens. Bangladeshi grouping — lakh and crore — because that is how the people
     * checking it count.
     */
    `<p class="amount-words"><span class="amount-words-label">In words:</span> ${escape(
      amountInWords(grandTotal),
    )}</p>`,
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
  /**
   * Page format, margins and orientation all come from the renderer config — never from here.
   * There is deliberately no `@page` rule. A margin hardcoded here would fight the one
   * Puppeteer is given and win silently, and the paper is not fixed: this prints on plain
   * white A4 today (OQ-34), but `PDF_MARGIN_*_MM` is what lets it move onto a pre-printed pad
   * without touching this file.
   *
   * Modelled on `bom_template.html`.
   */
  return `
    body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 10.5pt; color: #1B1A17; }

    header.letterhead {
      display: flex; align-items: center; gap: 14pt;
      padding-bottom: 8pt; margin-bottom: 12pt; border-bottom: 2pt solid #1B1A17;
    }
    header.letterhead .logo { max-height: 52pt; max-width: 150pt; object-fit: contain; }
    header.letterhead .logo-missing { width: 0; }
    header.letterhead .company { font-size: 15pt; font-weight: 700; letter-spacing: 0.2pt; }
    header.letterhead .address { font-size: 9pt; color: #6B6862; line-height: 1.35; }

    h1 { font-size: 13pt; margin: 0 0 8pt; text-transform: uppercase; letter-spacing: 0.6pt; }

    .section-label {
      font-size: 8pt; font-weight: 700; letter-spacing: 0.9pt; text-transform: uppercase;
      color: #A39D91; margin-bottom: 4pt;
    }

    /* Two columns of label/value, so six fields cost far less vertical space than six rows. */
    table.header-block {
      width: 100%; border-collapse: collapse; margin-bottom: 12pt;
    }
    table.header-block th, table.header-block td {
      padding: 1.5pt 6pt 1.5pt 0; text-align: left; vertical-align: top; border: none;
      font-size: 10pt;
    }
    table.header-block th { width: 33%; font-weight: 600; color: #6B6862; }

    /* The reason, given room to be a paragraph rather than squeezed beside a department name. */
    .desc-block { margin-bottom: 8pt; }
    .desc-body {
      font-size: 10pt; line-height: 1.5; background: #F7F5F0;
      border: 0.5pt solid #E4DFD3; border-left: 2.5pt solid #1F3A52;
      padding: 7pt 10pt; white-space: pre-wrap; word-break: break-word;
    }

    /* The one figure Accounts pays against, given the weight that says so. */
    .approved-summary {
      display: flex; justify-content: space-between; align-items: center;
      background: #E7EDF1; border-radius: 5pt; padding: 8pt 12pt; margin-bottom: 10pt;
    }
    .approved-summary .fin-label {
      font-size: 8.5pt; font-weight: 700; letter-spacing: 0.7pt; text-transform: uppercase;
      color: #16293A;
    }
    .approved-summary .fin-value {
      font-size: 15pt; font-weight: 700; color: #16293A;
      font-variant-numeric: tabular-nums;
    }

    table.items { width: 100%; border-collapse: collapse; margin-bottom: 10pt; }
    table.items th, table.items td {
      padding: 5pt 6pt; text-align: left; vertical-align: top;
      border-bottom: 0.5pt solid #E4DFD3;
    }
    table.items thead th {
      border-bottom: 1pt solid #1B1A17; font-weight: 700; font-size: 8.5pt;
      text-transform: uppercase; letter-spacing: 0.5pt; color: #6B6862;
    }
    table.items .idx { width: 22pt; color: #A39D91; }
    table.items .item-name { font-weight: 600; }
    table.items .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.items tfoot td { border-bottom: none; border-top: 1pt solid #1B1A17; font-weight: 700; }
    table.items .total-label { text-align: right; }
    /* The grand total carries the heaviest rule on the page — Accounts reads the bottom
       number, so the weight signals which figure that is. */
    table.items tfoot tr td.total-grand {
      border-top: 1.5pt double #1B1A17; font-size: 12pt; color: #16293A;
    }

    /* Transportation: a line between the items and the totals, itemising the carriage per
       source. Distinct from the items so it does not read as one of them. */
    table.items tr.transportation td { font-size: 9.5pt; color: #6B6862; }
    table.items tr.transportation .transportation-source { font-weight: 600; }
    table.items tr.transportation .transportation-description { font-style: italic; color: #A39D91; }

    /* The amount in words sits directly under the table it restates, tied to it visually so
       nobody reads it as a separate note. */
    p.amount-words {
      margin: 8pt 0 0;
      font-size: 9.5pt;
      font-style: italic;
      color: #3A3833;
      border-top: 0.5pt solid #E4DFD3;
      padding-top: 6pt;
    }
    p.amount-words .amount-words-label { font-style: normal; font-weight: 700; color: #1B1A17; }

    /* 24pt of separation, on top of the 42pt that the signature-area already reserves above the
       line for the ink itself. This was 48pt, which put 64px of blank between the total and the
       signatures on an 839px page — enough to cost two item rows, to guard against an overlap
       the reserve above already prevents. 22pt was the original and did overlap, because there
       was no reserve then. */
    section.signatures { margin-top: 24pt; }
    .signature-row { display: flex; gap: 18pt; flex-wrap: wrap; }
    .signature-cell { flex: 1 1 150pt; max-width: 200pt; }
    /* Fixed height whether or not an image lands, so signed and unsigned cells align. */
    .signature-area { height: 42pt; display: flex; align-items: flex-end; }
    .signature-image { max-height: 40pt; max-width: 100%; object-fit: contain; }
    .signature-line { border-bottom: 0.75pt solid #1B1A17; margin-bottom: 4pt; }
    .signature-name { font-weight: 700; font-size: 10pt; }
    .signature-designation { font-size: 9pt; color: #6B6862; }
    .signature-approved { font-size: 9.5pt; font-weight: 700; margin-top: 2pt; color: #2E6A4C; }
    .signature-behalf { font-size: 8.5pt; color: #A39D91; font-style: italic; }
    .signature-date { font-size: 9pt; color: #6B6862; margin-top: 3pt; }

    .void-banner {
      padding: 7pt 10pt; border: 1.5pt solid #AE3A34; background: #FAEAE7; color: #AE3A34;
      font-weight: 700; margin-bottom: 12pt; letter-spacing: 0.4pt;
    }
    .muted { color: #A39D91; font-size: 8.5pt; }
    footer {
      margin-top: 20pt; padding-top: 6pt; border-top: 0.5pt solid #E4DFD3;
      font-size: 8.5pt; color: #A39D91;
    }

    /**
     * Pagination.
     *
     * Without these a long BOM is one table crammed onto page one: Chromium will break it,
     * but it breaks rows through the middle and the column headings never appear again, so
     * page three is a wall of unlabelled numbers on a document somebody pays against.
     *
     * table-header-group repeats the headings on every page the table continues onto, and
     * page-break-inside avoid on a row keeps an item whole. The blocks listed after it are
     * (no backticks in here: this is inside a template literal and one would end it)
     * each meaningless split in half — half a signature reads as a tampered document.
     */
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    table.items { page-break-inside: auto; }
    header.letterhead,
    table.header-block,
    .desc-block,
    .approved-summary,
    p.amount-words,
    section.signatures,
    .signature-cell,
    .void-banner,
    footer { page-break-inside: avoid; break-inside: avoid; }
  `;
}
