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
/**
 * You cannot hand back money you never received, or money already spent. The ceiling is
 * `funded − spent − alreadyReturned`; anything above it means the figures do not describe a real
 * transaction, and quietly accepting it would put the expense report permanently out of balance.
 */
export class ReturnExceedsUnspentError extends DomainError {
  constructor(unspent: number, attempted: number) {
    super(
      ErrorCode.VALIDATION_FAILED,
      `Only ${unspent} is unspent, so ${attempted} cannot be returned to Accounts.`,
      HttpStatus.CONFLICT,
      { unspent, attempted },
    );
  }
}

/** Verifying without the paperwork defeats the point of the step. */
export class InvoiceMissingError extends DomainError {
  constructor(count: number) {
    super(
      ErrorCode.VALIDATION_FAILED,
      `${count} purchase(s) on this requisition still have no invoice attached. Upload them before verifying.`,
      HttpStatus.CONFLICT,
      { purchasesWithoutInvoice: count },
    );
  }
}

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

/**
 * Receiving more than was bought is not a partial state, it is a mistake. Named with the item so
 * an IM working through a delivery of twenty lines knows which one to look at.
 */
export class ReceiveExceedsPurchasedError extends DomainError {
  constructor(itemName: string, outstanding: number, attempted: number) {
    super(
      ErrorCode.VALIDATION_FAILED,
      `Only ${outstanding} of "${itemName}" is still outstanding, so ${attempted} cannot be received.`,
      HttpStatus.CONFLICT,
      { itemName, outstanding, attempted },
    );
  }
}
