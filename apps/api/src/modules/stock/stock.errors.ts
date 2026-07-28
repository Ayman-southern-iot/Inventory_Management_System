import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../common/errors';
import { ErrorCode } from '@ims/shared';

/**
 * Stock failures are typed, not strings — callers in later phases branch on these
 * (rules/00-engineering-standards.md).
 */
export class InsufficientStockError extends DomainError {
  constructor(
    readonly available: number,
    readonly requested: number,
  ) {
    super(
      ErrorCode.INSUFFICIENT_STOCK,
      `Only ${available} available, ${requested} requested`,
      HttpStatus.CONFLICT,
      { available, requested },
    );
  }
}

export class StockVersionConflictError extends DomainError {
  constructor() {
    // §7.3.2 — the IM's screen was rendered against numbers that have since moved.
    super(
      ErrorCode.STOCK_VERSION_CONFLICT,
      'This stock changed while you were looking at it. Refresh and try again.',
      HttpStatus.CONFLICT,
    );
  }
}

export class UntrackedCategoryError extends DomainError {
  constructor(categoryName: string) {
    super(
      ErrorCode.CATEGORY_NOT_TRACKABLE,
      `"${categoryName}" is not a tracked category, so its products cannot hold stock`,
      HttpStatus.CONFLICT,
    );
  }
}

export class ReservedStockError extends DomainError {
  constructor(
    readonly reserved: number,
    readonly attempted: number,
  ) {
    super(
      ErrorCode.STOCK_RESERVED,
      `${reserved} unit(s) are reserved for a pending request and cannot be moved`,
      HttpStatus.CONFLICT,
      { reserved, attempted },
    );
  }
}
