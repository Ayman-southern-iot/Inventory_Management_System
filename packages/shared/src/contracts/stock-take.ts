import { z } from 'zod';
import { borrowStatusSchema, refineReturnDate } from './borrowing.js';
import { uuidSchema } from './common.js';
import { placementSchema, positiveQuantitySchema } from './inventory.js';

/**
 * `POST /stock/take` — stock off a shelf in one call (ADR-0002).
 *
 * The same handover `POST /borrowing/issue-from-stock` records, reachable by an API key holding
 * `stock:take` as well as by an Inventory Manager. One idempotent request replaces
 * borrow-create + approve for callers that have no human in the loop: a lab drawer panel, a
 * voice assistant, a script.
 *
 * **The holder is always the caller** (OQ-KT1): the key's service account, or the signed-in
 * person. There is deliberately no field naming somebody else — a machine asserting who received
 * the goods is a claim nothing can check. A panel that knows who is standing at it may say so in
 * `purpose`, where it is recorded as what it is: text the caller supplied.
 */

/**
 * Where the caller says the request came from. **Caller-declared and unverifiable**, so it is
 * written into the audit metadata and decides nothing. Which key acted is recorded separately and
 * reliably, in `audit_log.api_key_id`.
 */
export const TakeChannel = {
  API: 'api',
  VOICE: 'voice',
  PANEL: 'panel',
  WEB: 'web',
} as const;
export type TakeChannel = (typeof TakeChannel)[keyof typeof TakeChannel];
export const takeChannelSchema = z.nativeEnum(TakeChannel);

export const takeStockSchema = z
  .object({
    productId: uuidSchema,
    compartmentId: uuidSchema,
    /** Also capped per call by `DIRECT_TAKE_MAX_QTY` (OQ-KT2), which is config, so server-side. */
    quantity: positiveQuantitySchema,
    projectId: uuidSchema.nullable().default(null),
    /**
     * Omit to use the product's own default (`default_returnable`, OQ-08). The return-date rule
     * below is applied here when this is given, and again by the server once the default has
     * been resolved, so an omitted flag cannot slip a date past it.
     */
    isReturnable: z.boolean().optional(),
    expectedReturnDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
      .nullable()
      .default(null),
    purpose: z.string().trim().max(1000).nullable().default(null),
    channel: takeChannelSchema.default(TakeChannel.API),
  })
  .superRefine((input, ctx) => {
    if (input.isReturnable === undefined) return;
    refineReturnDate(
      { isReturnable: input.isReturnable, expectedReturnDate: input.expectedReturnDate },
      ctx,
    );
  });
export type TakeStockInput = z.infer<typeof takeStockSchema>;

/**
 * What a take answers with: ids, quantities and the shelf as it now stands — **and no person's
 * name** (OQ-KT6). K2 keeps borrowing out of key reach because it names employees, and a take is
 * a borrow, so the full `BorrowRequest` view (requester, holder, decider) is not returned here.
 */
export const takeStockResultSchema = z.object({
  borrowId: uuidSchema,
  /** `BR-000123`. A sequence number, carries no name. */
  borrowNo: z.string(),
  status: borrowStatusSchema,
  productId: uuidSchema,
  compartmentId: uuidSchema,
  quantity: z.number().int(),
  isReturnable: z.boolean(),
  expectedReturnDate: z.string().nullable(),
  /**
   * The placement after the take, so a panel can show what is left without a second call.
   * `null` when the take emptied the shelf: `StockService.issue` removes a placement that reaches
   * zero, so there is no row left to describe. Also null in the rare case the read-back after the
   * take failed — the take itself stands either way; re-read the product to be sure.
   */
  placement: placementSchema.nullable(),
});
export type TakeStockResult = z.infer<typeof takeStockResultSchema>;
