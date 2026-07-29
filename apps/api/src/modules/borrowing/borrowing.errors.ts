import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type BorrowStatus } from '@ims/shared';
import { DomainError } from '../../common/errors';

export class InvalidBorrowTransitionError extends DomainError {
  constructor(from: BorrowStatus, action: string) {
    super(
      ErrorCode.BORROW_INVALID_TRANSITION,
      `A ${from.toLowerCase().replace('_', ' ')} request cannot be ${action}`,
      HttpStatus.CONFLICT,
      { from, action },
    );
  }
}

export class BorrowAlreadyDecidedError extends DomainError {
  constructor() {
    // Two IMs acting at once, or one double-click that slipped past the idempotency key.
    super(
      ErrorCode.BORROW_ALREADY_DECIDED,
      'Someone already decided this request. Refresh to see the outcome.',
      HttpStatus.CONFLICT,
    );
  }
}

export class DuplicateProjectNameError extends DomainError {
  constructor(readonly existingName: string) {
    // OQ-09: a warning the requester can override, not a hard block.
    super(
      ErrorCode.DUPLICATE_PROJECT_NAME,
      `A project called "${existingName}" already exists`,
      HttpStatus.CONFLICT,
      { existingName },
    );
  }
}
