import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type RequisitionStatus } from '@ims/shared';
import { DomainError } from '../../common/errors';

export class InvalidRequisitionTransitionError extends DomainError {
  constructor(from: RequisitionStatus, action: string) {
    super(
      ErrorCode.REQUISITION_INVALID_TRANSITION,
      `A requisition in ${from.replace(/_/g, ' ').toLowerCase()} cannot be ${action}`,
      HttpStatus.CONFLICT,
      { from, action },
    );
  }
}

/**
 * The request-level fields requirements §3 scopes per requisition, which a *submission* must
 * carry even though a draft need not.
 *
 * Ayman's ruling, 2026-08-26, answering D-006. The requirements document lists these fields in
 * §3 but never says they are mandatory, so this is a recorded decision and not a REQUIRED rule
 * — see DECISIONS.md. Project is deliberately absent: a requisition with no project is personal
 * development, which is a real answer rather than a missing one.
 *
 * The deadline is the load-bearing one. §5's reminder flow pings an approver who has not acted
 * "by its approval deadline", so a requisition without one can never trigger the reminder it is
 * entitled to, and nothing downstream notices.
 */
export class RequisitionIncompleteError extends DomainError {
  constructor(missing: readonly string[]) {
    super(
      ErrorCode.REQUISITION_INCOMPLETE,
      `This requisition cannot be submitted yet: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } required. It has been kept as a draft.`,
      HttpStatus.CONFLICT,
      { missing },
    );
  }
}

/**
 * D-003. The deadline field's own helper text says "Pick today or later" and the browser
 * enforced it; the API did not. A requisition could be submitted with a deadline already in the
 * past, arriving Overdue and able to trip the §5 reminder at the moment of submission.
 *
 * Shipped surface promising something it did not keep, so this is a defect rather than a new
 * rule. Enforced only at submit: a draft may hold a stale deadline its author has not revisited.
 */
export class ApprovalDeadlineInPastError extends DomainError {
  constructor(deadline: string, today: string) {
    super(
      ErrorCode.APPROVAL_DEADLINE_IN_PAST,
      `The approval deadline ${deadline} has already passed. Pick ${today} or later before submitting.`,
      HttpStatus.CONFLICT,
      { deadline, today },
    );
  }
}

export class ApprovalAlreadyActedError extends DomainError {
  constructor() {
    // Two approvers acting at the same instant, or a double-click that slipped the key.
    super(
      ErrorCode.APPROVAL_ALREADY_ACTED,
      'That approval has already been acted on. Refresh to see the outcome.',
      HttpStatus.CONFLICT,
    );
  }
}

export class NotYourApprovalError extends DomainError {
  constructor() {
    super(
      ErrorCode.NOT_YOUR_APPROVAL,
      'This approval is not assigned to you',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class ApproverSlotUnassignedError extends DomainError {
  constructor(slotNo: number) {
    // Submitting into a chain with a hole would strand the requisition with nobody to act.
    super(
      ErrorCode.APPROVER_SLOT_UNASSIGNED,
      `Approver ${slotNo} is not assigned. An administrator must set it in Admin → Settings → Approver slots before this can be submitted.`,
      HttpStatus.CONFLICT,
      { slotNo },
    );
  }
}

/**
 * Below the expense threshold the chain does **not** use the approver slots — it uses the single
 * `SUBTHRESHOLD_APPROVER_USER_ID` setting (Phase 05). Both used to raise
 * `ApproverSlotUnassignedError`, which told an admin that "Approver 1 is not assigned" while the
 * approver slots screen sat there showing Approver 1 correctly filled in. Naming the setting
 * that is actually missing is the difference between a two-minute fix and a bug report.
 */
export class SubthresholdApproverUnassignedError extends DomainError {
  constructor(reason: 'unset' | 'inactive') {
    super(
      // Its own code, not the slot one: the web app selects copy by code, so sharing a code
      // means the UI shows the slot wording no matter what message the server sends.
      ErrorCode.SUBTHRESHOLD_APPROVER_UNASSIGNED,
      reason === 'unset'
        ? 'No approver has been chosen for requests below the expense threshold. An administrator must pick one in Admin → Settings → Sub-threshold approver. (The Approver 1 and 2 slots do not apply below the threshold.)'
        : 'The approver chosen for requests below the expense threshold is deactivated. An administrator must pick another in Admin → Settings → Sub-threshold approver.',
      HttpStatus.CONFLICT,
      { setting: 'SUBTHRESHOLD_APPROVER_USER_ID', reason },
    );
  }
}

/**
 * Someone tried to decide an approval on their own requisition. `submit` keeps the requester out
 * of the chain, so this is the backstop for rows assigned before that rule existed and for a
 * delegation that would otherwise hand the requester their own slot.
 */
export class SelfApprovalForbiddenError extends DomainError {
  constructor() {
    super(
      ErrorCode.SELF_APPROVAL_FORBIDDEN,
      'You cannot approve your own requisition. Another approver has to act on this one.',
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * The requester is the configured approver for their own requisition and no substitute exists.
 *
 * requirements §10 (docs/reference/10-permissions.md:19) forbids approving your own requisition
 * and says to skip to the next configured approver. When there is no next one, refusing the
 * submit is the only remaining option — assigning the requester their own approval is precisely
 * what the rule exists to prevent, and silently doing it is how a spend approves itself.
 *
 * OPEN QUESTION: OQ-07 — "skip and substitute" is settled, the substitute is not.
 */
export class SelfApprovalNoSubstituteError extends DomainError {
  constructor(stage: 'inventory_manager' | 'approver') {
    super(
      ErrorCode.SELF_APPROVAL_NO_SUBSTITUTE,
      stage === 'inventory_manager'
        ? 'You are the only active Inventory Manager, so there is nobody to review your own requisition. An administrator must appoint another Inventory Manager before you can submit this.'
        : 'You are the approver for this requisition and nobody is configured to stand in. An administrator must assign another approver before you can submit this.',
      HttpStatus.CONFLICT,
      { stage },
    );
  }
}

/**
 * Approving "with signature" when nothing has been uploaded. Refusing is the point: approving
 * unsigned instead would produce a document whose signature block is silently empty, and the
 * approver would have no idea until Accounts asked why.
 */
export class SignatureNotUploadedError extends DomainError {
  constructor() {
    super(
      ErrorCode.SIGNATURE_NOT_UPLOADED,
      'You have not uploaded a signature yet. Add one from your profile, or approve without a signature.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * An approver revised the sanctioned figure upward past what was asked for.
 *
 * Revising *down* is the whole point of the field — an approver trimming 4,178 to 3,500 is
 * ordinary. Revising up is not the same operation: `requested_amount` is frozen at submit and
 * the BOM prints "Remaining" as requested - approved, so a larger approved figure makes that
 * column negative and the document nonsense. The requester restates the ask instead, which is
 * what send-back-for-revision is for.
 *
 * `requested_amount` already includes transportation cost (it is items + transport, frozen at
 * submit), so the bound is the requested figure itself and needs no adjustment.
 */
export class ApprovedExceedsRequestedError extends DomainError {
  constructor(requested: number, attempted: number) {
    super(
      ErrorCode.APPROVED_EXCEEDS_REQUESTED,
      `Cannot approve ${attempted}: only ${requested} was requested. Approve up to the requested amount, or send the requisition back for revision.`,
      HttpStatus.CONFLICT,
      { requested, attempted },
    );
  }
}

/**
 * The IM tried to send back a requisition for budget revision outside the supported
 * conditions. The path is the single-item + over-budget branch (plan D2/D3): the IM
 * looks at the BOM-generate page, sees the variance is unbridgeable, and bounces the
 * requisition to the requester. Multi-item requisitions must use the BOM-customise
 * path instead — the requester is asked to revise the budget via DRAFT → submit, not
 * via send-back. Below the IM_REVIEW decision, the requester can simply edit the draft.
 *
 * The 409 carries a `reason` field so the web app can say "this is multi-item —
 * use the BOM-customise path" vs "this is not in APPROVED" without parsing the message.
 */
export class CannotSendBackForRevisionError extends DomainError {
  constructor(reason: 'not_approved' | 'multi_item') {
    super(
      ErrorCode.CANNOT_SEND_BACK_FOR_REVISION,
      reason === 'multi_item'
        ? 'Multi-item requisitions use the BOM-customise path, not send-back. Adjust the per-line quantity or remove a line on the BOM generate page.'
        : 'A requisition that is not approved cannot be sent back for revision.',
      HttpStatus.CONFLICT,
      { reason },
    );
  }
}
