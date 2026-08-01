import { z } from 'zod';
import { paginationQuerySchema, queryBoolean } from './common.js';

/* --------------------------------------------------------------------- projects */

export const projectNameSchema = z.string().trim().min(2).max(160);

export const createProjectSchema = z.object({
  name: projectNameSchema,
  /**
   * OQ-09: a duplicate name is a warning, not a block — two teams may legitimately run a
   * "Falcon". The client sends this after the user has seen the warning and chosen to proceed.
   */
  allowDuplicateName: z.boolean().default(false),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

/* ------------------------------------------------------------------- borrowing */

export const BorrowStatus = {
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
  ISSUED: 'ISSUED',
  PARTIALLY_RETURNED: 'PARTIALLY_RETURNED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const;
export type BorrowStatus = (typeof BorrowStatus)[keyof typeof BorrowStatus];

export const borrowStatusSchema = z.enum(
  Object.values(BorrowStatus) as [BorrowStatus, ...BorrowStatus[]],
);

/**
 * What the IM records about a returned unit. Required on every return — there is no
 * "default good" any more, because silently treating every return as good is how a damaged
 * cable ends up on the same shelf as a fresh one (requirement: record return condition).
 *
 *   GOOD                       — fits the catalogue default, goes back to available stock.
 *   PARTIALLY_DAMAGED_USABLE   — usable but flawed; counted back into available so the next
 *                                borrower can decide for themselves whether to take it.
 *   DAMAGED                    — physically present, excluded from availability; held in
 *                                quarantine until the IM releases it (verified repaired) or
 *                                disposes of it (ledger DISPOSE).
 *   NOT_WORKING                — same as DAMAGED for stock purposes; the label lets the IM
 *                                distinguish "fixable" from "beyond repair" in the report.
 */
export const ReturnCondition = {
  GOOD: 'GOOD',
  PARTIALLY_DAMAGED_USABLE: 'PARTIALLY_DAMAGED_USABLE',
  DAMAGED: 'DAMAGED',
  NOT_WORKING: 'NOT_WORKING',
} as const;
export type ReturnCondition = (typeof ReturnCondition)[keyof typeof ReturnCondition];

export const returnConditionSchema = z.enum(
  Object.values(ReturnCondition) as [ReturnCondition, ...ReturnCondition[]],
);

/** Statuses meaning "the item is physically out". Used by the overdue job and the Out filter. */
export const OUTSTANDING_STATUSES: readonly BorrowStatus[] = [
  BorrowStatus.ISSUED,
  BorrowStatus.PARTIALLY_RETURNED,
];

export const createBorrowRequestSchema = z
  .object({
    productId: z.string().uuid(),
    compartmentId: z.string().uuid(),
    quantity: z.number().int().positive().max(100_000),
    projectId: z.string().uuid().nullable().default(null),
    /** Defaults from the product on the form; the requester may override it (OQ-08). */
    isReturnable: z.boolean(),
    expectedReturnDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
      .nullable()
      .default(null),
    purpose: z.string().trim().max(1000).nullable().default(null),
  })
  .superRefine((input, ctx) => {
    // A consumable is issued and never comes back, so a return date is a contradiction.
    if (!input.isReturnable && input.expectedReturnDate !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedReturnDate'],
        message: 'A consumable is not returned, so it has no return date',
      });
    }
    if (input.isReturnable && input.expectedReturnDate === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedReturnDate'],
        message: 'An expected return date is required',
      });
    }
  });
export type CreateBorrowRequestInput = z.infer<typeof createBorrowRequestSchema>;

export const decideBorrowSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(1000).nullable().default(null),
});
export type DecideBorrowInput = z.infer<typeof decideBorrowSchema>;

export const returnBorrowSchema = z.object({
  quantity: z.number().int().positive().max(100_000),
  /** Where it goes back. Usually the origin, but the IM may reshelve it. */
  compartmentId: z.string().uuid(),
  /**
   * Required. Drives the same-transaction quarantine of DAMAGED / NOT_WORKING quantities
   * (see migration 0019). The previous free-text `conditionNote` was dropped because a note
   * cannot drive availability — only an enum can.
   */
  condition: returnConditionSchema,
});
export type ReturnBorrowInput = z.infer<typeof returnBorrowSchema>;

/** OPEN QUESTION: OQ-04 — reverting to PENDING is only legal before physical issue. */
export const revertBorrowSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RevertBorrowInput = z.infer<typeof revertBorrowSchema>;

export const BorrowFilter = {
  ALL: 'ALL',
  PENDING: 'PENDING',
  OUT: 'OUT',
  RETURNED: 'RETURNED',
  OVERDUE: 'OVERDUE',
} as const;
export type BorrowFilter = (typeof BorrowFilter)[keyof typeof BorrowFilter];

export const listBorrowsQuerySchema = paginationQuerySchema.extend({
  filter: z
    .enum(Object.values(BorrowFilter) as [BorrowFilter, ...BorrowFilter[]])
    .default(BorrowFilter.ALL),
  search: z.string().trim().max(160).optional(),
  productId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  /** Set by the "My borrowings" screen; the API also forces it for non-IM callers. */
  mine: queryBoolean(false),
});
export type ListBorrowsQuery = z.infer<typeof listBorrowsQuerySchema>;

export const borrowRequestSchema = z.object({
  id: z.string().uuid(),
  borrowNo: z.string(),
  requesterId: z.string().uuid(),
  requesterName: z.string(),
  productId: z.string().uuid(),
  productName: z.string(),
  productCode: z.string(),
  unit: z.string(),
  compartmentId: z.string().uuid(),
  location: z.string(),
  quantity: z.number().int(),
  returnedQty: z.number().int(),
  /** `quantity - returnedQty`, and zero for a consumable. */
  outstandingQty: z.number().int(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  isReturnable: z.boolean(),
  expectedReturnDate: z.string().nullable(),
  purpose: z.string().nullable(),
  status: borrowStatusSchema,
  decidedByName: z.string().nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  issuedAt: z.string().nullable(),
  returnedAt: z.string().nullable(),
  /** Derived server-side against the current date, so every client agrees on it. */
  isOverdue: z.boolean(),
  createdAt: z.string(),
});
export type BorrowRequest = z.infer<typeof borrowRequestSchema>;

/** Header the client sends so a double-click cannot issue stock twice. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';
