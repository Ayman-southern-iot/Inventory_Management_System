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

  // Requisitions and approvals
  REQUISITION_INVALID_TRANSITION: 'REQUISITION_INVALID_TRANSITION',
  APPROVAL_ALREADY_ACTED: 'APPROVAL_ALREADY_ACTED',
  NOT_YOUR_APPROVAL: 'NOT_YOUR_APPROVAL',
  APPROVER_SLOT_UNASSIGNED: 'APPROVER_SLOT_UNASSIGNED',
  /**
   * Distinct from the slot code on purpose. Below the expense threshold the chain does not use
   * the approver slots at all — it uses the single `SUBTHRESHOLD_APPROVER_USER_ID` setting. The
   * web app picks its copy from the code, so sharing one code meant the UI told an admin their
   * approver slots were unassigned while the slots screen showed them correctly filled in.
   */
  SUBTHRESHOLD_APPROVER_UNASSIGNED: 'SUBTHRESHOLD_APPROVER_UNASSIGNED',

  // BOM
  BOM_REQUISITION_NOT_APPROVED: 'BOM_REQUISITION_NOT_APPROVED',
  BOM_ALREADY_ON_LIVE_BOM: 'BOM_ALREADY_ON_LIVE_BOM',
  BOM_ALREADY_VOID: 'BOM_ALREADY_VOID',
  BOM_OVER_BUDGET: 'BOM_OVER_BUDGET',
  PDF_RENDER_FAILED: 'PDF_RENDER_FAILED',
  /** Download URL token failed to verify — wrong BOM, expired, malformed, or wrong secret. */
  PDF_DOWNLOAD_TOKEN_INVALID: 'PDF_DOWNLOAD_TOKEN_INVALID',

  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
