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

  /**
   * An upload exceeded the configured ceiling. Distinct from INTERNAL because the multipart
   * interceptor rejects the body before any handler runs — without its own code the user is told
   * the server broke, when in fact their file is simply too big.
   */
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
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

  /**
   * The requester holds an approver slot on their own requisition and nobody is configured to
   * stand in. Separate from the two codes above for the same reason they are separate from each
   * other: the fix is "configure another approver", not "fill in the slot you already filled in".
   */
  SELF_APPROVAL_NO_SUBSTITUTE: 'SELF_APPROVAL_NO_SUBSTITUTE',

  /** Deciding an approval on your own requisition. The backstop behind the submit-time rule. */
  SELF_APPROVAL_FORBIDDEN: 'SELF_APPROVAL_FORBIDDEN',

  // BOM
  BOM_REQUISITION_NOT_APPROVED: 'BOM_REQUISITION_NOT_APPROVED',
  BOM_ALREADY_ON_LIVE_BOM: 'BOM_ALREADY_ON_LIVE_BOM',
  BOM_ALREADY_VOID: 'BOM_ALREADY_VOID',
  BOM_OVER_BUDGET: 'BOM_OVER_BUDGET',
  /**
   * The IM asked for a `quantity` larger than the source requisition item permits. The IM
   * is allowed to *shrink* a BOM line down (or drop it) — but they cannot conjure stock.
   */
  BOM_QUANTITY_EXCEEDS_SOURCE: 'BOM_QUANTITY_EXCEEDS_SOURCE',
  /**
   * The IM removed every line on the BOM. The BOM must have at least one line; if the IM
   * genuinely cannot afford anything, the right action is send-back-for-revision on the
   * requisition, not an empty BOM.
   */
  ALL_BOM_LINES_REMOVED: 'ALL_BOM_LINES_REMOVED',
  PDF_RENDER_FAILED: 'PDF_RENDER_FAILED',
  /** Download URL token failed to verify — wrong BOM, expired, malformed, or wrong secret. */
  PDF_DOWNLOAD_TOKEN_INVALID: 'PDF_DOWNLOAD_TOKEN_INVALID',

  /**
   * The IM tried to send back a requisition that is not in `APPROVED`. The send-back
   * path is the single-item + over-budget branch (plan D2/D3); a multi-item requisition
   * cannot be sent back because the BOM-customise path is the legitimate way to handle
   * it. Below the IM_REVIEW decision, the requester can simply edit the draft.
   */
  CANNOT_SEND_BACK_FOR_REVISION: 'CANNOT_SEND_BACK_FOR_REVISION',

  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
