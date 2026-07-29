/**
 * Stable, machine-readable error codes. The web app switches on these; never on the message.
 * Adding a member is safe, renaming one is a breaking API change.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  /** The token was rotated away and then presented again — treat as a possible theft. */
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  /** An administrator ended the session (deactivation, password reset). Nothing sinister. */
  SESSION_REVOKED: 'SESSION_REVOKED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  RATE_LIMITED: 'RATE_LIMITED',
  UNKNOWN_SETTING: 'UNKNOWN_SETTING',

  // Stock. These are the ones later phases branch on rather than just display.
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  /** The caller acted on a placement whose version has since moved (§7.3.2). */
  STOCK_VERSION_CONFLICT: 'STOCK_VERSION_CONFLICT',
  CATEGORY_NOT_TRACKABLE: 'CATEGORY_NOT_TRACKABLE',
  STOCK_RESERVED: 'STOCK_RESERVED',

  // Borrowing
  BORROW_INVALID_TRANSITION: 'BORROW_INVALID_TRANSITION',
  BORROW_ALREADY_DECIDED: 'BORROW_ALREADY_DECIDED',
  DUPLICATE_PROJECT_NAME: 'DUPLICATE_PROJECT_NAME',

  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
