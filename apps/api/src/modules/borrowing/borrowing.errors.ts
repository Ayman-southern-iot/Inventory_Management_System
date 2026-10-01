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

/**
 * Returned ids are addressable by `GET /borrowing/:id/returns`. Surfacing a 404 lets the UI
 * distinguish "stale URL" from "this return already has a compensating reverse" (which would be
 * a different error code from the service).
 */
export class BorrowReturnNotFoundError extends DomainError {
  constructor() {
    super(
      ErrorCode.NOT_FOUND,
      'No such return on this borrow. It may already have been reversed.',
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * `POST /stock/take` while `ALLOW_DIRECT_TAKE` is off (ADR-0002). Its own code so an integrator
 * can tell "switched off here" from "you may not", and the SPA can say so in plain words.
 */
export class DirectTakeDisabledError extends DomainError {
  constructor() {
    super(
      ErrorCode.DIRECT_TAKE_DISABLED,
      'Taking stock directly is switched off on this system. Raise a borrow request instead.',
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * A key's service account has used its daily allowance (DIRECT_TAKE_DAILY_UNITS_PER_ACCOUNT, Arif
 * 2026-10-01). 429 rather than 409: nothing about the shelf is wrong, the caller is over its quota
 * until the day turns. The details let a panel say how much is left instead of guessing.
 */
export class DirectTakeDailyLimitError extends DomainError {
  constructor(limit: number, takenToday: number, requested: number) {
    super(
      ErrorCode.DIRECT_TAKE_DAILY_LIMIT_REACHED,
      `This key's account may take ${limit} units a day and has taken ${takenToday} today, so ${requested} more would exceed it. Raise a borrow request, or try again tomorrow.`,
      HttpStatus.TOO_MANY_REQUESTS,
      { limit, takenToday, requested },
    );
  }
}
