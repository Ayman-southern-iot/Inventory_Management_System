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
