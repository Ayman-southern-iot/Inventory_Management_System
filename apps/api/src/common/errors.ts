import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ims/shared';

/**
 * Domain failures are typed exceptions carrying a stable `code`, never bare strings
 * (rules/00-engineering-standards.md). The filter turns these into `{ code, message, details? }`.
 */
export class DomainError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export class ValidationFailedError extends DomainError {
  constructor(details: unknown) {
    super(ErrorCode.VALIDATION_FAILED, 'Request validation failed', HttpStatus.BAD_REQUEST, details);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'Authentication required') {
    super(ErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    // Deliberately identical whether the email is unknown or the password is wrong — a
    // different message here is a user-enumeration oracle.
    super(ErrorCode.INVALID_CREDENTIALS, 'Email or password is incorrect', HttpStatus.UNAUTHORIZED);
  }
}

export class AccountDeactivatedError extends DomainError {
  constructor() {
    super(
      ErrorCode.ACCOUNT_DEACTIVATED,
      'This account has been deactivated',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class TokenExpiredError extends DomainError {
  constructor(message = 'Session expired, please sign in again') {
    super(ErrorCode.TOKEN_EXPIRED, message, HttpStatus.UNAUTHORIZED);
  }
}

export class TokenReuseDetectedError extends DomainError {
  constructor() {
    super(
      ErrorCode.TOKEN_REUSE_DETECTED,
      'Session was revoked for security reasons, please sign in again',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class SessionRevokedError extends DomainError {
  constructor() {
    super(
      ErrorCode.SESSION_REVOKED,
      'Your session was ended by an administrator, please sign in again',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to do that') {
    super(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(ErrorCode.NOT_FOUND, `${what} not found`, HttpStatus.NOT_FOUND);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT, details);
  }
}

/**
 * One live delegation per approver (OQ-26). Windows are compared for *overlap*, not for
 * "effective right now": two future delegations that overlap each other are the same defect
 * one day later.
 */
export class DelegationAlreadyLiveError extends DomainError {
  constructor(details?: unknown) {
    super(
      ErrorCode.DELEGATION_ALREADY_LIVE,
      'You already have a delegation covering part of that period. Revoke it first.',
      HttpStatus.CONFLICT,
      details,
    );
  }
}

export class RateLimitedError extends DomainError {
  constructor(retryAfterSeconds: number) {
    super(
      ErrorCode.RATE_LIMITED,
      'Too many attempts. Please wait before trying again.',
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfterSeconds },
    );
  }
}

export class UnknownSettingError extends DomainError {
  constructor(key: string) {
    super(ErrorCode.UNKNOWN_SETTING, `Unknown setting "${key}"`, HttpStatus.BAD_REQUEST);
  }
}
