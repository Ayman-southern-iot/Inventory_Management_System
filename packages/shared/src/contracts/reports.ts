import { z } from 'zod';

/**
 * Phase 05 task 5.8 — what the organisation has actually spent.
 *
 * Visible to Approvers, Inventory Managers and Admin. Not to General: an approver needs to see
 * the shape of the spend they are sanctioning, but a requester has no business browsing every
 * department's figures.
 *
 * **The six figures must always reconcile.** They are computed from the same rows the requisition
 * screens read — there is no separate reporting table to drift out of step, which is the usual way
 * a report starts quietly disagreeing with the system it reports on.
 */

/* ------------------------------------------------------------------ query */

export const EXPENSE_GROUP_BY = ['month', 'department', 'project'] as const;
export type ExpenseGroupBy = (typeof EXPENSE_GROUP_BY)[number];
export const expenseGroupBySchema = z.enum(
  EXPENSE_GROUP_BY as readonly [ExpenseGroupBy, ...ExpenseGroupBy[]],
);

/**
 * Calendar dates, not timestamps.
 *
 * `YYYY-MM-DD` deliberately: "1 to 31 July" means the business's own days, and the business is in
 * Asia/Dhaka. Coercing to a `Date` here would anchor both ends to UTC midnight, so a requisition
 * submitted at 3am Dhaka on the 31st — which is 9pm UTC on the 30th — would fall outside a range
 * that plainly ought to contain it. The server converts these to instants using the configured
 * reporting time zone.
 */
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

export const expenseReportQuerySchema = z
  .object({
    /** Inclusive. Omit both for "everything". */
    from: calendarDateSchema.optional(),
    /** Inclusive of the whole day, in the reporting time zone. */
    to: calendarDateSchema.optional(),
    groupBy: expenseGroupBySchema.default('month'),
    departmentId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'The end of the range cannot be before its start',
  });
export type ExpenseReportQuery = z.infer<typeof expenseReportQuerySchema>;

/* ----------------------------------------------------------------- result */

/**
 * One bucket — a month, a department or a project.
 *
 * Every requisition is counted in exactly one bucket, so the rows sum to the totals. `requested`
 * and `approved` are attributed by **submission date**; `funded`, `spent` and `returned` by the
 * date the money actually moved. That difference is deliberate and is why `approved` and `spent`
 * in the same month do not describe the same requisitions — see the note on `ExpenseReport`.
 */
export const expenseBucketSchema = z.object({
  /** `2026-07` for a month, or the department/project id. */
  key: z.string(),
  /** What to print: "July 2026", the department name, the project name. */
  label: z.string(),
  requisitionCount: z.number().int(),
  requested: z.number(),
  approved: z.number(),
  funded: z.number(),
  /**
   * Everything that left the company: invoices **plus** transportation.
   *
   * Transportation has no `purchases` row — it buys carriage, not stock — so a spend figure that
   * reads only that table is short by exactly the carriage, silently and permanently. Reported by
   * Ayman on 2026-08-26 from a requisition where 500 of a 1,000 request was a van: the panel had
   * it right and this report did not.
   *
   * `purchased + transportation === spent`, always. The two halves are reported separately below
   * so an auditor adding up invoice totals can see where the difference went.
   */
  spent: z.number(),
  /** The invoice half of `spent` — the figure that matches the purchase rows. */
  purchased: z.number(),
  /**
   * The carriage half of `spent`. Counted once the requisition has a purchase in the window:
   * nothing has been carried until something has been bought.
   */
  transportation: z.number(),
  /** Money refunded to Accounts. Kept separate so it is never mistaken for an expense. */
  returned: z.number(),
  /** `funded − returned` — cash out of pocket, not the purchase expense. */
  netCash: z.number(),
});
export type ExpenseBucket = z.infer<typeof expenseBucketSchema>;

export const expenseReportSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  groupBy: expenseGroupBySchema,
  buckets: z.array(expenseBucketSchema),
  /** The same six figures across every bucket. Always equals the sum of the rows. */
  totals: expenseBucketSchema.omit({ key: true, label: true }),
});
export type ExpenseReport = z.infer<typeof expenseReportSchema>;

/* =========================================================== inventory report */

/**
 * EX-02. requirements §10: "Bill of Materials and inventory records can be exported as PDF for
 * the Inventory Manager to submit physical copies to the accounts department."
 *
 * The BOM half shipped in phase 04. This is the inventory half — the only REQUIRED obligation in
 * the document that had no implementation at all. QA filed it under D-024 without its own defect
 * ID, which is how it stayed invisible through two rounds.
 *
 * `docs/reference/09-bom.md` describes the shape: current stock by product with its location
 * breakdown. Filters mirror the products list so the IM can export what they are looking at
 * rather than a different report that happens to share a name.
 */
export const inventoryReportQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  /** Deactivated products are excluded by default; history still needs them on request. */
  includeInactive: z.coerce.boolean().default(false),
  /** Drops products holding nothing, which is most of a mature catalogue. */
  inStockOnly: z.coerce.boolean().default(false),
});
export type InventoryReportQuery = z.infer<typeof inventoryReportQuerySchema>;

/** Where one product physically sits, and how much of it is there. */
export const inventoryReportPlacementSchema = z.object({
  zoneName: z.string(),
  compartmentName: z.string(),
  quantity: z.number().int(),
  reserved: z.number().int(),
  quarantined: z.number().int(),
});
export type InventoryReportPlacement = z.infer<typeof inventoryReportPlacementSchema>;

export const inventoryReportRowSchema = z.object({
  productId: z.string().uuid(),
  productCode: z.string(),
  name: z.string(),
  categoryName: z.string().nullable(),
  unit: z.string(),
  isActive: z.boolean(),
  /** Totals across every placement below, so the row reconciles against its own breakdown. */
  totalQuantity: z.number().int(),
  totalReserved: z.number().int(),
  totalQuarantined: z.number().int(),
  /** `quantity − reserved − quarantined`: what someone could actually be handed today. */
  totalAvailable: z.number().int(),
  placements: z.array(inventoryReportPlacementSchema),
});
export type InventoryReportRow = z.infer<typeof inventoryReportRowSchema>;

export const inventoryReportSchema = z.object({
  /** ISO instant the report was taken. A stock report is only true at a moment. */
  generatedAt: z.string(),
  rows: z.array(inventoryReportRowSchema),
  totals: z.object({
    productCount: z.number().int(),
    totalQuantity: z.number().int(),
    totalReserved: z.number().int(),
    totalQuarantined: z.number().int(),
    totalAvailable: z.number().int(),
  }),
});
export type InventoryReport = z.infer<typeof inventoryReportSchema>;
