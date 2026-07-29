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
      `Approver ${slotNo} is not assigned. An administrator must set it before this can be submitted.`,
      HttpStatus.CONFLICT,
      { slotNo },
    );
  }
}
