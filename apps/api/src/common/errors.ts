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
    super(
      ErrorCode.VALIDATION_FAILED,
      'Request validation failed',
      HttpStatus.BAD_REQUEST,
      details,
    );
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
    super(ErrorCode.ACCOUNT_DEACTIVATED, 'This account has been deactivated', HttpStatus.FORBIDDEN);
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

/**
 * Unknown, revoked or expired. One error for all three on purpose: an anonymous caller holding
 * a wrong string should not learn that a similar one once existed.
 */
export class ApiKeyInvalidError extends DomainError {
  constructor() {
    super(ErrorCode.API_KEY_INVALID, 'API key is not valid', HttpStatus.UNAUTHORIZED);
  }
}

/** Real and current, but switched off by an admin — a different action for the integrator. */
export class ApiKeyDisabledError extends DomainError {
  constructor() {
    super(
      ErrorCode.API_KEY_DISABLED,
      'This API key has been disabled by an administrator',
      HttpStatus.FORBIDDEN,
    );
  }
}

/** A valid key reached a route outside its scopes, or attempted a write. */
export class ApiKeyScopeDeniedError extends DomainError {
  constructor(message = 'This API key does not have access to that endpoint') {
    super(ErrorCode.API_KEY_SCOPE_DENIED, message, HttpStatus.FORBIDDEN);
  }
}

/* ------------------------------------------------------------------ CSV import */

export class ImportAlreadyRunningError extends DomainError {
  constructor() {
    super(
      ErrorCode.IMPORT_ALREADY_RUNNING,
      'An import is already in progress. Wait for it to finish, or abandon it first.',
      HttpStatus.CONFLICT,
    );
  }
}

/** `details` is the whole list, deliberately — see the code's docblock. */
export class ImportValidationFailedError extends DomainError {
  constructor(issues: unknown) {
    super(
      ErrorCode.IMPORT_VALIDATION_FAILED,
      'The file could not be imported. See the list of problems.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      issues,
    );
  }
}

export class ImportFileChangedError extends DomainError {
  constructor() {
    super(
      ErrorCode.IMPORT_FILE_CHANGED,
      'The file changed after it was checked. Upload it again and review the new summary.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ImportSnapshotDeletedError extends DomainError {
  constructor() {
    super(
      ErrorCode.IMPORT_SNAPSHOT_DELETED,
      'The backup for this import was deleted, so it can no longer be restored.',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 503, not 403. The caller is not being refused — the system is briefly unavailable, and an
 * intermediary reading this should understand it is worth retrying.
 */
export class SystemImportInProgressError extends DomainError {
  /**
   * `estimatedFinishAt` rides in `details` because there is nowhere else for it to come from:
   * while the lockout is up, every route that could have answered "when will this end" is itself
   * refused. The padding is already applied (`IMPORT_LOCKOUT_PADDING_MINUTES`) — the screen says
   * ten minutes and the import takes five, which is the right way round.
   */
  constructor(estimatedFinishAt: string | null = null) {
    super(
      ErrorCode.SYSTEM_IMPORT_IN_PROGRESS,
      'The inventory is being updated. Please wait.',
      HttpStatus.SERVICE_UNAVAILABLE,
      { estimatedFinishAt },
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
 * The uploader already holds `MAX_PENDING_UPLOADS_PER_USER` unclaimed supporting documents.
 * CONFLICT rather than TOO_MANY_REQUESTS: this is not a rate the caller should back off and
 * retry, it is a state they have to clear by saving or abandoning a draft.
 */
export class PendingUploadLimitReachedError extends DomainError {
  constructor(limit: number) {
    super(
      ErrorCode.PENDING_UPLOAD_LIMIT_REACHED,
      `You already have ${limit} uploaded documents waiting to be attached. Save or discard a draft before uploading another.`,
      HttpStatus.CONFLICT,
      { limit },
    );
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
