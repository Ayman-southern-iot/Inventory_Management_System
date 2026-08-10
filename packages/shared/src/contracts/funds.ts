import { z } from 'zod';
import { uuidSchema } from './common.js';

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
  receivedAt: z.string().datetime({ offset: true }),
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
    purchasedAt: z.string().datetime({ offset: true }),
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

export const receiveIntoStockLineSchema = z.object({
  purchaseLineId: uuidSchema,
  compartmentId: uuidSchema,
  /** May be less than the purchased quantity — a part-shipment is a normal thing to record. */
  quantity: z.number().int().positive().max(1_000_000),
  /** Required when the underlying requisition item is still free text; ignored otherwise. */
  newProduct: newCatalogueProductSchema.optional(),
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
   * Transportation cost declared on the requisition. Part of `approved_amount` at submit time but
   * never reaches `purchases` (it is not a stock movement), so it has to be folded into spent
   * manually when computing `unspent` and `spentInclTransportation`.
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
