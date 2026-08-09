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
