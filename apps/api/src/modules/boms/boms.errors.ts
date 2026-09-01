import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ims/shared';
import { DomainError } from '../../common/errors';

/**
 * Domain failures for the BOM module.
 *
 * Each carries a stable `ErrorCode` so the web app can branch on the reason, not on the
 * English message. Adding a member is safe; renaming one is a breaking API change.
 */

/**
 * The IM tried to batch a requisition that is not in `APPROVED` onto a BOM. Only approved
 * requisitions are BOM-eligible — anything else has not finished its chain.
 */
export class BomRequisitionNotApprovedError extends DomainError {
  constructor(requisitionNo: string) {
    super(
      ErrorCode.BOM_REQUISITION_NOT_APPROVED,
      `Requisition ${requisitionNo} is not approved and cannot be put on a BOM`,
      HttpStatus.CONFLICT,
      { requisitionNo },
    );
  }
}

/**
 * A second BOM tried to claim a requisition that is already on a live one. The unique
 * partial index on `bom_requisitions(requisition_id) WHERE NOT is_void` is the database
 * invariant; this is its 409 face.
 */
export class BomRequisitionAlreadyOnLiveBomError extends DomainError {
  constructor(requisitionNo: string) {
    super(
      ErrorCode.BOM_ALREADY_ON_LIVE_BOM,
      `Requisition ${requisitionNo} is already on a live BOM`,
      HttpStatus.CONFLICT,
      { requisitionNo },
    );
  }
}

/** Voiding twice is a no-op that should never happen; if it does, it is wrong. */
export class BomAlreadyVoidError extends DomainError {
  constructor(bomNo: string) {
    super(
      ErrorCode.BOM_ALREADY_VOID,
      `BOM ${bomNo} is already void`,
      HttpStatus.CONFLICT,
      { bomNo },
    );
  }
}

/**
 * The BOM subtotal exceeded the configured tolerance. Retired as a generation gate on
 * 2026-08-09 — see the docstring at the top of `boms.service.ts`. The class is kept
 * exported (with its stable `BOM_OVER_BUDGET` error code) so historical audit rows that
 * referenced it still resolve, and so a future "soft warning" path that wants to surface
 * the bounce as a failure rather than a state change has a typed shape to throw.
 */
export class BomOverBudgetError extends DomainError {
  constructor(values: { subtotal: number; approved: number; tolerancePct: number }) {
    super(
      ErrorCode.BOM_OVER_BUDGET,
      'BOM total is over the approved amount by more than the configured tolerance',
      HttpStatus.CONFLICT,
      values,
    );
  }
}

/**
 * A BOM was asked to cover more than one requester. Refused because the BOM number carries the
 * requester's name, and a document naming the wrong person is worse than one naming nobody.
 * Several requisitions from the same requester are still batched onto one BOM.
 */
/** One requester on the attempted BOM, and which of its requisitions are theirs. */
export interface BomRequesterGroup {
  requesterName: string;
  requisitionNos: string[];
}

export class BomSpansMultipleRequestersError extends DomainError {
  /**
   * Grouped by requester and named by requisition, not by person.
   *
   * Listing names alone reads badly the moment two staff share one: the message says "these
   * belong to Gina and Gina" and names nothing anybody can act on. The requisition numbers are
   * unique, are what the IM has on screen, and are what they will un-tick.
   */
  constructor(groups: readonly BomRequesterGroup[]) {
    const described = groups
      .map((group) => group.requesterName + ' (' + group.requisitionNos.join(', ') + ')')
      .join('; ');
    super(
      ErrorCode.BOM_SPANS_MULTIPLE_REQUESTERS,
      'A BOM covers one requester. ' + described,
      HttpStatus.CONFLICT,
      { groups },
    );
  }
}

/** One source requisition whose share of the BOM comes to more than it was approved for. */
export interface OverspentSource {
  requisitionNo: string;
  approved: number;
  items: number;
  transportation: number;
  committed: number;
}

/**
 * The BOM commits more than a requisition's approved amount. Ayman's ruling, 2026-08-29.
 *
 * Nothing downstream can absorb an overspend — Accounts funds against the approved figure —
 * so a BOM above it commits money nobody sanctioned, and the shortfall only surfaces at
 * purchase time with the goods already ordered. The way out is at this screen: adjust the
 * quantity and the unit cost until it fits, or send the requisition back to be restated.
 *
 * Per requisition rather than across the batch, because the approved amount is a promise made
 * about one requisition by its own approvers — one requester's underspend must not quietly
 * fund another's overspend.
 */
export class BomExceedsApprovedAmountError extends DomainError {
  constructor(overspent: readonly OverspentSource[]) {
    super(
      ErrorCode.BOM_EXCEEDS_APPROVED_AMOUNT,
      overspent
        .map(
          (row) =>
            `${row.requisitionNo} commits ${row.committed} (${row.items} of items plus ${row.transportation} transportation) against an approved ${row.approved}`,
        )
        .join('; '),
      HttpStatus.CONFLICT,
      { overspent },
    );
  }
}

/**
 * The IM asked for a `quantity` larger than the source requisition item permits. The IM is
 * allowed to *shrink* a BOM line down (or drop it) — but they cannot conjure stock. This
 * 409 is the precise reason; the error payload names the line so the form can highlight it.
 */
export class BomQuantityExceedsSourceError extends DomainError {
  constructor(values: { itemName: string; requested: number; max: number }) {
    super(
      ErrorCode.BOM_QUANTITY_EXCEEDS_SOURCE,
      `Cannot put ${values.requested} of ${values.itemName} on the BOM — the source requisition only sanctions ${values.max}`,
      HttpStatus.CONFLICT,
      values,
    );
  }
}

/**
 * The IM removed every line on the BOM. The BOM must have at least one line; if the IM
 * genuinely cannot afford anything, the right action is send-back-for-revision on the
 * requisition, not an empty BOM.
 */
export class AllBomLinesRemovedError extends DomainError {
  constructor() {
    super(
      ErrorCode.ALL_BOM_LINES_REMOVED,
      'Every line was removed — the BOM must have at least one line. Use send-back-for-revision if the requester needs to revise the budget.',
      HttpStatus.CONFLICT,
      {},
    );
  }
}
