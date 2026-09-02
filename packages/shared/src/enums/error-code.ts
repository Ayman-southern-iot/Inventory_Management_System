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
  /**
   * A draft is allowed to be incomplete; a submission is not. Ayman's ruling, 2026-08-26 (D-006):
   * department, approval deadline and reason are required *at submit only*, so the requester can
   * still save a half-finished draft. Project stays optional.
   *
   * Carries `details.missing` — the field names — because the SPA marks the offending inputs, and
   * a single "fill it in" message cannot say which one.
   */
  REQUISITION_INCOMPLETE: 'REQUISITION_INCOMPLETE',
  /** D-003: the deadline had already passed at the moment of submission. */
  APPROVAL_DEADLINE_IN_PAST: 'APPROVAL_DEADLINE_IN_PAST',
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
   * The BOM commits more than a source requisition's approved amount. Ayman's ruling,
   * 2026-08-29: the IM and the requester settle the difference in person by adjusting
   * quantity and unit cost, and the BOM is generated only once it fits.
   *
   * Distinct from the retired `BOM_OVER_BUDGET`, which was a tolerance band measured across
   * the whole batch. This one is exact, per requisition, and counts the transportation the
   * approved figure already includes. Carries `details.overspent` — one entry per offending
   * requisition, with its approved, items, transportation and committed figures, so the
   * screen can say which requisition and by how much.
   */
  BOM_EXCEEDS_APPROVED_AMOUNT: 'BOM_EXCEEDS_APPROVED_AMOUNT',
  /**
   * A purchase would commit more than has been funded. Ayman, 2026-08-31.
   *
   * The ceiling is the money actually received, not the amount approved: a part-funded
   * requisition can only spend the instalment in hand. Carries `details` with the committed
   * total, the funded total, what was already spent and the carriage, so the screen can say
   * how far over it is rather than only that it is over.
   */
  PURCHASE_EXCEEDS_FUNDED: 'PURCHASE_EXCEEDS_FUNDED',
  /**
   * A BOM was asked to cover requisitions from more than one requester. One requester per BOM
   * (Ayman, 2026-08-29), because the BOM number names them.
   */
  BOM_SPANS_MULTIPLE_REQUESTERS: 'BOM_SPANS_MULTIPLE_REQUESTERS',
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

  /*
   * Funds and approval refusals that each carry a specific, useful sentence.
   *
   * All six of these previously reused VALIDATION_FAILED. Since the web app selects copy by
   * `code` and never by message, every one of them surfaced as "please correct the highlighted
   * fields" — on screens that have no field highlighting at all — and the server's actual
   * explanation was discarded on arrival. Five reported QA issues traced to that.
   *
   * Their `details` payloads carry the figures the copy interpolates, so the message the user
   * reads is built from the same numbers the server refused on.
   */

  /** Handing back more than `funded − spent − transportation − alreadyReturned`. */
  RETURN_EXCEEDS_UNSPENT: 'RETURN_EXCEEDS_UNSPENT',
  /** Verifying a purchase while some of its purchases still have no invoice attached. */
  INVOICE_MISSING: 'INVOICE_MISSING',
  /** Logging a receipt that would take total funding past the approved amount. */
  /** Partial funding is switched off for this release; a receipt must clear the balance. */
  PARTIAL_FUNDING_DISABLED: 'PARTIAL_FUNDING_DISABLED',
  FUNDING_EXCEEDS_APPROVED: 'FUNDING_EXCEEDS_APPROVED',
  /** Receiving more units of an item into stock than were actually purchased. */
  RECEIVE_EXCEEDS_PURCHASED: 'RECEIVE_EXCEEDS_PURCHASED',
  /** Un-verifying a purchase after money has already gone back to Accounts. */
  CANNOT_UNVERIFY_WITH_RETURNS: 'CANNOT_UNVERIFY_WITH_RETURNS',

  /*
   * Phase 08 reversals. Each one refuses a step back that would leave the requisition describing
   * something that never happened — the money undone underneath a purchase, or goods booked in
   * against a purchase that no longer exists.
   */
  /** Undoing "sent to Accounts" once Accounts has already released money against it. */
  CANNOT_UNDO_SEND_WITH_RECEIPTS: 'CANNOT_UNDO_SEND_WITH_RECEIPTS',
  /** Voiding a receipt while a purchase is still standing on the money it recorded. */
  CANNOT_VOID_RECEIPT_WITH_PURCHASES: 'CANNOT_VOID_RECEIPT_WITH_PURCHASES',
  /** Voiding a purchase after some of its goods have already been received into stock. */
  CANNOT_VOID_RECEIVED_PURCHASE: 'CANNOT_VOID_RECEIVED_PURCHASE',
  /** The receipt or purchase is not on this requisition, or has already been voided. */
  MONEY_ROW_NOT_FOUND: 'MONEY_ROW_NOT_FOUND',
  /** Approving "with signature" when the approver has never uploaded one. */
  SIGNATURE_NOT_UPLOADED: 'SIGNATURE_NOT_UPLOADED',

  /**
   * An approver tried to sanction more than was requested.
   *
   * Ayman's ruling, 2026-08-20: approved may not exceed requested. The requirements document
   * is silent on revision entirely, so this is a recorded decision rather than a REQUIRED rule
   * (see DECISIONS.md). The mechanical reason it cannot simply be allowed: the BOM's
   * "Remaining" column is defined as requested - approved, so sanctioning more than was asked
   * for makes Remaining negative and the printed document meaningless. An approver who thinks
   * the request is too low sends it back for the requester to restate.
   */
  /** Revising the sanctioned figure is switched off for this release. */
  APPROVED_AMOUNT_REVISION_DISABLED: 'APPROVED_AMOUNT_REVISION_DISABLED',
  APPROVED_EXCEEDS_REQUESTED: 'APPROVED_EXCEEDS_REQUESTED',

  /**
   * An approver tried to hand their authority to a second person for an overlapping window.
   *
   * Ayman's ruling, 2026-08-23 (OQ-26): an approver may hold only ONE live delegation at a
   * time. requirements §4 says "a delegate", singular — suggestive, not decisive — and the
   * deciding reason is that two people simultaneously holding one approver's authority means
   * an approval can be actioned by either, with nothing on the record saying which the
   * approver meant. `isEffectiveDelegate` matches any live row, so before this the second
   * delegation simply won by being asked first.
   */
  DELEGATION_ALREADY_LIVE: 'DELEGATION_ALREADY_LIVE',

  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
