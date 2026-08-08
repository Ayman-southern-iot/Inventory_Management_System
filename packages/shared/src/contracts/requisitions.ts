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

export const saveRequisitionSchema = z.object({
  departmentId: z.string().uuid().nullable().default(null),
  projectId: z.string().uuid().nullable().default(null),
  urgency: requisitionUrgencySchema.default(RequisitionUrgency.NORMAL),
  approvalDeadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
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
});
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

export const listRequisitionsQuerySchema = paginationQuerySchema.extend({
  status: requisitionStatusSchema.optional(),
  search: z.string().trim().max(160).optional(),
  /** Scopes the list to one project — powers the Project Hub's requisitions section. */
  projectId: z.string().uuid().optional(),
  /** The requester's own list. Forced on for callers with no approval role. */
  mine: queryBoolean(false),
  /** The approver/IM queue: things waiting on *me* right now. */
  awaitingMe: queryBoolean(false),
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
   * a paper-thumbnail link without building the URL itself. `null` when there is no
   * document — the card is then absent from the page.
   */
  supportingDocumentUrl: string | null;
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
