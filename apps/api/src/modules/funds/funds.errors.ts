import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type RequisitionStatus } from '@ims/shared';
import { DomainError } from '../../common/errors';

/**
 * The lifecycle refuses every transition it does not recognise, and says which state it is in.
 * "Invalid transition" without the current state sends the reader back to the database to find
 * out what actually happened.
 */
export class InvalidFundingTransitionError extends DomainError {
  constructor(current: RequisitionStatus, attempted: string, expected: readonly string[]) {
    super(
      ErrorCode.REQUISITION_INVALID_TRANSITION,
      `This requisition is ${current}, so it cannot be ${attempted}. Expected it to be ${expected.join(' or ')}.`,
      HttpStatus.CONFLICT,
      { current, attempted, expected },
    );
  }
}

/**
 * Recording more money than was approved is refused rather than clamped. Accounts releasing an
 * unexpected amount is a real event that wants a human decision — silently accepting it would
 * make the approved figure meaningless and the expense report wrong.
 */
export class FundingExceedsApprovedError extends DomainError {
  constructor(approved: number, alreadyFunded: number, attempted: number) {
    super(
      ErrorCode.VALIDATION_FAILED,
      `Recording ${attempted} would take the funding to ${alreadyFunded + attempted}, past the approved ${approved}. Ask an approver to revise the amount first.`,
      HttpStatus.CONFLICT,
      { approved, alreadyFunded, attempted },
    );
  }
}
