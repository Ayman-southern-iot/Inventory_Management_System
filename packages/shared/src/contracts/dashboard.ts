import { z } from 'zod';

/**
 * One person's record across the system, for their own dashboard.
 *
 * Ayman's ruling, 2026-08-26: **own figures only**. There is no per-user lookup and no
 * "view anyone" variant, so nothing here goes near the permission model — the endpoint reads
 * `req.user.id` and nothing else can be asked for.
 *
 * Every figure is derived at read time from the rows that justify it, in one query per block.
 * None of it is stored, and none of it is a counter that could drift from what it counts.
 */

/**
 * Requisitions this person raised.
 *
 * `approved` means *currently* approved — the requisition is at or past APPROVED and has not been
 * rejected or cancelled since. That is the same definition `APPROVAL_STANDING_STATUSES` uses for
 * money, and it is deliberately not "was ever approved": a requisition whose approval was
 * withdrawn is not one you can spend against, so counting it here would contradict the spend
 * figure sitting next to it (OQ-27, ruling 2026-08-23).
 *
 * `inFlight` is everything still moving — submitted but not yet decided, or decided and still
 * working through the money stages. `drafts` never left the requester's hands.
 */
export const requisitionRecordSchema = z.object({
  raised: z.number().int(),
  approved: z.number().int(),
  rejected: z.number().int(),
  inFlight: z.number().int(),
  drafts: z.number().int(),
  cancelled: z.number().int(),
});
export type RequisitionRecord = z.infer<typeof requisitionRecordSchema>;

/**
 * Borrowing, from the borrower's side.
 *
 * `borrowed` counts requests that were actually issued — a pending or rejected request never put
 * anything in anyone's hands. `stillOut` is the count with units not yet back, which is the figure
 * that matters to the person reading it.
 *
 * The three condition counts are **units, not requests**: returning three of five cables damaged
 * is three damaged units on one request, and a per-request count would hide two of them. They come
 * straight off `borrow_returns.condition`, which the IM records on every return — there is no
 * "assumed good" path (see the ReturnCondition doc).
 */
export const borrowingRecordSchema = z.object({
  borrowed: z.number().int(),
  returned: z.number().int(),
  stillOut: z.number().int(),
  /** Usable but flawed — counted back into available stock. */
  partiallyDamagedUnits: z.number().int(),
  /** Physically present, held in quarantine. */
  damagedUnits: z.number().int(),
  /** Beyond repair, as distinct from fixable. */
  notWorkingUnits: z.number().int(),
});
export type BorrowingRecord = z.infer<typeof borrowingRecordSchema>;

/**
 * Money spent against this person's requisitions.
 *
 * Ayman, 2026-08-26: "how many amount he spent in total till now (based on only spent money)".
 * So this is `SUM(purchases.total_amount)` on requisitions they raised — what was actually bought,
 * not what was requested, approved or released. It is the same definition the Expenses report
 * calls `spent`, deliberately: two screens naming the same figure differently is how a number
 * gets argued about instead of used.
 *
 * Voided purchases are excluded, like everywhere else (migration 0028).
 *
 * `requested` and `approved` ride along because "spent 40,000" means something different against
 * 45,000 approved than against 400,000, and the reader should not have to go and find out.
 */
export const spendRecordSchema = z.object({
  requested: z.number(),
  approved: z.number(),
  /**
   * Everything that left the company on this person's requisitions: invoices **plus**
   * transportation. `purchased + transportation === spent`, always.
   *
   * Transportation has no `purchases` row of its own — it buys carriage, not stock — so a figure
   * that reads only that table is short by exactly the carriage, silently and permanently. Ayman
   * found it on 2026-08-26: a 1,000 requisition of which 500 was a van reported 250 spent.
   */
  spent: z.number(),
  /** The invoice half of `spent`. */
  purchased: z.number(),
  /** The carriage half. Counted once per requisition that has actually bought something. */
  transportation: z.number(),
});
export type SpendRecord = z.infer<typeof spendRecordSchema>;

export const personalRecordSchema = z.object({
  requisitions: requisitionRecordSchema,
  borrowing: borrowingRecordSchema,
  spend: spendRecordSchema,
});
export type PersonalRecord = z.infer<typeof personalRecordSchema>;
