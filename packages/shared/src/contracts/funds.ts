import { z } from 'zod';
import { uuidSchema } from './common.js';
import { requisitionStatusSchema } from './requisitions.js';

/**
 * Phase 05 — the money half of a requisition's life: Accounts releases funds, the IM buys the
 * goods, and both are recorded against the requisition that was approved.
 *
 * Every figure here is BDT with two decimals, matching `numeric(14, 2)` in the database. Money
 * arrives from pg as a string and is parsed once at the repository boundary; it never becomes a
 * float in transit and never accumulates in a stored total (see the migration's note on why
 * funding is derived rather than cached).
 */

/* --------------------------------------------------------------- amounts */

/**
 * A money input. Non-negative, capped, and — the part that matters — restricted to two decimal
 * places, because the column is `numeric(14, 2)` and Postgres would silently round a third one.
 * Silent rounding of money is exactly the class of bug nobody notices until reconciliation.
 */
const moneyAmountSchema = z
  .number()
  .nonnegative()
  .max(1_000_000_000)
  .refine((value) => Number.isInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
    message: 'Amount cannot have more than two decimal places',
  });

/** Strictly positive: a receipt or purchase of zero is a data-entry mistake, not an event. */
const positiveMoneySchema = moneyAmountSchema.refine((value) => value > 0, {
  message: 'Amount must be greater than zero',
});

/* ----------------------------------------------------------- event dates */

/**
 * A browser clock running a little fast must not refuse an otherwise valid entry. The failure
 * mode without it is a rejection nobody can reproduce, because the offending clock is the
 * caller's. Five minutes is far short of the smallest real backdating case (same day).
 */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * An event date that has already happened.
 *
 * `receivedAt` and `purchasedAt` record *when it happened*, not when the IM typed it in, so
 * backdating stays deliberately open — money released last Tuesday is entered on Thursday, and a
 * purchase reaching the system a month later is still a real purchase. The future is the only
 * direction that is always wrong: a receipt dated next year lands in the expense report for a
 * month that has not happened, and nothing downstream would ever flag it.
 *
 * The message is passed in because it is the one the caller reads — the SPA renders
 * `VALIDATION_FAILED` field issues verbatim, so "Invalid input" would reach the screen.
 */
const pastDatetimeSchema = (message: string) =>
  z
    .string()
    .datetime({ offset: true })
    .refine((value) => Date.parse(value) <= Date.now() + CLOCK_SKEW_TOLERANCE_MS, { message });

/* ------------------------------------------------------- sent to accounts */

/**
 * Handing the BOM to Accounts.
 *
 * OQ-19, answered by the operator: this is a status change and a note, nothing more. Nothing is
 * emailed, no document is pushed anywhere — the IM records that the paperwork left their desk,
 * and the note is where they say how ("given to Sarjia in person", "emailed 31 July").
 */
export const sendToAccountsSchema = z.object({
  note: z.string().trim().max(500).nullable().default(null),
});
export type SendToAccountsInput = z.infer<typeof sendToAccountsSchema>;

/* --------------------------------------------------------- fund receipts */

export const fundReceiptSchema = z.object({
  id: uuidSchema,
  requisitionId: uuidSchema,
  amount: z.number(),
  receivedAt: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  recordedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type FundReceipt = z.infer<typeof fundReceiptSchema>;

export const recordFundReceiptSchema = z.object({
  amount: positiveMoneySchema,
  /** When Accounts released it, which is not necessarily when the IM typed it in. */
  receivedAt: pastDatetimeSchema('The date funds were received cannot be in the future'),
  reference: z.string().trim().max(120).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
});
export type RecordFundReceiptInput = z.infer<typeof recordFundReceiptSchema>;

/* -------------------------------------------------------------- purchases */

export const purchaseLineSchema = z.object({
  id: uuidSchema,
  requisitionItemId: uuidSchema,
  itemName: z.string(),
  quantity: z.number().int(),
  unitCost: z.number(),
  lineTotal: z.number(),
  overBomQuantity: z.boolean(),
  overBomNote: z.string().nullable(),
  /** How much has reached a shelf (task 5.6). Receiving is legitimately partial. */
  receivedQuantity: z.number().int(),
  /** `quantity - receivedQuantity`. Zero means this line is fully in stock. */
  outstandingQuantity: z.number().int(),
  /**
   * The catalogue product this line resolved to, once it has one. Null while the requisition item
   * is still free text and nothing has been received against it.
   */
  productId: uuidSchema.nullable(),
});
export type PurchaseLine = z.infer<typeof purchaseLineSchema>;

export const purchaseSchema = z.object({
  id: uuidSchema,
  requisitionId: uuidSchema,
  vendor: z.string(),
  invoiceNo: z.string().nullable(),
  purchasedAt: z.string(),
  totalAmount: z.number(),
  /**
   * The carriage actually paid for this delivery (migration 0029).
   *
   * `requisitions.transportationCost` stays the figure the requester *planned* — frozen at
   * submit, inside the approved amount, and what the BOM ceiling measures against. This is what
   * it came to. Spend is the sum of these over live purchases, so voiding the last purchase
   * takes the carriage with it without any separate rule (OQ-32).
   */
  transportationCost: z.number(),
  note: z.string().nullable(),
  recordedByName: z.string().nullable(),
  createdAt: z.string(),
  /**
   * Whether the scanned invoice is on file. A boolean rather than the file id: the client only
   * needs to know whether to show a download link, and the id is of no use to it.
   */
  hasInvoice: z.boolean(),
  invoiceUploadedAt: z.string().nullable(),
  lines: z.array(purchaseLineSchema),
});
export type Purchase = z.infer<typeof purchaseSchema>;

export const purchaseLineInputSchema = z.object({
  requisitionItemId: uuidSchema,
  /**
   * How many were actually bought. Often fewer than planned — the shop had six of the ten, or
   * the IM chose to take fewer at the price. Capped at the BOM's quantity by the service unless
   * `overBomQuantity` says otherwise.
   */
  quantity: z.number().int().positive().max(1_000_000),
  unitCost: moneyAmountSchema,
  /**
   * Buying more than the BOM line called for is allowed, but never silently: the flag and a
   * stated reason travel together, and the database rejects one without the other.
   */
  overBomQuantity: z.boolean().default(false),
  overBomNote: z.string().trim().max(500).nullable().default(null),
});
export type PurchaseLineInput = z.infer<typeof purchaseLineInputSchema>;

export const recordPurchaseSchema = z
  .object({
    vendor: z.string().trim().min(1).max(200),
    invoiceNo: z.string().trim().max(120).nullable().default(null),
    purchasedAt: pastDatetimeSchema('The purchase date cannot be in the future'),
    /**
     * What the carriage actually cost, adjustable up or down from what was planned.
     *
     * Defaults to 0 rather than to the planned figure: a client that does not send the field is
     * saying "no carriage on this purchase", and inheriting a figure nobody typed is how a van
     * gets charged twice on a split-vendor requisition. The form pre-fills the planned amount so
     * the IM edits it rather than retyping it.
     */
    transportationCost: moneyAmountSchema.default(0),
    note: z.string().trim().max(500).nullable().default(null),
    lines: z.array(purchaseLineInputSchema).min(1).max(500),
  })
  .refine(
    (input) => input.lines.every((line) => !line.overBomQuantity || (line.overBomNote ?? '').trim().length > 0),
    { path: ['lines'], message: 'A line that exceeds its BOM quantity needs a reason' },
  );
export type RecordPurchaseInput = z.infer<typeof recordPurchaseSchema>;

/* ----------------------------------------------------------- fund returns */

export const fundReturnSchema = z.object({
  id: uuidSchema,
  requisitionId: uuidSchema,
  amount: z.number(),
  /** Never null: a return with no stated reason is refused by a database constraint. */
  note: z.string(),
  returnedAt: z.string(),
  recordedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type FundReturn = z.infer<typeof fundReturnSchema>;

/**
 * Verifying the purchase — the IM has checked the goods against the invoice.
 *
 * If the buy came in under what Accounts released, the unspent balance goes back, and the note
 * explaining it is **mandatory**: "money came back and nobody said why" is exactly the gap this
 * step exists to close.
 */
export const verifyPurchaseSchema = z
  .object({
    /** Omit or pass 0 when nothing is going back. */
    returnedAmount: moneyAmountSchema.default(0),
    returnNote: z.string().trim().max(500).nullable().default(null),
  })
  .refine(
    (input) => input.returnedAmount === 0 || (input.returnNote ?? '').trim().length > 0,
    { path: ['returnNote'], message: 'Say why the money is going back' },
  );
export type VerifyPurchaseInput = z.infer<typeof verifyPurchaseSchema>;

/**
 * Reversing a verify-purchase — the IM needs to fix something they recorded wrong, so the
 * requisition goes back to `PURCHASED`. Refused if any money has already been returned to
 * Accounts: the correct way to undo a refund is a new refund, not a status flip.
 */
export const unverifyPurchaseSchema = z.object({
  /** Mandatory: un-verifying a purchase is an audit-worthy decision and the reason must travel. */
  reason: z.string().trim().min(1).max(500),
});
export type UnverifyPurchaseInput = z.infer<typeof unverifyPurchaseSchema>;

/* ------------------------------------------------------- stepping back */

/**
 * The reason on every reversal, shaped once.
 *
 * Ayman's ruling, 2026-08-26: every stage between approval and add-to-inventory needs a way back,
 * because an IM who clicks one stage too far currently has nowhere to go. A reversal is the one
 * kind of action whose *justification* is the whole record — the forward step is explained by the
 * thing it recorded, a reversal is explained only by the person doing it. So the reason is
 * mandatory here exactly as it is on `unverifyPurchaseSchema`, which set the shape.
 */
const reversalReasonSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

/** Take the requisition back off the Accounts queue. Refused once any money has arrived. */
export const undoSendToAccountsSchema = reversalReasonSchema;
export type UndoSendToAccountsInput = z.infer<typeof undoSendToAccountsSchema>;

/**
 * Void one fund receipt. The row is kept and marked, never deleted: "someone recorded 40,000 and
 * then took it back" is precisely what an auditor asks about, and a deleted row cannot answer.
 *
 * One receipt per press, repeatable (ruling 2026-08-26). A requisition funded in three instalments
 * must not lose two of them to a single click.
 */
export const voidFundReceiptSchema = reversalReasonSchema;
export type VoidFundReceiptInput = z.infer<typeof voidFundReceiptSchema>;

/** Void one purchase and its lines. Refused once any of its goods have been received into stock. */
export const voidPurchaseSchema = reversalReasonSchema;
export type VoidPurchaseInput = z.infer<typeof voidPurchaseSchema>;

/* -------------------------------------------------------- add to inventory */

/**
 * Creating the catalogue product for a line that was free text on the requisition.
 *
 * Supplied only when the requisition item has no `productId` yet. Everything else about receiving
 * is the same either way, which is the point: an item that entered the system as "2m USB-C cable"
 * typed into a form ends up indistinguishable from one the IM catalogued by hand.
 */
export const newCatalogueProductSchema = z.object({
  productCode: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  categoryId: uuidSchema,
  unit: z.string().trim().min(1).max(32).default('pcs'),
});
export type NewCatalogueProduct = z.infer<typeof newCatalogueProductSchema>;

export const receiveIntoStockLineSchema = z
  .object({
    purchaseLineId: uuidSchema,
    compartmentId: uuidSchema,
    /** May be less than the purchased quantity — a part-shipment is a normal thing to record. */
    quantity: z.number().int().positive().max(1_000_000),
    /**
     * Create a new catalogue entry for a line that is still free text. Ignored when the
     * requisition item is already linked to a product.
     */
    newProduct: newCatalogueProductSchema.optional(),
    /**
     * Or point that free-text line at a product we already stock.
     *
     * Ayman, 2026-08-26: "we have 5 ESP in meta A1, we buy 5 more — while adding to inventory it
     * should go under the same ESP, no matter the location, so the total is 10."
     *
     * That works automatically when the requester picked the product from the catalogue on the
     * requisition form. It could not when they free-typed the name, because the only option here
     * was `newProduct` — so "ESP32" typed a second time became a *second* ESP32, and the two
     * never added up again. Product names are not unique (only `product_code` is), so nothing
     * downstream would have caught it.
     *
     * Free text has to stay possible: requirements §3 requires that something we do not stock yet
     * is still requestable. So the answer is not to forbid it, it is to let the IM resolve it to
     * the real product at the moment the goods are in their hands and the ambiguity is settled.
     */
    existingProductId: uuidSchema.optional(),
  })
  .superRefine((input, ctx) => {
    // Both would be a contradiction the server would have to break arbitrarily.
    if (input.newProduct && input.existingProductId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['existingProductId'],
        message: 'Choose an existing product or describe a new one, not both',
      });
    }
  });
export type ReceiveIntoStockLine = z.infer<typeof receiveIntoStockLineSchema>;

export const receiveIntoStockSchema = z.object({
  lines: z.array(receiveIntoStockLineSchema).min(1).max(200),
  note: z.string().trim().max(500).nullable().default(null),
});
export type ReceiveIntoStockInput = z.infer<typeof receiveIntoStockSchema>;

/* ------------------------------------------------------------ borrow to user */

/**
 * Handing a purchased line straight to a person instead of putting it on a shelf.
 *
 * `borrowerId` defaults to the requester in the UI but may be anyone active (OQ-22): an item
 * bought on one person's requisition is often handed to a colleague who will actually use it.
 */
export const borrowToUserLineSchema = z.object({
  purchaseLineId: uuidSchema,
  /** The units still pass through a compartment, so the ledger records where they came from. */
  compartmentId: uuidSchema,
  quantity: z.number().int().positive().max(1_000_000),
  newProduct: newCatalogueProductSchema.optional(),
});
export type BorrowToUserLine = z.infer<typeof borrowToUserLineSchema>;

export const borrowToUserSchema = z.object({
  borrowerId: uuidSchema,
  lines: z.array(borrowToUserLineSchema).min(1).max(200),
  /** Null for a consumable that is never coming back. */
  expectedReturnDate: z.string().date().nullable().default(null),
  isReturnable: z.boolean().default(true),
  purpose: z.string().trim().max(500).nullable().default(null),
  projectId: uuidSchema.nullable().default(null),
});
export type BorrowToUserInput = z.infer<typeof borrowToUserSchema>;

/* ------------------------------------------------------------- the summary */

/**
 * The money view of one requisition — what the tracker and the detail screen read.
 *
 * `funded`, `spent` and `outstanding` are computed from the rows every time. The alternative is a
 * stored balance, which is a number that can silently disagree with the receipts that justify it.
 */
export const requisitionFundingSchema = z.object({
  requisitionId: uuidSchema,
  requestedAmount: z.number().nullable(),
  approvedAmount: z.number().nullable(),
  /** Sum of receipts. */
  funded: z.number(),
  /** Sum of purchase totals. */
  spent: z.number(),
  /**
   * Transportation **charged** — the cost declared on the requisition, but only while a live
   * purchase stands (OQ-32). Part of `approved_amount` at submit time and never reaching
   * `purchases` (it is not a stock movement), so it is folded into `unspent` and
   * `spentInclTransportation` by hand.
   *
   * Zero before anything has been bought and zero again once the last purchase is voided:
   * nothing has been carried until something has been bought. The amount the requester declared
   * is on the requisition itself as `transportationCost` and does not move.
   */
  transportation: z.number(),
  /** `spent + transportation`. The figure the verify-purchase dialog compares against funded. */
  spentInclTransportation: z.number(),
  /** Sum of what went back to Accounts. */
  returned: z.number(),
  /**
   * What the requisition actually consumed: `funded − returned`. This is the figure the expense
   * report totals, and the reason returns are their own table rather than negative receipts.
   */
  netFunded: z.number(),
  /** `approved - funded`, floored at zero: Accounts over-releasing is not a negative debt. */
  outstanding: z.number(),
  /**
   * Money released but neither spent nor returned. What the IM may still hand back — and the
   * ceiling the return guard enforces.
   */
  unspent: z.number(),
  isFullyFunded: z.boolean(),
  receipts: z.array(fundReceiptSchema),
  purchases: z.array(purchaseSchema),
  returns: z.array(fundReturnSchema),
});
export type RequisitionFunding = z.infer<typeof requisitionFundingSchema>;

/**
 * Point-in-time capture of money figures at one lifecycle stage transition.
 *
 * Populated from the `funding_snapshots` table on every forward-progress transition
 * (IM_REVIEW, AWAITING_APPROVAL, APPROVED, BOM_GENERATED, SENT_TO_ACCOUNTS,
 * FUNDS_PARTIAL, FUNDS_RECEIVED, PURCHASED, PURCHASE_VERIFIED, STOCKED). When the same
 * status is re-entered multiple times — e.g. partial receipts driving FUNDS_PARTIAL back
 * and forth — the dedup-on-read keeps only the most recent row per status, so the UI
 * can key one pill per stage without filtering.
 *
 * `requestedAmount` stays frozen across every snapshot for the requisition's life; an
 * approver's revision to `approvedAmount` is visible from the APPROVED snapshot onward.
 */
export const requisitionFundingSnapshotSchema = z.object({
  /** The status the requisition entered when this snapshot was written. */
  status: requisitionStatusSchema,
  /** Frozen at submit — never recomputed. */
  requestedAmount: z.number().nullable(),
  /** At each snapshot: whatever `requisitions.approved_amount` held at the moment of transition. */
  approvedAmount: z.number().nullable(),
  transportation: z.number(),
  funded: z.number(),
  spent: z.number(),
  returnedToAccounts: z.number(),
  unspent: z.number(),
  snapshottedAt: z.string(),
});
export type RequisitionFundingSnapshot = z.infer<typeof requisitionFundingSnapshotSchema>;
