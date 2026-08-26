import { z } from 'zod';
import { paginationQuerySchema, queryBoolean } from './common.js';
import { type SupportingDocument } from './files.js';

/* ---------------------------------------------------------------- statuses */

export const RequisitionStatus = {
  DRAFT: 'DRAFT',
  /** The IM confirms "we do not already have this" before anyone spends money. */
  IM_REVIEW: 'IM_REVIEW',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  BOM_GENERATED: 'BOM_GENERATED',
  SENT_TO_ACCOUNTS: 'SENT_TO_ACCOUNTS',
  FUNDS_PARTIAL: 'FUNDS_PARTIAL',
  FUNDS_RECEIVED: 'FUNDS_RECEIVED',
  PURCHASED: 'PURCHASED',
  /** The IM has checked the goods against the invoice. Task 5.5 attaches the invoice here. */
  PURCHASE_VERIFIED: 'PURCHASE_VERIFIED',
  STOCKED: 'STOCKED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type RequisitionStatus = (typeof RequisitionStatus)[keyof typeof RequisitionStatus];

export const requisitionStatusSchema = z.enum(
  Object.values(RequisitionStatus) as [RequisitionStatus, ...RequisitionStatus[]],
);

/** Stages where an approver may still withdraw — up to BOM generation (domain-context.md).
 *  `REJECTED` lets a withdrawn rejection resurrect the chain; `IM_REVIEW` is the post-resurrection
 *  landing for an IM rejection withdrawal; `APPROVED` and the pre-approval `AWAITING_APPROVAL`
 *  round out the lifecycle. */
export const WITHDRAWABLE_STATUSES: readonly RequisitionStatus[] = [
  RequisitionStatus.REJECTED,
  RequisitionStatus.IM_REVIEW,
  RequisitionStatus.AWAITING_APPROVAL,
  RequisitionStatus.APPROVED,
];

/**
 * The statuses in which an approval **still stands**, i.e. the money is sanctioned and could
 * actually be spent.
 *
 * `approved_amount` is written at submit — it seeds the BOM with a figure to print — and only
 * send-back nulls it, so the column alone cannot answer "was this approved?". A rejected or
 * still-undecided requisition carries a full figure. Anything reporting *approved money* must
 * predicate on this list rather than on the column being non-null.
 *
 * `REJECTED` and `CANCELLED` are out because the money cannot be spent; `IM_REVIEW` and
 * `AWAITING_APPROVAL` are out because nobody has sanctioned it yet. Ruling 2026-08-23 (OQ-27):
 * "Approved" means *currently* approved. The requirements are silent.
 */
export const APPROVAL_STANDING_STATUSES: readonly RequisitionStatus[] = [
  RequisitionStatus.APPROVED,
  RequisitionStatus.BOM_GENERATED,
  RequisitionStatus.SENT_TO_ACCOUNTS,
  RequisitionStatus.FUNDS_PARTIAL,
  RequisitionStatus.FUNDS_RECEIVED,
  RequisitionStatus.PURCHASED,
  RequisitionStatus.PURCHASE_VERIFIED,
  RequisitionStatus.STOCKED,
  RequisitionStatus.CLOSED,
];

export const RequisitionUrgency = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type RequisitionUrgency = (typeof RequisitionUrgency)[keyof typeof RequisitionUrgency];

export const requisitionUrgencySchema = z.enum(
  Object.values(RequisitionUrgency) as [RequisitionUrgency, ...RequisitionUrgency[]],
);

export const ApprovalStage = {
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  APPROVER: 'APPROVER',
} as const;
export type ApprovalStage = (typeof ApprovalStage)[keyof typeof ApprovalStage];

export const ApprovalAction = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type ApprovalAction = (typeof ApprovalAction)[keyof typeof ApprovalAction];

/** Event types the live tracker reads. Append-only, so these names are permanent. */
export const RequisitionEventType = {
  CREATED: 'CREATED',
  SUBMITTED: 'SUBMITTED',
  IM_APPROVED: 'IM_APPROVED',
  IM_REJECTED: 'IM_REJECTED',
  APPROVER_APPROVED: 'APPROVER_APPROVED',
  APPROVER_REJECTED: 'APPROVER_REJECTED',
  APPROVER_WITHDREW: 'APPROVER_WITHDREW',
  FULLY_APPROVED: 'FULLY_APPROVED',
  AMOUNT_REVISED: 'AMOUNT_REVISED',
  BOM_GENERATED: 'BOM_GENERATED',
  /** The BOM was too far over the approved amount and bounced back for re-approval (OQ-05). */
  BOM_BOUNCED: 'BOM_BOUNCED',
  /** The BOM was voided; the source requisition is back on the BOM-eligible list. */
  BOM_VOIDED: 'BOM_VOIDED',
  /** The IM rendered the PDF for this BOM. Task 4.3 — the moment Accounts has the file on disk. */
  BOM_RENDERED: 'BOM_RENDERED',
  /* --- Phase 05: the money half of the lifecycle (task 5.4) --- */
  /** The IM handed the BOM to Accounts. See OQ-19: purely a status, nothing leaves the system. */
  SENT_TO_ACCOUNTS: 'SENT_TO_ACCOUNTS',
  /** One receipt landed. Partial or full is decided by the sum, not by which event fired. */
  FUNDS_RECEIVED: 'FUNDS_RECEIVED',
  /** Money went back to Accounts because the purchase came in under budget (task 5.5). */
  FUNDS_RETURNED: 'FUNDS_RETURNED',
  PURCHASED: 'PURCHASED',
  PURCHASE_VERIFIED: 'PURCHASE_VERIFIED',
  /**
   * The IM reversed a verify-purchase so the requisition is back at PURCHASED. The purchases
   * and receipts rows stay — they are evidence of what was bought — only the status flips.
   */
  UNVERIFIED_PURCHASE: 'UNVERIFIED_PURCHASE',
  /**
   * On a single-item over-budget requisition, the IM sent it back to the requester for
   * budget revision. The status flips to DRAFT; the requester re-submits and the chain
   * replays. The "for revise" / "revised" pill on the detail page is computed from this
   * event in the events view (see `requiresRevisionTag` / `revisedAfterSendBack`).
   */
  SEND_BACK_FOR_REVISION: 'SEND_BACK_FOR_REVISION',
  STOCKED: 'STOCKED',
  /** Goods went straight out to a person instead of onto a shelf (task 5.7). */
  BORROWED_OUT: 'BORROWED_OUT',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type RequisitionEventType =
  (typeof RequisitionEventType)[keyof typeof RequisitionEventType];

/* -------------------------------------------------------------- line items */

export const requisitionItemInputSchema = z.object({
  /** Null when the item is not in the catalogue yet — the free-text escape hatch (task 3.2). */
  productId: z.string().uuid().nullable().default(null),
  itemName: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive().max(1_000_000),
  estimatedUnitPrice: z.number().nonnegative().max(1_000_000_000),
  note: z.string().trim().max(500).nullable().default(null),
});
export type RequisitionItemInput = z.infer<typeof requisitionItemInputSchema>;

export const requisitionItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  itemName: z.string(),
  quantity: z.number().int(),
  estimatedUnitPrice: z.number(),
  estimatedLineTotal: z.number(),
  /** What the register said at submit. Advisory only — it never blocks adding a line. */
  inStockQtyAtSubmit: z.number().int().nullable(),
  note: z.string().nullable(),
});
export type RequisitionItem = z.infer<typeof requisitionItemSchema>;

/* ------------------------------------------------------------ requisitions */

export const saveRequisitionSchema = z
  .object({
    departmentId: z.string().uuid().nullable().default(null),
    projectId: z.string().uuid().nullable().default(null),
    urgency: requisitionUrgencySchema.default(RequisitionUrgency.NORMAL),
    /**
     * An instant, not a calendar day, since Ayman's ruling of 2026-08-26: the requester picks a
     * date *and* a time. Migration 0027 changed the column to `timestamptz` and backfilled every
     * existing row to 23:59:59 on its stated day, Asia/Dhaka.
     *
     * Validated as a real parseable instant rather than by shape. A regex would accept
     * `2026-13-45T99:00:00Z`, and this value decides when an approver gets chased.
     */
    approvalDeadline: z
      .string()
      .datetime({ offset: true })
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a valid date and time')
      .nullable()
      .default(null),
    reason: z.string().trim().max(2000).nullable().default(null),
    items: z.array(requisitionItemInputSchema).min(1, 'Add at least one item').max(200),
    /**
     * Optional id of a `stored_files` row created by `POST /uploads/supporting-document`
     * (the pre-draft attach flow). On draft create, the service claims the file in the
     * same transaction: sets `requisitions.supporting_document_file_id` and clears
     * `stored_files.pending_claim_by`. The file must be `kind = 'SUPPORTING_DOCUMENT'`
     * and `pending_claim_by = actor.id`; otherwise the service returns 403.
     *
     * Optional: existing clients (which don't send this field) keep working — Zod
     * strips unknown keys, and the existing post-save attach endpoint is unchanged.
     */
    pendingSupportingDocumentId: z.string().uuid().nullable().optional(),
    /**
     * Optional rolled-up transportation cost (fuel, vehicle hire, porter, etc.).
     * Part of `requested_amount` at submit. Description is required when the cost
     * is non-zero (so the approver knows what they're paying for); the DB enforces
     * the same both-or-neither rule as a structural guard.
     */
    transportationCost: z.number().nonnegative().max(1_000_000_000).nullable().default(null),
    transportationDescription: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .default(null),
  })
  .refine(
    (v) =>
      // Zero / null / undefined cost → description is optional; otherwise it must be present.
      v.transportationCost == null || v.transportationCost === 0
        ? true
        : (v.transportationDescription?.trim().length ?? 0) > 0,
    {
      path: ['transportationDescription'],
      message: 'Add a short description when the transportation cost is non-zero.',
    },
  );
export type SaveRequisitionInput = z.infer<typeof saveRequisitionSchema>;

export const decideRequisitionSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(2000).nullable().default(null),
  /**
   * Optional downward revision at approval. The domain allows the sanctioned figure to differ
   * from the requested one; only approvers may set it, and only when approving.
   */
  approvedAmount: z.number().nonnegative().max(1_000_000_000).nullable().default(null),
  /**
   * Apply the approver's stored signature to the BOM (task 5.2).
   *
   * Defaults to `false` so an existing client, or a rejection, never accidentally signs anything.
   * When true the approver must already have a signature on file; the server refuses rather than
   * quietly approving unsigned, because "I signed that" is not a thing to be wrong about.
   */
  withSignature: z.boolean().default(false),
});
export type DecideRequisitionInput = z.infer<typeof decideRequisitionSchema>;

export const withdrawApprovalSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export type WithdrawApprovalInput = z.infer<typeof withdrawApprovalSchema>;

/**
 * Single-item + over-budget branch (see plan D2/D3). The IM bounces the approved
 * requisition back to the requester; status flips to DRAFT and the chain replays.
 * Refused if the requisition is multi-item (the BOM-customise flow is the
 * legitimate path) or not in APPROVED.
 */
export const sendBackForRevisionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type SendBackForRevisionInput = z.infer<typeof sendBackForRevisionSchema>;

export const listRequisitionsQuerySchema = paginationQuerySchema.extend({
  status: requisitionStatusSchema.optional(),
  search: z.string().trim().max(160).optional(),
  /** Scopes the list to one project — powers the Project Hub's requisitions section. */
  projectId: z.string().uuid().optional(),
  /** The requester's own list. Forced on for callers with no approval role. */
  mine: queryBoolean(false),
  /** The approver/IM queue: things waiting on *me* right now. */
  awaitingMe: queryBoolean(false),
  /**
   * The approver's history: things *I* sanctioned. Deliberately not a status filter — APPROVED
   * is transient (the IM generates a BOM and the requisition moves on), so filtering on it
   * emptied the tab. An approval row is permanent, so this stays accurate forever, and it keeps
   * showing requisitions the other approver later rejected: my approval still happened.
   */
  approvedByMe: queryBoolean(false),
});
export type ListRequisitionsQuery = z.infer<typeof listRequisitionsQuerySchema>;

export const approvalSchema = z.object({
  id: z.string().uuid(),
  stage: z.enum([ApprovalStage.INVENTORY_MANAGER, ApprovalStage.APPROVER]),
  slot: z.number().int(),
  assignedUserId: z.string().uuid(),
  assignedUserName: z.string(),
  /** Prints on the BOM footprint block, so it is carried alongside the name. */
  assignedUserDesignation: z.string(),
  actedByUserId: z.string().uuid().nullable(),
  actedByUserName: z.string().nullable(),
  action: z.enum([
    ApprovalAction.PENDING,
    ApprovalAction.APPROVED,
    ApprovalAction.REJECTED,
    ApprovalAction.WITHDRAWN,
  ]),
  note: z.string().nullable(),
  actedAt: z.string().nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const requisitionEventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  actorId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  payload: z.unknown(),
  createdAt: z.string(),
});
export type RequisitionEvent = z.infer<typeof requisitionEventSchema>;

export const requisitionSchema = z.object({
  id: z.string().uuid(),
  requisitionNo: z.string(),
  requesterId: z.string().uuid(),
  requesterName: z.string(),
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  urgency: requisitionUrgencySchema,
  approvalDeadline: z.string().nullable(),
  reason: z.string().nullable(),
  /** The three money figures (domain-context.md). `funded` arrives with Phase 05. */
  requestedAmount: z.number().nullable(),
  approvedAmount: z.number().nullable(),
  requiredApproverCount: z.number().int().nullable(),
  thresholdAtSubmit: z.number().nullable(),
  status: requisitionStatusSchema,
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  /**
   * Optional rolled-up transportation cost. Already baked into `requestedAmount`; the
   * detail page surfaces the figure and description so approvers see the breakdown.
   */
  transportationCost: z.number().nullable(),
  transportationDescription: z.string().nullable(),
  isOverdue: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Requisition = z.infer<typeof requisitionSchema>;

export interface RequisitionDetail extends Requisition {
  items: RequisitionItem[];
  approvals: Approval[];
  events: RequisitionEvent[];
  /**
   * Optional document the requester attached (quote, vendor proposal, spec sheet).
   * Absent when the requester attached nothing, or replaced — current value only;
   * historical attachments are preserved as `stored_files` rows but not surfaced.
   */
  supportingDocument: SupportingDocument | null;
  /**
   * Download URL for the bytes, computed by the controller so the client can render
   * a paper-thumbnail link without building the URL itself. Path is relative to the api
   * base (`/api/v1`) — not absolute — so the web client's `apiBaseUrl` prefix doesn't
   * double up. `null` when there is no document — the card is then absent from the page.
   */
  supportingDocumentUrl: string | null;
  /**
   * The detail page renders a secondary "For revise" pill next to the status badge when
   * this is true. Set on a DRAFT requisition that was bounced by the IM via
   * `POST /requisitions/:id/send-back-for-revision` and has not yet been re-submitted.
   * Derived from the events log in `findDetail` — a row is in this state when the most
   * recent `SEND_BACK_FOR_REVISION` event is followed by no `SUBMITTED`.
   */
  requiresRevisionTag: boolean;
  /**
   * The "Revised" pill is shown when the requester has re-submitted after a send-back.
   * Stays true until the chain reaches APPROVED (or any terminal state) — viewers later
   * in the lifecycle see a normal status, not "still under revision".
   */
  revisedAfterSendBack: boolean;
  /**
   * Funding figures at every stage transition this requisition has reached so far, plus
   * the figures as they stood at each transition. Powers the "Money and purchasing" stage
   * selector on the Requisition Detail page. Empty array for requisitions that pre-date
   * the migration or have not yet transitioned past submit.
   *
   * Imported type-only to avoid a circular import between `requisitions` and `funds`.
   */
  fundingSnapshots: import('./funds.js').RequisitionFundingSnapshot[];
}

/* -------------------------------------------------------------- delegation */

export const createDelegationSchema = z
  .object({
    delegateUserId: z.string().uuid(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .refine((input) => new Date(input.endsAt) > new Date(input.startsAt), {
    path: ['endsAt'],
    message: 'The end must be after the start',
  });
export type CreateDelegationInput = z.infer<typeof createDelegationSchema>;

export const delegationSchema = z.object({
  id: z.string().uuid(),
  approverUserId: z.string().uuid(),
  approverName: z.string(),
  delegateUserId: z.string().uuid(),
  delegateName: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  isActive: z.boolean(),
  /** True only while `now` is inside the range and the row is active. */
  isCurrentlyEffective: z.boolean(),
});
export type Delegation = z.infer<typeof delegationSchema>;

/* ------------------------------------------------------- approval policy */

/**
 * The approval rules in force right now, readable by any authenticated user.
 *
 * The requisition form has to tell the requester how many approvers their amount will need,
 * live, as they type. The only route exposing the threshold was `@Roles(ADMIN) /admin/settings`,
 * so the form had no way to know — and a threshold hardcoded into the SPA would go stale the
 * first time an admin changed it, which is exactly what requirements §11 makes changeable at
 * runtime to avoid.
 *
 * Read-only and deliberately narrow: the three values the form needs, and nothing else from
 * `app_settings`. Administering settings stays on the admin controller.
 */
export const approvalPolicySchema = z.object({
  expenseThresholdBdt: z.number(),
  /** Requisitions **below** the threshold. */
  approversBelowThreshold: z.number().int(),
  /** Requisitions **at or above** it — the boundary is inclusive (OQ-01). */
  approversAtOrAboveThreshold: z.number().int(),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

/** How many approvers an amount needs. One rule, so the form and the server cannot disagree. */
export function approversRequiredFor(amount: number, policy: ApprovalPolicy): number {
  return amount < policy.expenseThresholdBdt
    ? policy.approversBelowThreshold
    : policy.approversAtOrAboveThreshold;
}
