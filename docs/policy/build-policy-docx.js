/* Builds the Inventory & Procurement Management Policy as a formatted .docx
 *
 * eslint-disable justified: this is a standalone Node build script run by hand, not application
 * code. It is CommonJS because it is copied next to a scratch `node_modules` to run (see
 * README.md), and its one console line is the tool's own output.
 */
/* eslint-disable @typescript-eslint/no-require-imports, no-console */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
  Header, Footer, PageNumber, convertInchesToTwip, LevelFormat,
  TableOfContents, VerticalAlign, TabStopType, PageBreak,
} = require('docx');

// Resolves when the script is run in place. Pass the repo root as argv[2] when the script is
// copied out to a scratch directory next to its node_modules: Node resolves `require` from the
// script's own path, not the cwd, so running it in place from elsewhere would not find `docx`.
// argv rather than an env var deliberately, because `process.env` is restricted repo-wide.
const REPO = process.argv[2] || path.resolve(__dirname, '../..');
const OUT = path.join(REPO, 'docs/policy/Inventory-and-Procurement-Management-Policy.docx');
const LOGO = path.join(REPO, 'apps/api/assets/letterhead/siot-logo.jpg');

const FONT = 'Calibri';
const NAVY = '1F3864';
const ACCENT = '2E5496';
const GREY = '595959';
const HAIR = 'BFBFBF';
const BAND = 'F2F5FA';

/* ----------------------------------------------------------- inline runs */
// Supports **bold**, *italic*, `mono`. Deliberately tiny; the content is ours.
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(new TextRun({ text: tok.slice(2, -2), bold: true, ...base }));
    else if (tok.startsWith('`')) out.push(new TextRun({ text: tok.slice(1, -1), font: 'Consolas', size: 18, ...base }));
    else out.push(new TextRun({ text: tok.slice(1, -1), italics: true, ...base }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

/* ------------------------------------------------------------- numbering */
const numConfigs = [];
let numSeq = 0;
function newList(kind) {
  const reference = `${kind}-${++numSeq}`;
  const levels = kind === 'bullet'
    ? [
        { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.32), hanging: convertInchesToTwip(0.18) } } } },
        { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.62), hanging: convertInchesToTwip(0.18) } } } },
      ]
    : [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.36), hanging: convertInchesToTwip(0.24) } } } },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.68), hanging: convertInchesToTwip(0.22) } } } },
      ];
  numConfigs.push({ reference, levels });
  return reference;
}

/* --------------------------------------------------------------- blocks */
const body = [];

const H1 = (t) => body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t })] }));
const H2 = (t) => body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t })] }));

const P = (t, opts = {}) => body.push(new Paragraph({
  children: runs(t),
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 140, line: 276 },
  ...opts,
}));

function OL(items) {
  const ref = newList('decimal');
  items.forEach((it) => {
    const [txt, lvl] = Array.isArray(it) ? it : [it, 0];
    body.push(new Paragraph({
      children: runs(txt),
      numbering: { reference: ref, level: lvl },
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 90, line: 276 },
    }));
  });
  body.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
}

const NOBORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const HAIRLINE = {
  top: { style: BorderStyle.SINGLE, size: 4, color: HAIR },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: HAIR },
  left: { style: BorderStyle.SINGLE, size: 4, color: HAIR },
  right: { style: BorderStyle.SINGLE, size: 4, color: HAIR },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: HAIR },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: HAIR },
};

function cell(text, { header = false, band = false, align = AlignmentType.LEFT, width } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { fill: NAVY } : band ? { fill: BAND } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: align,
      spacing: { before: 0, after: 0, line: 250 },
      children: runs(text, { size: 19, bold: header || undefined, color: header ? 'FFFFFF' : undefined }),
    })],
  });
}

function TBL(headers, rows, widths, aligns = []) {
  const al = (i) => aligns[i] || AlignmentType.LEFT;
  body.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: HAIRLINE,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, { header: true, width: widths[i], align: al(i) })),
      }),
      ...rows.map((r, ri) => new TableRow({
        children: r.map((c, i) => cell(c, { band: ri % 2 === 1, width: widths[i], align: al(i) })),
      })),
    ],
  }));
  body.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
}

/* Callout box for status notes that qualify a clause. */
function NOTE(label, text) {
  body.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
      left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { fill: 'F7F9FC' },
        margins: { top: 120, bottom: 120, left: 160, right: 140 },
        children: [new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 0, line: 264 },
          children: [
            new TextRun({ text: label + '  ', bold: true, color: ACCENT, size: 19 }),
            ...runs(text, { size: 19, color: '333333' }),
          ],
        })],
      })],
    })],
  }));
  body.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
}

/* =======================================================================
   TITLE BLOCK
   ======================================================================= */
body.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
body.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 60 },
  children: [new TextRun({ text: 'INVENTORY AND PROCUREMENT', bold: true, size: 40, color: NAVY, font: FONT })],
}));
body.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 120 },
  children: [new TextRun({ text: 'MANAGEMENT POLICY', bold: true, size: 40, color: NAVY, font: FONT })],
}));
body.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 320 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
  children: [new TextRun({ text: 'Governing the Inventory Management System (IMS)', size: 21, color: GREY, italics: true, font: FONT })],
}));

TBL(
  ['Document control', 'Detail'],
  [
    ['Document title', 'Inventory and Procurement Management Policy'],
    ['System of record', 'Inventory Management System (IMS)'],
    ['Document owner', '[To confirm. Proposed: Head of Operations]'],
    ['Approved by', '[To confirm]'],
    ['Effective from', '[To confirm]'],
    ['Version', '1.0, draft for approval'],
    ['Review cycle', 'Annually, and on any change to the expense threshold, the role model or the storage model'],
    ['Classification', 'Internal'],
    ['Applies to', 'All employees, contractors and temporary staff of Southern IoT Limited'],
  ],
  [28, 72],
);

body.push(new Paragraph({ spacing: { before: 200, after: 120 }, children: [
  new TextRun({ text: 'Contents', bold: true, size: 26, color: NAVY, font: FONT }),
] }));
body.push(new TableOfContents('Contents', { hyperlinks: true, headingStyleRange: '1-2' }));
body.push(new Paragraph({ children: [new PageBreak()] }));

/* =======================================================================
   1. PURPOSE
   ======================================================================= */
H1('1. Purpose');
P('This policy governs how Southern IoT Limited requests, approves, funds, purchases, stores, issues, returns and disposes of inventory. It exists to secure four outcomes:');
OL([
  'Every unit of procurement expenditure is traceable to a named request and to the named individuals who authorised it.',
  'Every item held in storage is traceable to a record, and every record to a physical location.',
  'No individual can both authorise a purchase and confirm its receipt without oversight.',
  'The stock position reported by the system matches the stock physically held, and any divergence becomes detectable within one working day.',
]);
P('Where this policy states a rule, the IMS enforces it, unless the clause carries the marker **(procedural)**. A procedural clause is a human obligation that the software does not and cannot verify.');

/* 2. SCOPE */
H1('2. Scope');
H2('2.1 Covered by this policy');
P('All movable assets and consumables procured with company funds and held at a company location, for any department or project.');
H2('2.2 Tracked in the IMS at present');
P('Laptops and research and development hardware. Trackability is a property of the **category**, not of the software. An Inventory Manager can bring a further category into scope by enabling its trackable flag. No database migration and no software release is required.');
H2('2.3 Not tracked at present');
P('Furniture, fixtures and consumables of negligible value. Bringing these into scope is an operational decision taken by the document owner, not a technical constraint.');
H2('2.4 Outside the scope of this policy');
P('Financial accounting, payroll, fixed asset depreciation and vendor contract management. The IMS records that money was requested, sanctioned, released and spent. It is not an accounting system and does not integrate with one.');

/* 3. DEFINITIONS */
H1('3. Definitions');
TBL(['Term', 'Meaning'], [
  ['Product', 'The catalogue entry for a kind of item. It holds one identity permanently.'],
  ['Placement', 'The quantity of one product held in one compartment. A product held in two locations has two placements.'],
  ['Zone and Compartment', 'The two level physical location model. A zone is an area; a compartment is a shelf, bin or drawer within it.'],
  ['On hand', 'The total physical quantity recorded across all placements of a product.'],
  ['Reserved', 'Quantity committed to an approved borrow request that has not yet been issued.'],
  ['Available', 'On hand less reserved. This is the only figure a requester may rely upon.'],
  ['Ledger', 'The append only record of every stock movement. It is authoritative.'],
  ['Requisition', 'A request to procure one or more items that the company does not hold.'],
  ['Borrow request', 'A request to take an item the company already holds.'],
  ['Bill of Materials (BOM)', 'The costed document the Inventory Manager submits to the accounts department.'],
  ['Inventory Manager (IM)', 'The role accountable for the catalogue, the store and the procurement record.'],
  ['BDT', 'Bangladeshi Taka. The only currency held by the system.'],
  ['Quarantine', 'Stock that is physically present but excluded from availability, pending repair or disposal.'],
], [24, 76]);

/* 4. ROLES */
H1('4. Roles and responsibilities');
P('Roles in the IMS are **additive**. Every user holds the General role, and further roles are granted in addition to it. An Inventory Manager may still borrow a tool, and an approver may still raise a requisition.');
TBL(['Role', 'Accountable for', 'Must not'], [
  ['General', 'Raising accurate requisitions and borrow requests; returning borrowed items by the expected date; reporting loss or damage without delay.', 'Not applicable.'],
  ['Approver', 'Deciding assigned requisitions before the stated deadline; sanctioning an amount they consider justified; recording a reason on every rejection.', 'Approve their own requisition. The system substitutes the next configured approver and records the substitution.'],
  ['Inventory Manager', 'Confirming that stock does not already exist before expenditure is authorised; maintaining the catalogue, zones and compartments; generating and printing BOMs; logging fund receipts; recording purchases; receiving goods into stock; issuing and receiving borrowed items; resolving quarantine.', 'Assign roles, alter settings, or act at the approver stage.'],
  ['Administrator', 'Creating users, assigning roles and designations, configuring approver slots and the expense threshold, reviewing the audit log, and managing retention.', 'Participate in the procurement workflow. Administrator is an IT and operations role, not a business role.'],
], [17, 51, 32]);
H2('4.1 Segregation of duties');
P('No individual may hold both the Approver and the Inventory Manager role unless the document owner grants a written, time bounded exception recorded under section 19. That combination would allow one person to authorise a purchase and then confirm its receipt. The system does not presently prevent the combination **(procedural)**.');
H2('4.2 Designations');
P('Every user carries a designation, being their job title. It is printed on Bills of Materials and is captured as a snapshot at the moment of generation, so that a BOM printed in July continues to show the designations that applied in July for the remainder of its life. The Administrator is responsible for keeping designations accurate.');

/* 5. ACCESS CONTROL */
H1('5. Access control');
OL([
  'Accounts are created by an Administrator only. There is no self registration.',
  'An account is created for a named individual. **Shared or generic accounts are prohibited.**',
  'The account of a departing or transferring employee is deactivated on their last working day **(procedural)**. Deactivation is a soft state, so the individual history remains intact and readable.',
  'Passwords are individual and are never disclosed to any other person, including an Administrator. An Administrator can reset a password but can never read one.',
  'The following are recorded in the audit log unconditionally and cannot be switched off by any user: successful and failed logins, password changes, session revocations, all user creation, amendment, activation and password reset actions, every settings change, every approver slot assignment or clearing, and any purge of the audit log itself.',
  '**Demonstration mode must be disabled on any instance holding live data.** Demonstration mode publishes a list of accounts, including the Administrator account, with a shared password and single click sign in on the login page. Confirming that it is disabled is a precondition of go live.',
]);

/* 6. CATALOGUE */
H1('6. Catalogue and classification');
OL([
  'A product is created **once** and retains its identity permanently. Recreating an existing product under a new name in order to work around a data problem is prohibited, because it destroys the history of the item.',
  'Every product belongs to a category. The category determines whether the product is tracked in stock, and whether it is treated by default as returnable or as consumable.',
  'Products, categories, zones and compartments are **never deleted**. They are deactivated, which removes them from selection lists while leaving them intact in every historical record. A product appearing on a three year old BOM must still resolve.',
  'Catalogue maintenance, covering naming, category assignment and deactivation, is the responsibility of the Inventory Manager. A duplicate entry is resolved by deactivating the duplicate, never by deleting it.',
]);

/* 7. STORAGE */
H1('7. Storage and physical location');
OL([
  'Storage is modelled at two levels: a **Zone**, being an area such as a room or rack bank, and a **Compartment**, being a shelf, bin or drawer within it. Both are free form, so any existing naming scheme may be adopted without alteration.',
  'Every unit of tracked stock must sit in exactly one compartment, and the compartment recorded in the IMS must be the compartment in which the item physically sits. Moving an item on the shelf without recording the corresponding movement in the system is a breach of this policy.',
  'A single product may be split across several compartments. Moving part of a holding between compartments is a supported operation and does not alter the identity of the product.',
  'Physical access to storage areas is restricted to the Inventory Manager and to persons they authorise **(procedural)**.',
]);

/* 8. STOCK INTEGRITY */
H1('8. Stock recording and integrity');
P('The clauses in this section are the foundation on which the remainder of this policy rests.');
OL([
  '**The ledger is authoritative.** Every change to stock appends one immutable ledger entry recording what moved, from where, to where, in what quantity, for what reason, by whom and at what time. Displayed quantities are a cached summary of the ledger and are not an independent figure.',
  '**Ledger entries are never amended or deleted.** An error is corrected by a compensating entry that is itself visible on the record. History is not rewritten.',
  '**All stock changes are made through the system.** Direct modification of stock data in the database is prohibited without a written exception from the document owner, recorded under section 19.',
  '**The movement types are fixed.** Every entry carries one of: Receipt, where goods enter; Move, between compartments; Issue, where goods leave; Return, where goods come back; Adjust, being a correction; and Dispose, being a write off. The type selected must reflect what actually occurred.',
  '**Reconciliation.** The sum of the ledger must equal the recorded placement quantities. This is verified automatically. Any divergence is a defect to be investigated on the same working day, and is never resolved by amending the quantity so that it agrees.',
  '**Physical stocktake.** A full count of all tracked categories is performed at least once each financial year, and a spot check of at least one zone is performed each quarter **(procedural)**. Every variance identified is recorded as an Adjust movement with a note naming the count.',
]);
P('A variance exceeding [to confirm: proposed as two per cent of the on hand quantity of a product, or any single item valued above 50,000 BDT] is escalated to the document owner before it is posted.');

/* 9. REQUISITIONS */
H1('9. Procurement requisitions');
H2('9.1 When a requisition is the correct instrument');
P('A requisition is raised only where the company does not hold the item, or does not hold a sufficient quantity of it. Where the item is in storage, the correct instrument is a borrow request under section 13. The review stage performed by the Inventory Manager exists to identify this, and is the first control on expenditure.');
H2('9.2 Contents of a requisition');
P('A requisition may contain one or more item lines. Each line carries an item name and a quantity. The requisition as a whole carries an urgency, an approval deadline, a reason, a department and a linked project.');
OL([
  'The **reason** must state the purpose of the item in terms that a person outside the requesting department can evaluate. A department name is not a reason.',
  'The **linked project** is required wherever one applies. It flows through to the BOM and is what makes project level cost reporting possible.',
  'The **department** is required, and is the basis of departmental expenditure reporting.',
  'The **urgency** is Low, Normal, High or Critical, and must reflect genuine business need. Persistent inflation of urgency is a management matter rather than a system control.',
  'The **approval deadline** must be realistic. It drives reminder notifications to approvers. It does not automatically approve or reject a requisition when it passes.',
  '**Transportation cost**, where the requester expects to incur one, is entered separately from the cost of goods so that the accounts department can see the split.',
  'Supporting documents such as quotations and specifications may be attached, and should be attached whenever the estimate is at or above the expense threshold **(procedural)**.',
]);
H2('9.3 The estimate');
P('The estimated total entered by the requester is their honest best estimate of the cost of the items. It is **frozen at the point of submission** and does not change thereafter. It is the historical record of what was asked for, and the basis on which the accuracy of the organisation estimating is measured. It also determines how many approvers the requisition requires under section 10.2. Understating an estimate in order to reduce the approval burden is a disciplinary matter, not a procedural shortcut.');
H2('9.4 Drafts and cancellation');
P('A requisition may be held as a draft indefinitely and is visible only to its author. A requester may cancel their own requisition at any point before it is approved. After approval, cancellation requires the Inventory Manager to void the associated BOM first.');

/* 10. APPROVAL */
H1('10. Approval');
H2('10.1 Sequence');
TBL(['Stage', 'What it establishes', 'Who acts'], [
  ['Draft', 'The requisition is being prepared and is visible only to its author.', 'Requester'],
  ['Inventory Manager review', 'That the company does not already hold the item. This is a stock check, not a budget check.', 'Inventory Manager'],
  ['Awaiting approval', 'That the expenditure is justified and the amount is sanctioned.', 'One or two approvers, acting in parallel'],
  ['Approved', 'The requisition is authorised and may proceed to costing.', 'System'],
  ['Rejected', 'Terminal from either approval stage. A reason is mandatory.', 'Inventory Manager or approver'],
], [24, 52, 24]);
OL([
  '**The Inventory Manager approves first.** Their approval establishes one fact only, namely that the company does not already hold the item.',
  '**Approvers then act in parallel.** There is no fixed sequence and no order of seniority. Either assigned approver may act first, and neither waits for the other.',
  '**A single rejection rejects the entire requisition.** It does not require both approvers to reject, and it rejects the whole request rather than individual lines. Approval of individual lines is deliberately not supported.',
  'A rejection **must** carry a reason. The requester is notified, and the reason is attached to that notification.',
  'Approvers can see which of the assigned approvers have not yet responded.',
]);
H2('10.2 Number of approvers required');
TBL(['Estimated total', 'Approvers required'], [
  ['Below the expense threshold', 'One, being a single designated sub threshold approver'],
  ['At or above the expense threshold', 'Two'],
], [45, 55]);
P('The **expense threshold is 15,000 BDT** on first installation. Thereafter the value is owned by the application settings table and may be changed by an Administrator at run time, without a code change and without a redeployment. The value currently in effect in the system prevails over the figure printed here.');
P('**The number of approvers is frozen at the point of submission.** Changing the threshold, or reassigning an approver slot, never redistributes a requisition already in flight. This is deliberate: a request submitted under one rule is not judged retrospectively under another.');
P('A requisition whose estimate is **exactly equal** to the threshold requires two approvers.');
H2('10.3 The sanctioned amount');
P('An approver may sanction an amount **lower** than the requested estimate. This remains an approval, and the revised figure is recorded and displayed together with the name of the approver who revised it. An approver may not sanction an amount higher than that requested; additional expenditure requires a new or revised requisition.');
H2('10.4 Self approval');
P('An approver may never approve their own requisition. Where the assignment would produce this outcome, the system substitutes the next configured approver and records the substitution against the requisition. Where no substitute is available, the requisition stops and an Administrator must assign one. It is never approved automatically, and never approved by the requester.');
H2('10.5 Delegation');
P('An approver who expects to be unavailable may nominate a delegate to act on their behalf, so that requests do not stall.');
OL([
  '**One delegation may be live per approver at any time.** A new delegation replaces the previous one.',
  'A decision taken by a delegate is recorded as the decision of that delegate, acting on behalf of the named approver. Both names remain permanently on the record.',
  'The approver turns the delegation off upon their return **(procedural)**.',
  'A delegate must themselves hold approver rights.',
]);
H2('10.6 Withdrawal and return for revision');
OL([
  'An approver may **withdraw** their approval at any point up to the generation of the BOM. Withdrawal returns the requisition to the approval stage and notifies the requester, the Inventory Manager and the other approver. Once a BOM exists, the BOM must be voided first.',
  'A requisition may be **returned for revision** rather than rejected, where the underlying intent is sound but the detail is not. Typical grounds are an incorrect quantity, a missing quotation or an unclear reason. A returned requisition goes back to the requester with the sanctioned amount cleared, and re enters the approval chain from the beginning when it is resubmitted.',
]);

/* 11. BOM */
H1('11. Bill of Materials');
OL([
  'The BOM is generated by the Inventory Manager once a requisition is fully approved. It is the document handed to the accounts department.',
  'The BOM is populated automatically with the item, quantity, purpose and linked project drawn from the requisition. The Inventory Manager enters the **unit cost** and the **vendor** for each line. The total cost is calculated.',
  '**A single BOM may draw upon several approved requisitions.** Each line carries its own purpose and project, so that a combined BOM remains legible line by line.',
  'A requisition may appear on **at most one live BOM**.',
  'Every BOM carries an **immutable snapshot** of the names and designations of the approvers who authorised it, together with the dates on which they acted. This block is never rendered from live user records, because a BOM must always show what was true at the time it was signed.',
  '**Control on excess cost.** Where the costed BOM total exceeds the sanctioned amount by more than the configured tolerance, the requisition is returned for re approval rather than proceeding to the accounts department. The Inventory Manager may not resolve an excess by amending the sanctioned amount.',
  '**Voiding.** A BOM is voided, never overwritten. Voiding returns each source requisition to the approved state and makes it selectable once more. Regeneration issues a new BOM number. A document that the accounts department may already hold is never silently replaced.',
  'The BOM is rendered as a PDF on company letterhead and is stored. The printed copy submitted to the accounts department must be that rendered PDF and never a retyped document **(procedural)**.',
]);

/* 12. FUNDS */
H1('12. Funds, purchase and receipt into stock');
H2('12.1 The three monetary figures');
P('Each requisition carries three distinct figures. They are compared with one another and are never conflated.');
TBL(['Figure', 'Set by', 'When it is set'], [
  ['Requested', 'The requester', 'Frozen at the point of submission'],
  ['Approved', 'The approval chain', 'On full approval. It defaults to the requested figure.'],
  ['Funded', 'The Inventory Manager', 'It increases with each receipt logged'],
], [22, 30, 48]);
P('The term **approved** in every report means *currently* approved. A requisition that was approved and subsequently rejected, cancelled or withdrawn does not count as approved expenditure.');
H2('12.2 Logging funds');
OL([
  'Fund receipts are logged by the Inventory Manager **against the specific requisition** and never against a BOM. Where the accounts department releases a single sum against a combined BOM, the Inventory Manager allocates it across the source requisitions.',
  '**Partial funding is normal.** A sanctioned amount of 50,000 BDT with 30,000 BDT released immediately and the balance released later is an expected pattern rather than an exception.',
  '**No notification is issued when a remaining balance arrives.** The Inventory Manager checks the requisition manually. This is deliberate and is not a defect.',
  'Where a purchase is completed below budget and money is returned to the accounts department, that return is logged against the requisition.',
]);
H2('12.3 Purchase and verification');
OL([
  'The Inventory Manager records the purchase once the goods have been ordered and paid for.',
  'The Inventory Manager then **verifies** the purchase against the invoice, being a physical check of what arrived against what was billed, and attaches the invoice. Verification is a separate step from purchase and must not be recorded in advance of the goods arriving.',
  'The goods are then **received into stock** as a Receipt movement into a named compartment. Nothing enters stock without a compartment, and nothing is recorded as received unless it is physically present.',
  'A requisition is closed once its goods are in stock and its funding is settled.',
]);

/* 13. BORROWING */
H1('13. Issuing, borrowing and returns');
H2('13.1 Requesting');
OL([
  'Any user may request an item that the company holds. The request identifies the product, the compartment, the quantity, the project for which it is required and, for a returnable item, an expected return date.',
  'A **returnable** item is expected back. A **consumable** is issued and does not return, and may not carry a return date.',
  'Raising a request **reserves** the quantity. Reserved stock is deducted from available stock immediately, so that two people cannot both be promised the last unit.',
]);
H2('13.2 Issuing');
OL([
  'The Inventory Manager approves the request and physically hands over the item. Approval and issue are a single act. Stock is not decremented on approval alone, and an item is never recorded as issued before it has left the shelf.',
  'Rejection or cancellation releases the reservation.',
]);
H2('13.3 Returns');
P('Returns are logged by the Inventory Manager at the point of physical receipt. Partial returns are supported and are expected. **The condition must be recorded on every return.** There is no default condition.');
TBL(['Condition recorded', 'Effect on stock'], [
  ['Good', 'Returns to available stock.'],
  ['Partially damaged, usable', 'Returns to available stock. The defect is recorded for the benefit of the next borrower.'],
  ['Damaged', 'Held in quarantine and excluded from availability.'],
  ['Not working', 'Held in quarantine and excluded from availability.'],
], [32, 68]);
P('Recording a damaged return as good is a breach of this policy. It is the mechanism by which unserviceable equipment is returned to general circulation.');
H2('13.4 Overdue items');
P('An item not returned by its expected date is flagged as overdue, and both the borrower and the Inventory Manager are notified daily until the item is returned or the expected date is revised. Repeated overdue items are escalated to the head of the borrower department **(procedural)**.');
H2('13.5 Loss');
P('A borrower who loses or destroys an item reports it to the Inventory Manager without delay **(procedural)**. The Inventory Manager records the loss as a disposal, with a note naming the borrower and describing the circumstances. Recovery of cost, where applicable, is a management decision taken outside this system.');

/* 14. QUARANTINE */
H1('14. Quarantine, disposal and write off');
OL([
  'Quarantined stock is **physically present but unavailable**. It remains on the books and remains visible. It is neither deleted nor silently deducted.',
  'Only the Inventory Manager resolves quarantine, and only two outcomes exist. **Release** returns the item to available stock once it has been verified as repaired or retested. **Dispose** removes the item from the books by way of a Dispose movement.',
  '**Every resolution of quarantine requires a written note.** The system does not accept an empty note. The note must state what was actually done, for example that a power supply was replaced, or that the item was beyond economic repair and was scrapped. A note reading only that the matter was resolved is not acceptable.',
  'Disposal of any item whose original unit cost exceeded [to confirm: proposed as 25,000 BDT] requires the written approval of the document owner before it is recorded **(procedural)**.',
  'Disposed stock is never recreated in order to correct a mistake. An item disposed of in error is restored by way of an Adjust movement carrying a note that explains the correction.',
]);

/* 15. ADJUSTMENTS */
H1('15. Adjustments');
OL([
  'An Adjust movement is the only sanctioned means of correcting a stock figure, and it always carries a note stating why the correction was made.',
  'Adjustments are made only by the Inventory Manager, only against a physical count or a documented error, and never in order to make a reconciliation discrepancy disappear.',
  'All adjustments appear in the audit log and are reviewed by the document owner at each stocktake **(procedural)**.',
]);

/* 16. REPORTING */
H1('16. Reporting and export');
OL([
  'Bills of Materials and inventory records can be exported as PDF for submission to the accounts department.',
  'Standard reports cover expenditure by department, expenditure by project, requisition throughput, current stock with a location breakdown, and the borrowing ledger over a date range.',
  '**There is no low stock alerting.** Reordering is a matter of human judgement exercised from the stock report. This is a deliberate scope decision and is not an omission.',
  'Reports presenting approved expenditure present currently approved expenditure, as defined in section 12.1.',
  'Any exported document leaving the company, whether to a vendor, an auditor or any other third party, requires the approval of the document owner **(procedural)**.',
]);

/* 17. RECORDS */
H1('17. Records, audit and retention');
OL([
  'The following records are **append only and are never amended or deleted**: the stock ledger, the requisition event history, and the audit log.',
  'The audit log records who did what, and when, across authentication, user administration, settings, the catalogue, approvals, funds and stock. The unconditional set listed at section 5.5 cannot be disabled by any user, including an Administrator.',
  '**Audit retention defaults to indefinite.** History is deleted only where an Administrator has deliberately selected a retention period, and that selection is itself audited. Where a period is set, the recommended minimum is [to confirm: proposed as five years, to align with statutory record keeping obligations].',
  'Disabling audit recording for an action prevents further entries being written. It does not conceal existing entries, and re enabling it does not recover what was missed while it was disabled. Disabling any audit action requires the approval of the document owner.',
  'All timestamps are recorded in the Asia/Dhaka time zone. All monetary values are recorded in BDT. The system holds no other currency.',
]);

/* 18. DATA PROTECTION */
H1('18. Data protection and continuity');
OL([
  'The IMS holds employee names, designations, departments and procurement records. It is an internal system and is not exposed to the public internet without controls.',
  '**Backups are taken daily and are held offsite.**',
  '**A restore is rehearsed before go live and at least annually thereafter.** An untested backup is not a backup.',
  'Credentials, tokens and database passwords are never recorded in this or any other document, never committed to version control, and never shared over messaging platforms **(procedural)**.',
]);
NOTE('Status.', 'Clauses 18.2 and 18.3 are obligations being brought into effect. Offsite backup is not yet in place and a restore has not yet been rehearsed. Both are prerequisites of go live and neither describes the present state of the system.');

/* 19. EXCEPTIONS */
H1('19. Exceptions, breaches and review');
OL([
  'Any exception to this policy is requested in writing, approved by the document owner, recorded with a defined scope and an expiry date, and logged in the register below.',
  'A breach is reported to the document owner and corrected by way of a compensating record. History is never rewritten. Examples of a breach include a stock movement made outside the system, use of a shared account, a damaged return recorded as good, and an item moved in the store but not in the system.',
  'This policy is reviewed annually, and on any change to the expense threshold, the role model or the storage model.',
]);
TBL(['Date', 'Exception or breach', 'Requested by', 'Approved by', 'Expires'], [
  ['', '', '', '', ''],
  ['', '', '', '', ''],
  ['', '', '', '', ''],
], [12, 40, 17, 17, 14]);

/* 20. CONFIGURATION REGISTER */
H1('20. Configuration register');
P('The values below are policy expressed as configuration. They are held in the application settings table, are changed by an Administrator at run time, and every change is audited. This register is updated whenever one of them is changed.');
TBL(['Setting', 'Meaning', 'Value at installation', 'Changed by'], [
  ['EXPENSE_THRESHOLD_BDT', 'The boundary above which two approvers are required', '15,000 BDT', 'Administrator'],
  ['SUBTHRESHOLD_APPROVER_USER_ID', 'The single approver for requisitions below the threshold', 'Not set. It must be set before the first requisition can be submitted.', 'Administrator'],
  ['APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD', 'Approvers required at or above the threshold', '2', 'Administrator'],
  ['APPROVER_SLOTS_BELOW_THRESHOLD', 'Legacy count, superseded by the named sub threshold approver', '1', 'Administrator'],
  ['AUDIT_ENABLED_ACTIONS', 'Which actions the audit log records', 'All actions', 'Administrator'],
  ['AUDIT_RETENTION_DAYS', 'How long audit history is retained', 'Indefinite', 'Administrator'],
], [30, 30, 26, 14]);
NOTE('Prerequisites before the system can process any work.', 'A newly installed system cannot process a single requisition until an Administrator has set the sub threshold approver, filled the approver slots, designated an Inventory Manager and created at least one department. Nothing can reach stock until categories, zones and compartments exist. None of these are created by the installation process.');

/* 21. APPENDIX A */
H1('Appendix A. Requisition lifecycle');
TBL(['#', 'Status', 'What has happened'], [
  ['1', 'Draft', 'The requisition is being prepared by its author.'],
  ['2', 'Inventory Manager review', 'The Inventory Manager is confirming that the company does not hold the item.'],
  ['3', 'Awaiting approval', 'One or two approvers are considering the requisition in parallel.'],
  ['4', 'Approved', 'The requisition is authorised.'],
  ['5', 'BOM generated', 'The Inventory Manager has costed it.'],
  ['6', 'Sent to accounts', 'The BOM has been handed to the accounts department.'],
  ['7', 'Funds partial or funds received', 'Money has been released, in part or in full.'],
  ['8', 'Purchased', 'The goods have been ordered and paid for.'],
  ['9', 'Purchase verified', 'The goods have been checked against the invoice.'],
  ['10', 'Stocked', 'The goods have been received into a compartment.'],
  ['11', 'Closed', 'The requisition is complete.'],
  ['', 'Rejected', 'Terminal, from either approval stage. A reason is mandatory.'],
  ['', 'Cancelled', 'Withdrawn by the requester before approval.'],
], [7, 30, 63]);

/* 22. APPENDIX B */
H1('Appendix B. Permission summary');
const C = AlignmentType.CENTER;
TBL(['Action', 'General', 'Approver', 'Inventory Manager', 'Administrator'], [
  ['Browse inventory', 'Yes', 'Yes', 'Yes', 'Yes'],
  ['Borrow and return own items', 'Yes', 'Yes', 'Yes', 'Yes'],
  ['Raise a requisition', 'Yes', 'Yes', 'Yes', 'Yes'],
  ['Approve a borrow request and mark it returned', '', '', 'Yes', ''],
  ['Maintain products, categories and locations', '', '', 'Yes', ''],
  ['Move or split stock, and resolve quarantine', '', '', 'Yes', ''],
  ['First stage requisition approval, being the stock check', '', '', 'Yes', ''],
  ['Second stage approval, and withdrawal', '', 'Yes', '', ''],
  ['Generate or void a Bill of Materials', '', '', 'Yes', ''],
  ['Log funds, record a purchase, receive into stock', '', '', 'Yes', ''],
  ['Create users, assign roles, set designations', '', '', '', 'Yes'],
  ['Configure approvers and the expense threshold', '', '', '', 'Yes'],
  ['View the audit log', '', '', '', 'Yes'],
], [40, 13, 14, 20, 13], [AlignmentType.LEFT, C, C, C, C]);

/* 23. REVISION HISTORY + SIGN OFF */
H1('Appendix C. Revision history');
TBL(['Version', 'Date', 'Author', 'Summary of change'], [
  ['1.0', '[Effective date]', '[Owner]', 'Initial issue.'],
  ['', '', '', ''],
  ['', '', '', ''],
], [12, 20, 22, 46]);

H1('Approval');
P('This policy is approved for issue and takes effect from the date recorded in the document control table.');
body.push(new Paragraph({ spacing: { before: 500, after: 0 }, children: [] }));
body.push(new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: NOBORDER,
  rows: [new TableRow({
    children: [
      new TableCell({
        width: { size: 45, type: WidthType.PERCENTAGE },
        margins: { top: 60, bottom: 60, left: 0, right: 200 },
        borders: { top: { style: BorderStyle.SINGLE, size: 6, color: '808080' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } },
        children: [
          new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: 'Name and designation', size: 19, color: GREY })] }),
          new Paragraph({ spacing: { before: 40, after: 0 }, children: [new TextRun({ text: 'Document owner', size: 19, bold: true })] }),
        ],
      }),
      new TableCell({ width: { size: 10, type: WidthType.PERCENTAGE }, borders: NOBORDER, children: [new Paragraph({ children: [] })] }),
      new TableCell({
        width: { size: 45, type: WidthType.PERCENTAGE },
        margins: { top: 60, bottom: 60, left: 0, right: 0 },
        borders: { top: { style: BorderStyle.SINGLE, size: 6, color: '808080' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } },
        children: [
          new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: 'Date', size: 19, color: GREY })] }),
          new Paragraph({ spacing: { before: 40, after: 0 }, children: [new TextRun({ text: 'Approved on behalf of Southern IoT Limited', size: 19, bold: true })] }),
        ],
      }),
    ],
  })],
}));

/* =======================================================================
   LETTERHEAD  (logo left | centred name and address | matching spacer)
   ======================================================================= */
const logo = fs.readFileSync(LOGO);
const SIDE = 14; // percent, so the centre column is genuinely page centred

const letterhead = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: NOBORDER,
  rows: [new TableRow({
    children: [
      new TableCell({
        width: { size: SIDE, type: WidthType.PERCENTAGE },
        borders: NOBORDER,
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { after: 0 },
          children: [new ImageRun({ type: 'jpg', data: logo, transformation: { width: 54, height: 64 } })],
        })],
      }),
      new TableCell({
        width: { size: 100 - 2 * SIDE, type: WidthType.PERCENTAGE },
        borders: NOBORDER,
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 30 },
            children: [new TextRun({ text: 'Southern IoT Limited', bold: true, size: 30, color: NAVY, font: FONT, characterSpacing: 12 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 0, line: 220 },
            children: [new TextRun({ text: 'House 26, Road 13, Sector 14, Uttara, Dhaka 1230, Bangladesh', size: 16, color: GREY, font: FONT })],
          }),
        ],
      }),
      new TableCell({
        width: { size: SIDE, type: WidthType.PERCENTAGE },
        borders: NOBORDER,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        children: [new Paragraph({ children: [] })],
      }),
    ],
  })],
});

const header = new Header({
  children: [
    letterhead,
    new Paragraph({
      spacing: { before: 60, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 2 } },
      children: [],
    }),
    new Paragraph({ spacing: { before: 0, after: 0 }, children: [] }),
  ],
});

const footer = new Footer({
  children: [
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: HAIR, space: 6 } },
      tabStops: [{ type: TabStopType.RIGHT, position: convertInchesToTwip(6.5) }],
      spacing: { before: 60, after: 0 },
      children: [
        new TextRun({ text: 'Inventory and Procurement Management Policy  |  Internal', size: 16, color: GREY, font: FONT }),
        new TextRun({ text: '\t', size: 16 }),
        new TextRun({ text: 'Page ', size: 16, color: GREY, font: FONT }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY, font: FONT }),
        new TextRun({ text: ' of ', size: 16, color: GREY, font: FONT }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: GREY, font: FONT }),
      ],
    }),
  ],
});

/* =========================================================== the document */
const doc = new Document({
  creator: 'Southern IoT Limited',
  title: 'Inventory and Procurement Management Policy',
  description: 'Policy governing procurement requests, approvals, fund tracking, inventory and BOM generation.',
  features: { updateFields: true },
  numbering: { config: numConfigs },
  styles: {
    default: {
      document: { run: { font: FONT, size: 21, color: '262626' }, paragraph: { spacing: { line: 276, after: 140 } } },
      heading1: {
        run: { font: FONT, size: 27, bold: true, color: NAVY },
        paragraph: { spacing: { before: 340, after: 150 }, keepNext: true,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C7D2E4', space: 4 } } },
      },
      heading2: {
        run: { font: FONT, size: 23, bold: true, color: ACCENT },
        paragraph: { spacing: { before: 230, after: 110 }, keepNext: true },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top: convertInchesToTwip(1.62),
          bottom: convertInchesToTwip(0.95),
          left: convertInchesToTwip(1.0),
          right: convertInchesToTwip(1.0),
          header: convertInchesToTwip(0.45),
          footer: convertInchesToTwip(0.38),
        },
      },
    },
    headers: { default: header },
    footers: { default: footer },
    children: body,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log('WROTE', OUT, buf.length, 'bytes');
});
