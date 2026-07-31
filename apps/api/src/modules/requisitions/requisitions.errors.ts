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
      ErrorCode.VALIDATION_FAILED,
      'You have not uploaded a signature yet. Add one from your profile, or approve without a signature.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
