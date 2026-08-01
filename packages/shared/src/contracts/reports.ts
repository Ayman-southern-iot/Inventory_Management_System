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
  /** Sum of purchase invoice totals — what the company actually bought, and the expense figure. */
  spent: z.number(),
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
