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
 * The BOM subtotal exceeds the approved total by more than the configured tolerance.
 *
 * In the normal HTTP path the service catches this and routes the request to the bounce
 * path (sources go back for re-approval, BOM row records `over_budget_bounced = true`).
 * This error remains for direct callers — tests, and the rare code path that wants the
 * bounce to surface as a failure rather than a state change.
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
