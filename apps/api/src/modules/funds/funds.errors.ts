import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type RequisitionStatus } from '@ims/shared';
import { DomainError } from '../../common/errors';

/**
 * The lifecycle refuses every transition it does not recognise, and says which state it is in.
 * "Invalid transition" without the current state sends the reader back to the database to find
 * out what actually happened.
 */
export class InvalidFundingTransitionError extends DomainError {
  constructor(current: RequisitionStatus, attempted: string, expected: readonly string[]) {
    super(
      ErrorCode.REQUISITION_INVALID_TRANSITION,
      `This requisition is ${current}, so it cannot be ${attempted}. Expected it to be ${expected.join(' or ')}.`,
      HttpStatus.CONFLICT,
      { current, attempted, expected },
    );
  }
}

/**
 * Recording more money than was approved is refused rather than clamped. Accounts releasing an
 * unexpected amount is a real event that wants a human decision — silently accepting it would
 * make the approved figure meaningless and the expense report wrong.
 */
/**
 * You cannot hand back money you never received, or money already spent. The ceiling is
 * `funded − spent − alreadyReturned`; anything above it means the figures do not describe a real
 * transaction, and quietly accepting it would put the expense report permanently out of balance.
 */
export class ReturnExceedsUnspentError extends DomainError {
  constructor(unspent: number, attempted: number) {
    super(
      ErrorCode.RETURN_EXCEEDS_UNSPENT,
      `Only ${unspent} is unspent, so ${attempted} cannot be returned to Accounts.`,
      HttpStatus.CONFLICT,
      { unspent, attempted },
    );
  }
}

/** Verifying without the paperwork defeats the point of the step. */
export class InvoiceMissingError extends DomainError {
  constructor(count: number) {
    super(
      ErrorCode.INVOICE_MISSING,
      `${count} purchase(s) on this requisition still have no invoice attached. Upload them before verifying.`,
      HttpStatus.CONFLICT,
      { purchasesWithoutInvoice: count },
    );
  }
}

/**
 * A receipt for less than the outstanding balance, while instalments are switched off.
 *
 * CONFLICT rather than a validation failure: the amount is a perfectly valid number, it is the
 * state of the requisition that makes it unacceptable.
 */
export class PartialFundingDisabledError extends DomainError {
  constructor(outstanding: number, attempted: number) {
    super(
      ErrorCode.PARTIAL_FUNDING_DISABLED,
      `This release does not take money in instalments. Record the full outstanding ${outstanding}, not ${attempted}.`,
      HttpStatus.CONFLICT,
      { outstanding, attempted },
    );
  }
}

export class FundingExceedsApprovedError extends DomainError {
  constructor(approved: number, alreadyFunded: number, attempted: number) {
    // Computed here rather than interpolated inline, so `details` carries the figure the copy
    // needs. The client must never add two money values together to build a sentence.
    const wouldBecome = alreadyFunded + attempted;
    super(
      ErrorCode.FUNDING_EXCEEDS_APPROVED,
      `Recording ${attempted} would take the funding to ${wouldBecome}, past the approved ${approved}. Ask an approver to revise the amount first.`,
      HttpStatus.CONFLICT,
      { approved, alreadyFunded, attempted, wouldBecome },
    );
  }
}

/**
 * Receiving more than was bought is not a partial state, it is a mistake. Named with the item so
 * an IM working through a delivery of twenty lines knows which one to look at.
 */
export class ReceiveExceedsPurchasedError extends DomainError {
  constructor(itemName: string, outstanding: number, attempted: number) {
    super(
      ErrorCode.RECEIVE_EXCEEDS_PURCHASED,
      `Only ${outstanding} of "${itemName}" is still outstanding, so ${attempted} cannot be received.`,
      HttpStatus.CONFLICT,
      { itemName, outstanding, attempted },
    );
  }
}

/**
 * Reversing a verify-purchase once money has already been returned to Accounts is not a status
 * flip — it is a new transaction. The right way to undo a refund is a corrective refund, not a
 * rewind, and the IM has to deal with the existing `fund_returns` rows out-of-band.
 */
export class CannotUnverifyWithReturnsError extends DomainError {
  constructor(returnedAmount: number) {
    super(
      ErrorCode.CANNOT_UNVERIFY_WITH_RETURNS,
      `This requisition has ${returnedAmount} returned to Accounts already. Un-verifying is not the right way to undo a refund — record a corrective return instead.`,
      HttpStatus.CONFLICT,
      { returnedAmount },
    );
  }
}

/* ------------------------------------------------------------ reversals */

/**
 * Sending to Accounts is undoable right up until Accounts acts on it. After that the requisition
 * is not "waiting to be sent" any more — money exists against it — and pretending otherwise would
 * leave a receipt attached to a requisition that claims it was never sent.
 */
export class CannotUndoSendWithReceiptsError extends DomainError {
  constructor(funded: number, receiptCount: number) {
    super(
      ErrorCode.CANNOT_UNDO_SEND_WITH_RECEIPTS,
      `Accounts has already released ${funded} against this requisition. Void the receipt first.`,
      HttpStatus.CONFLICT,
      { funded, receiptCount },
    );
  }
}

/**
 * Undo in the order things happened. A purchase stands on the money that funded it, so voiding
 * the receipt underneath it would leave a purchase funded by nothing — the requisition would
 * describe a state that never existed rather than an earlier one.
 */
export class CannotVoidReceiptWithPurchasesError extends DomainError {
  constructor(purchaseCount: number) {
    super(
      ErrorCode.CANNOT_VOID_RECEIPT_WITH_PURCHASES,
      `${purchaseCount} purchase(s) are still recorded against this money. Void those first.`,
      HttpStatus.CONFLICT,
      { purchaseCount },
    );
  }
}

/**
 * The point past which there is no way back. Once units have been received, stock exists on a
 * shelf; voiding the purchase that justified it would leave the ledger describing goods nobody
 * bought. The correction at that point is a stock adjustment, which is a different and
 * deliberately harder operation (ADR-0001 — only StockService moves stock).
 */
export class CannotVoidReceivedPurchaseError extends DomainError {
  constructor(receivedQuantity: number) {
    super(
      ErrorCode.CANNOT_VOID_RECEIVED_PURCHASE,
      `${receivedQuantity} unit(s) from this purchase are already in stock, so it cannot be voided.`,
      HttpStatus.CONFLICT,
      { receivedQuantity },
    );
  }
}

/**
 * Covers both "not on this requisition" and "already voided" on purpose. The two are the same
 * answer to the caller — there is nothing here to act on — and distinguishing them would let a
 * caller probe which receipt ids exist on requisitions they cannot see.
 */
export class MoneyRowNotFoundError extends DomainError {
  constructor(kind: 'receipt' | 'purchase', id: string) {
    super(
      ErrorCode.MONEY_ROW_NOT_FOUND,
      `That ${kind} is not on this requisition, or has already been voided.`,
      HttpStatus.NOT_FOUND,
      { kind, id },
    );
  }
}

/**
 * A purchase that would spend more than has been received.
 *
 * Ayman's ruling, 2026-08-31. Nothing checked before: a 60,000 purchase against 40,500 funded
 * was accepted, and the funding panel then reported Spent 60,000 beside Funded 40,500 with
 * Unspent floored at zero — a state the money cannot actually be in, on a record Accounts
 * reconciles against.
 *
 * Funded rather than approved, because you cannot spend cash you have not received. The
 * carriage counts towards the ceiling: it is spent the moment a purchase exists.
 */
export class PurchaseExceedsFundedError extends DomainError {
  constructor(values: {
    committed: number;
    funded: number;
    alreadySpent: number;
    transportation: number;
  }) {
    super(
      ErrorCode.PURCHASE_EXCEEDS_FUNDED,
      'This purchase would commit ' +
        values.committed +
        ' against ' +
        values.funded +
        ' funded.',
      HttpStatus.CONFLICT,
      values,
    );
  }
}
