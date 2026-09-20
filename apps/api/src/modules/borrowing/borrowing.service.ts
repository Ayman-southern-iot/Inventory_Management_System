import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import {
  BorrowStatus,
  OUTSTANDING_STATUSES,
  ReturnCondition,
  Role,
  type AssignHolderInput,
  type BorrowRequest,
  type CreateBorrowRequestInput,
  type DecideBorrowInput,
  type IssueFromStockInput,
  type ReturnBorrowInput,
  type RevertBorrowInput,
  type ReverseReturnInput,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors';
import { StockService } from '../stock/stock.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_LINKS } from '../notifications/notifications.links';
import type { AuditContext } from '../audit/audit-context';
import { BorrowingRepository } from './borrowing.repository';
import type { Tx } from '../audit/audit.repository';
import {
  BorrowAlreadyDecidedError,
  BorrowReturnNotFoundError,
  InvalidBorrowTransitionError,
} from './borrowing.errors';

/** Ledger provenance, so a movement can be traced back to the request that caused it. */
const BORROW_REF_TYPE = 'BORROW';

/**
 * `expected_return_date` is a `date` column, and since D-014 the driver hands it back as raw
 * `YYYY-MM-DD` text. The `Date` branch is a guard: if that parser is ever removed this shifts a
 * calendar day rather than throwing, which is the bug it exists to stop.
 */
function toDateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

@Injectable()
export class BorrowingService {
  private readonly logger = new Logger(BorrowingService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: BorrowingRepository,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Submitting reserves the stock immediately.
   *
   * Reserving at submit rather than at approval is the whole point: two people cannot both be
   * promised the last unit while the IM thinks about it. `StockService.reserve` takes the row
   * lock, so the second submitter is refused rather than queued behind an optimistic check.
   */
  async create(
    input: CreateBorrowRequestInput,
    requesterId: string,
    context: AuditContext,
  ) {
    const product = await this.repo.findProductForBorrow(input.productId);
    if (!product) throw new NotFoundError('Product');
    if (!product.is_active) throw new ConflictError('That product has been archived');
    if (!product.is_trackable) {
      throw new ConflictError('That product is not stock-tracked, so it cannot be borrowed');
    }

    // Reserve first. If it fails there is nothing to unwind, whereas creating the row first
    // would leave an orphaned request whenever the stock has gone.
    const placement = await this.stock.reserve(
      {
        productId: input.productId,
        compartmentId: input.compartmentId,
        quantity: input.quantity,
      },
      { performedBy: requesterId, refType: BORROW_REF_TYPE },
    );

    let borrowNo: string;
    let id: string;
    try {
      borrowNo = await this.nextBorrowNo();
      // Audit inside the same transaction as the insert: a successful borrow creation cannot
      // lack its audit row, and a failed audit row rolls the row back so an "everything is
      // audited" promise stays honest.
      id = await this.db.transaction().execute(async (tx) => {
        const newId = await this.repo.insert(
          {
            borrowNo,
            requesterId,
            productId: input.productId,
            placementId: placement.id,
            compartmentId: input.compartmentId,
            quantity: input.quantity,
            projectId: input.projectId,
            isReturnable: input.isReturnable,
            expectedReturnDate: input.expectedReturnDate,
            purpose: input.purpose,
          },
          tx,
        );
        await this.audit.record(
          {
            action: 'borrowing.create',
            entityType: 'borrowing',
            entityId: newId,
            entityRef: borrowNo,
            summary: `Created borrow ${borrowNo} for ${input.quantity} unit(s)`,
            metadata: {
              borrowNo,
              requesterId,
              productId: input.productId,
              compartmentId: input.compartmentId,
              quantity: input.quantity,
              projectId: input.projectId,
              isReturnable: input.isReturnable,
              expectedReturnDate: input.expectedReturnDate,
              purpose: input.purpose,
            },
          },
          context,
          tx,
        );

        // The IMs are the only people who can act on a pending borrow.
        await this.notifications.notify(
          {
            type: 'borrowing.requested',
            userIds: await this.notifications.usersWithRole(Role.INVENTORY_MANAGER, tx),
            ref: borrowNo,
            link: NOTIFICATION_LINKS.borrowingQueue,
            entityType: 'borrowing',
            entityId: newId,
            actorId: requesterId,
            actorName: context.actorName,
          },
          tx,
        );
        return newId;
      });
    } catch (error) {
      // The reservation is only meaningful attached to a request; release it rather than
      // leaving stock silently unavailable to everyone else.
      await this.stock
        .release(
          {
            productId: input.productId,
            compartmentId: input.compartmentId,
            quantity: input.quantity,
          },
          { performedBy: requesterId, refType: BORROW_REF_TYPE },
        )
        .catch((releaseError: unknown) => {
          this.logger.error(
            `Failed to release reservation after a failed borrow insert: ${String(releaseError)}`,
          );
        });
      throw error;
    }

    this.logger.log(`Borrow ${borrowNo} raised by ${requesterId} for ${input.quantity} unit(s)`);
    return this.requireView(id);
  }

  /**
   * The IM's decision. Approving issues the stock; rejecting releases the reservation.
   *
   * The status guard is a conditional UPDATE rather than a read-then-write: two IMs clicking at
   * the same instant must not both proceed, and `WHERE status = 'PENDING'` affecting zero rows
   * is how the loser finds out.
   */
  async decide(id: string, input: DecideBorrowInput, actorId: string, context: AuditContext) {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundError('Borrow request');
    if (request.status !== BorrowStatus.PENDING) {
      throw new InvalidBorrowTransitionError(request.status, input.approve ? 'approved' : 'rejected');
    }

    const nextStatus = input.approve ? BorrowStatus.ISSUED : BorrowStatus.REJECTED;
    const action = input.approve ? 'borrowing.approve' : 'borrowing.reject';
    // One transaction for the whole decision: the claim, the audit row, the notification **and**
    // the stock movement.
    //
    // This used to commit the status first and move stock afterwards, unwinding by hand if the
    // move failed. The `catch` covered a failing query but not a crash, a restart or a dropped
    // connection in the gap — and the residue was invisible, because a stranded `reserved_qty`
    // never appears in the ledger and `SUM(ledger) = quantity` stays balanced (gap G-14). The
    // stock methods take the caller's transaction now, so there is no gap to fall into.
    await this.db.transaction().execute(async (tx) => {
      const didClaim = await this.repo.claimPendingDecision(
        id,
        {
          status: nextStatus,
          decidedBy: actorId,
          decisionNote: input.note,
          // A rejection never issued anything, so it carries no issue timestamp.
          markIssued: input.approve,
        },
        tx,
      );
      if (!didClaim) throw new BorrowAlreadyDecidedError();
      await this.audit.record(
        {
          action,
          entityType: 'borrowing',
          entityId: id,
          entityRef: request.borrow_no,
          summary: input.approve
            ? `Approved borrow ${request.borrow_no}`
            : `Rejected borrow ${request.borrow_no}`,
          metadata: {
            borrowNo: request.borrow_no,
            productId: request.product_id,
            compartmentId: request.compartment_id,
            quantity: request.quantity,
            note: input.note,
          },
        },
        context,
        tx,
      );

      await this.notifications.notify(
        {
          type: input.approve ? 'borrowing.approved' : 'borrowing.rejected',
          // The holder, not the requester. They are the same person on a freshly raised
          // borrow; they differ on one that was reassigned and later reverted to PENDING, and
          // the decision is about equipment that will land with whoever is holding the record.
          userIds: [request.current_holder_id],
          ref: request.borrow_no,
          link: NOTIFICATION_LINKS.myBorrowings,
          entityType: 'borrowing',
          entityId: id,
          actorId,
          actorName: context.actorName,
          context: { note: input.note ?? null },
        },
        tx,
      );

      const movement = {
        productId: request.product_id,
        compartmentId: request.compartment_id,
        quantity: request.quantity,
      };
      const provenance = { performedBy: actorId, refType: BORROW_REF_TYPE, refId: id };

      // Approving issues the stock; rejecting releases the reservation. Either way it rides on
      // `tx`, so a failure rolls the decision back with it — no compensating update needed.
      if (input.approve) {
        await this.stock.issue(movement, provenance, tx);
      } else {
        await this.stock.release(movement, provenance, tx);
      }
    });

    return this.requireView(id);
  }

  /**
   * A returned item comes back to a compartment.
   *
   * Partial returns are normal, so the running `returned_qty` is incremented under the same
   * conditional UPDATE that guards against returning more than is outstanding.
   */
  async recordReturn(
    id: string,
    input: ReturnBorrowInput,
    actorId: string,
    context: AuditContext,
  ) {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundError('Borrow request');

    if (
      request.status !== BorrowStatus.ISSUED &&
      request.status !== BorrowStatus.PARTIALLY_RETURNED
    ) {
      throw new InvalidBorrowTransitionError(request.status, 'returned');
    }
    if (!request.is_returnable) {
      // domain-context.md: a consumable is issued and never returns.
      throw new ConflictError('This was issued as a consumable, so it does not come back');
    }

    const outstanding = request.quantity - request.returned_qty;
    if (input.quantity > outstanding) {
      throw new ConflictError(
        `Only ${outstanding} unit(s) are still out; cannot return ${input.quantity}`,
      );
    }

    const fullyReturned = request.returned_qty + input.quantity === request.quantity;

    // Claim the quantity first. If two IMs record the last return at once, exactly one wins,
    // and only the winner puts stock back — otherwise the ledger gains phantom units. The
    // audit row joins the same transaction so a successful return cannot lack its history.
    await this.db.transaction().execute(async (tx) => {
      const didClaim = await this.repo.claimReturn(
        id,
        {
          quantity: input.quantity,
          expectedReturnedQty: request.returned_qty,
          status: fullyReturned ? BorrowStatus.RETURNED : BorrowStatus.PARTIALLY_RETURNED,
          markReturnedAt: fullyReturned,
        },
        tx,
      );
      if (!didClaim) throw new BorrowAlreadyDecidedError();
      await this.audit.record(
        {
          action: 'borrowing.return',
          entityType: 'borrowing',
          entityId: id,
          entityRef: request.borrow_no,
          summary: `Recorded return of ${input.quantity} unit(s) on borrow ${request.borrow_no}`,
          metadata: {
            borrowNo: request.borrow_no,
            productId: request.product_id,
            compartmentId: input.compartmentId,
            quantity: input.quantity,
            returnedQtyAfter: request.returned_qty + input.quantity,
            fullyReturned,
            condition: input.condition,
          },
        },
        context,
        tx,
      );

      // The IM usually records the return on the borrower's behalf, so the borrower is the one
      // who needs telling — and the borrower is whoever is *holding* it, which after a
      // reassignment is not the person who asked for it. `notify` drops the actor, so an IM
      // returning their own borrow gets nothing — which is correct.
      await this.notifications.notify(
        {
          type: 'borrowing.returned',
          userIds: [request.current_holder_id],
          ref: request.borrow_no,
          link: NOTIFICATION_LINKS.myBorrowings,
          entityType: 'borrowing',
          entityId: id,
          actorId,
          actorName: context.actorName,
          context: { quantity: input.quantity, condition: input.condition },
        },
        tx,
      );

      // Both the stock movement and the `borrow_returns` row ride on `tx`.
      //
      // This used to run them after the claim committed, unwinding with `rollbackReturn` on
      // failure — an unconditional `returned_qty - quantity` plus a status read from *before*
      // the claim. A second partial return landing in between made that compensation subtract
      // from the newer total and stamp the older status back, leaving `returned_qty` and
      // `status` disagreeing with `borrow_returns` (gap G-15). There is nothing to compensate
      // now, so `rollbackReturn` is gone.
      await this.stock.returnStock(
        {
          productId: request.product_id,
          compartmentId: input.compartmentId,
          quantity: input.quantity,
        },
        { performedBy: actorId, refType: BORROW_REF_TYPE, refId: id },
        tx,
      );
      // Damaged / not-working units are physically present on the shelf but excluded from
      // available. We add them to `quarantined_qty` on the same placement in the same transaction
      // — the DB CHECK refuses to put quantity into quarantine past quantity, so partial returns
      // against a fully-quarantined placement are impossible.
      if (
        input.condition === ReturnCondition.DAMAGED ||
        input.condition === ReturnCondition.NOT_WORKING
      ) {
        await this.repo.incrementQuarantine(
          tx,
          request.product_id,
          input.compartmentId,
          input.quantity,
        );
      }
      await this.repo.insertReturn(
        {
          borrowRequestId: id,
          quantity: input.quantity,
          compartmentId: input.compartmentId,
          receivedBy: actorId,
          condition: input.condition,
        },
        tx,
      );
    });

    return this.requireView(id);
  }

  /**
   * The IM needs to correct a return they recorded wrong. The original `borrow_returns` row
   * stays — the ledger is append-only and the audit row that explains the return would
   * otherwise point at nothing. Instead this writes a compensating `ADJUST` ledger row at the
   * same placement (negative quantity) and decrements `returned_qty`. For DAMAGED /
   * NOT_WORKING returns, the quarantine is decremented in lock-step so the placement's
   * `quantity - reserved - quarantined` invariant stays consistent.
   *
   * Refused when the borrow is already REJECTED or CANCELLED — the return can't be reversed
   * because there is no return to reverse. Re-reads the borrow inside the same transaction so
   * the validation is against the live row, not the caller's snapshot.
   */
  async reverseReturn(
    borrowId: string,
    returnId: string,
    input: ReverseReturnInput,
    actorId: string,
    context: AuditContext,
  ): Promise<BorrowRequest> {
    return this.db.transaction().execute(async (tx) => {
      const borrow = await this.repo.findById(borrowId);
      if (!borrow) throw new NotFoundError('Borrow request');
      if (borrow.status === BorrowStatus.REJECTED || borrow.status === BorrowStatus.CANCELLED) {
        throw new InvalidBorrowTransitionError(borrow.status as BorrowStatus, 'reverse a return');
      }

      const ret = await this.repo.findReturnById(returnId, tx);
      if (!ret || ret.borrow_request_id !== borrowId) {
        throw new BorrowReturnNotFoundError();
      }

      // Race protection: decrementReturnedQty uses a WHERE on `returned_qty` so two concurrent
      // reversals cannot both subtract from the same row.
      await this.repo.decrementReturnedQty(borrowId, ret.quantity, borrow.returned_qty, tx);

      // Compensating stock movement. `adjust` writes the ADJUST ledger row and decrements
      // placement.quantity; the reason is the entire point and goes into both the ledger's
      // note column and the audit row.
      await this.stock.adjust(
        {
          productId: borrow.product_id,
          compartmentId: ret.compartment_id,
          delta: -ret.quantity,
          reason: `Reverse return ${returnId}: ${input.reason}`,
        },
        { performedBy: actorId, refType: BORROW_REF_TYPE, refId: borrowId, note: input.reason },
        context,
        tx,
      );

      // For DAMAGED / NOT_WORKING returns, the original put units in quarantine. Release them
      // here so the placement's invariant holds without an explicit reconcile step.
      if (
        ret.condition === ReturnCondition.DAMAGED ||
        ret.condition === ReturnCondition.NOT_WORKING
      ) {
        await this.repo.decrementQuarantine(
          tx,
          borrow.product_id,
          ret.compartment_id,
          ret.quantity,
        );
      }

      await this.audit.record(
        {
          action: 'borrowing.return_reversed',
          entityType: 'borrowing',
          entityId: borrowId,
          entityRef: borrow.borrow_no,
          summary: `Reversed return of ${ret.quantity} unit(s) on borrow ${borrow.borrow_no}`,
          metadata: {
            borrowNo: borrow.borrow_no,
            returnId,
            productId: borrow.product_id,
            compartmentId: ret.compartment_id,
            quantity: ret.quantity,
            condition: ret.condition,
            reason: input.reason,
          },
        },
        context,
        tx,
      );

      return this.requireView(borrowId, tx);
    });
  }

  /** List the returns recorded against a borrow. Used by the detail page's Returns panel. */
  async listReturns(
    borrowId: string,
  ): Promise<Awaited<ReturnType<BorrowingRepository['listReturnsByBorrow']>>> {
    return this.repo.listReturnsByBorrow(borrowId);
  }

  /**
   * OPEN QUESTION: OQ-04 — the IM's ✎ Edit on an approved borrow.
   *
   * Implemented as the recorded working assumption: revert to PENDING, and only before the
   * stock has physically left. Once `issued_at` is set the item is on someone's desk, and
   * pretending the request was never approved would put units back on the shelf that are not
   * there. After issue the correct action is a return, not an edit.
   */
  async revertToPending(
    id: string,
    input: RevertBorrowInput,
    actorId: string,
    context: AuditContext,
  ) {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundError('Borrow request');
    if (request.status !== BorrowStatus.ISSUED) {
      throw new InvalidBorrowTransitionError(request.status, 'reverted to pending');
    }
    if (request.returned_qty > 0) {
      throw new ConflictError('Part of this borrow has already been returned');
    }

    // Re-reserve what was issued, then put the request back in the queue. The revert + audit
    // row are joined so the borrow row never sits in PENDING without the corresponding audit
    // entry, and vice versa.
    // One StockService call, not receive() then reserve(): between two separate transactions
    // the units are momentarily free, and a competing borrow that grabs them leaves this
    // revert half-applied with the receipt already committed.
    await this.stock.receiveAndHold(
      {
        productId: request.product_id,
        compartmentId: request.compartment_id,
        quantity: request.quantity,
      },
      {
        performedBy: actorId,
        refType: BORROW_REF_TYPE,
        refId: id,
        note: `Reverted to pending: ${input.reason}`,
      },
    );
    await this.db.transaction().execute(async (tx) => {
      await this.repo.revertToPending(id, tx);
      await this.audit.record(
        {
          action: 'borrowing.revert',
          entityType: 'borrowing',
          entityId: id,
          entityRef: request.borrow_no,
          summary: `Reverted borrow ${request.borrow_no} to pending`,
          metadata: {
            borrowNo: request.borrow_no,
            productId: request.product_id,
            compartmentId: request.compartment_id,
            quantity: request.quantity,
            reason: input.reason,
          },
        },
        context,
        tx,
      );

      // The borrower had this issued and now does not. That is theirs to know about — and the
      // person who had it is the holder, not necessarily the one who asked for it.
      //
      // The reassignment is deliberately NOT undone here. `current_holder_id` records who the
      // loan is against, and a revert says the issue was wrong, not that a later custody
      // correction was. Silently resetting it to `requester_id` would throw away a decision an
      // IM made on purpose.
      await this.notifications.notify(
        {
          type: 'borrowing.reverted',
          userIds: [request.current_holder_id],
          ref: request.borrow_no,
          link: NOTIFICATION_LINKS.myBorrowings,
          entityType: 'borrowing',
          entityId: id,
          actorId,
          actorName: context.actorName,
          context: { note: input.reason },
        },
        tx,
      );
    });

    return this.requireView(id);
  }

  /**
   * Move an issued loan onto somebody else's name.
   *
   * Ten cables are issued to Rana; three end up with Farah, or Rana leaves and hands the lot
   * over. Until now the only way to record that was a return followed by a fresh issue, which
   * is a lie about the shelf: the units never came back to a compartment.
   *
   * **No `StockService` call and no ledger row, by design** (plan decision D5). The units left
   * the shelf when the borrow was issued; who is holding them afterwards is not a placement
   * fact. Writing a compensating RECEIPT/ISSUE pair here would make the ledger assert a
   * physical movement that did not happen, and `SUM(ledger) = placements.quantity` would still
   * balance — so nobody would ever catch it. If a future change to this method finds itself
   * reaching for `this.stock`, that is the signal the model has gone wrong, not the fix.
   *
   * Restricted to ISSUED / PARTIALLY_RETURNED. A PENDING borrow has nothing in anyone's hands
   * to reassign, and a RETURNED or CANCELLED one is closed history.
   */
  async assignHolder(
    id: string,
    input: AssignHolderInput,
    actorId: string,
    context: AuditContext,
  ): Promise<BorrowRequest> {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundError('Borrow request');
    if (
      request.status !== BorrowStatus.ISSUED &&
      request.status !== BorrowStatus.PARTIALLY_RETURNED
    ) {
      throw new InvalidBorrowTransitionError(request.status, 'reassigned to another holder');
    }
    if (request.current_holder_id === input.holderId) {
      // The DB CHECK says the same thing; this turns it into a sentence instead of a 500.
      throw new ConflictError('That borrow is already recorded against that person');
    }

    return this.db.transaction().execute(async (tx) => {
      const incoming = await tx
        .selectFrom('users')
        .where('id', '=', input.holderId)
        .select(['id', 'full_name', 'is_active'])
        .executeTakeFirst();
      if (!incoming) throw new NotFoundError('User');
      // Same rule and wording as `issueFromStock`: a deactivated account cannot return
      // anything, so making them liable for it creates a loan nobody can close.
      if (!incoming.is_active) {
        throw new ValidationFailedError({
          path: 'holderId',
          message: 'That user is deactivated, so nothing can be recorded against them',
        });
      }

      const outgoing = await tx
        .selectFrom('users')
        .where('id', '=', request.current_holder_id)
        .select(['id', 'full_name'])
        .executeTakeFirstOrThrow();

      // Conditional on the holder and the status the caller read. Two IMs reassigning at once
      // would otherwise both write a transfer out of the same person.
      const didClaim = await this.repo.claimHolderChange(
        id,
        {
          toUserId: input.holderId,
          expectedHolderId: request.current_holder_id,
          allowedStatuses: OUTSTANDING_STATUSES,
        },
        tx,
      );
      if (!didClaim) {
        throw new ConflictError('Someone already moved this borrow. Refresh to see who has it.');
      }

      await this.repo.insertHolderChange(
        {
          borrowRequestId: id,
          fromUserId: request.current_holder_id,
          toUserId: input.holderId,
          changedBy: actorId,
          reason: input.reason,
        },
        tx,
      );

      await this.audit.record(
        {
          action: 'borrowing.holder_changed',
          entityType: 'borrowing',
          entityId: id,
          entityRef: request.borrow_no,
          summary:
            `Moved borrow ${request.borrow_no} from ${outgoing.full_name} ` +
            `to ${incoming.full_name}`,
          metadata: {
            borrowNo: request.borrow_no,
            productId: request.product_id,
            quantity: request.quantity,
            outstandingQty: request.quantity - request.returned_qty,
            fromUserId: request.current_holder_id,
            toUserId: input.holderId,
            // Recorded so the log shows this was a custody correction, not a re-issue.
            stockMoved: false,
            reason: input.reason,
          },
        },
        context,
        tx,
      );

      const dueDate = toDateOnly(request.expected_return_date);
      const outstanding = request.quantity - request.returned_qty;

      // The new holder: this is now yours.
      await this.notifications.notify(
        {
          type: 'borrowing.holder_assigned',
          userIds: [input.holderId],
          ref: request.borrow_no,
          link: NOTIFICATION_LINKS.myBorrowings,
          entityType: 'borrowing',
          entityId: id,
          actorId,
          actorName: context.actorName,
          context: {
            counterpartName: outgoing.full_name,
            quantity: outstanding,
            dueDate,
            note: input.reason,
          },
        },
        tx,
      );

      // The previous holder: this is no longer yours. This half is the point. A transfer that
      // only tells the incoming person leaves the outgoing one unable to show, months later,
      // that they handed it on — which makes the trail paperwork rather than proof.
      //
      // `notify` drops the actor, so an IM moving a loan off their own name is not told about
      // their own action. That is the system-wide rule and it is right here too.
      await this.notifications.notify(
        {
          type: 'borrowing.holder_released',
          userIds: [request.current_holder_id],
          ref: request.borrow_no,
          link: NOTIFICATION_LINKS.myBorrowings,
          entityType: 'borrowing',
          entityId: id,
          actorId,
          actorName: context.actorName,
          context: { counterpartName: incoming.full_name, note: input.reason },
        },
        tx,
      );

      return this.requireView(id, tx);
    });
  }

  /** The requester withdrawing their own request before anyone has acted on it. */
  async cancel(id: string, actorId: string, context: AuditContext) {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundError('Borrow request');
    if (request.requester_id !== actorId) {
      throw new ForbiddenError('You can only cancel your own request');
    }
    if (request.status !== BorrowStatus.PENDING) {
      throw new InvalidBorrowTransitionError(request.status, 'cancelled');
    }

    await this.db.transaction().execute(async (tx) => {
      const didClaim = await this.repo.claimPendingDecision(
        id,
        {
          status: BorrowStatus.CANCELLED,
          decidedBy: actorId,
          decisionNote: null,
          markIssued: false,
        },
        tx,
      );
      if (!didClaim) throw new BorrowAlreadyDecidedError();
      await this.audit.record(
        {
          action: 'borrowing.cancel',
          entityType: 'borrowing',
          entityId: id,
          entityRef: request.borrow_no,
          summary: `Cancelled borrow ${request.borrow_no}`,
          metadata: {
            borrowNo: request.borrow_no,
            productId: request.product_id,
            compartmentId: request.compartment_id,
            quantity: request.quantity,
          },
        },
        context,
        tx,
      );

      // Clears it out of the IMs' pending queue.
      await this.notifications.notify(
        {
          type: 'borrowing.cancelled',
          userIds: await this.notifications.usersWithRole(Role.INVENTORY_MANAGER, tx),
          ref: request.borrow_no,
          link: NOTIFICATION_LINKS.borrowingQueue,
          entityType: 'borrowing',
          entityId: id,
          actorId,
          actorName: context.actorName,
        },
        tx,
      );

      // Same transaction as the cancellation. Releasing afterwards left a window in which the
      // request was CANCELLED but its units were still reserved against it — a reservation held
      // by nothing, which is what `reconcileReservations` now detects (G-14).
      await this.stock.release(
        {
          productId: request.product_id,
          compartmentId: request.compartment_id,
          quantity: request.quantity,
        },
        { performedBy: actorId, refType: BORROW_REF_TYPE, refId: id },
        tx,
      );
    });

    return this.requireView(id);
  }

  private async requireView(id: string, tx?: Tx) {
    const view = await this.repo.findViewById(id, tx);
    if (!view) throw new NotFoundError('Borrow request');
    return view;
  }

  /** Gapless and sequential, so "BR-000042" is a reference people can read out loud. */
  /**
   * Issue stock straight to a person, on their behalf, inside the caller's transaction.
   *
   * Task 5.7: goods bought on a requisition often go to someone rather than onto a shelf. The IM
   * is the person who would approve a borrow anyway, so routing it back to themselves for a
   * decision is theatre — it is created and issued in one step.
   *
   * What it is **not** is a shortcut past the stock rules. The units are received into the
   * compartment and immediately held (`receiveAndHold`), then issued, both on the caller's
   * transaction, so the ledger records a RECEIPT and an ISSUE exactly as an ordinary borrow
   * would and `reserved_qty` is never left stranded. That last part is why this takes a `tx` at
   * all — the split-transaction shape is G-14, and this path must not reproduce it.
   *
   * `requesterId` is the borrower and `actorId` is the IM doing it: the borrow row records whose
   * item it is, the audit row records who handed it over. They are deliberately different
   * parameters — collapsing them is how "issued on behalf of" quietly becomes "issued to myself".
   */
  async issueOnBehalf(
    tx: Tx,
    input: {
      requesterId: string;
      productId: string;
      compartmentId: string;
      quantity: number;
      projectId: string | null;
      isReturnable: boolean;
      expectedReturnDate: string | null;
      purpose: string | null;
      /** Ledger provenance — the requisition this delivery came from. */
      refType: string;
      refId: string;
    },
    actorId: string,
    context: AuditContext,
  ): Promise<{ id: string; borrowNo: string }> {
    const borrowNo = await this.nextBorrowNo(tx);

    const placement = await this.stock.receiveAndHold(
      {
        productId: input.productId,
        compartmentId: input.compartmentId,
        quantity: input.quantity,
      },
      { performedBy: actorId, refType: input.refType, refId: input.refId },
      tx,
    );

    const id = await this.repo.insert(
      {
        borrowNo,
        requesterId: input.requesterId,
        productId: input.productId,
        placementId: placement.id,
        compartmentId: input.compartmentId,
        quantity: input.quantity,
        projectId: input.projectId,
        isReturnable: input.isReturnable,
        expectedReturnDate: input.expectedReturnDate,
        purpose: input.purpose,
      },
      tx,
    );

    // Straight to ISSUED: the IM is the approver, and they have just handed the item over.
    const didClaim = await this.repo.claimPendingDecision(
      id,
      {
        status: BorrowStatus.ISSUED,
        decidedBy: actorId,
        decisionNote: input.purpose,
        markIssued: true,
      },
      tx,
    );
    if (!didClaim) throw new ConflictError('The borrow could not be issued');

    await this.stock.issue(
      {
        productId: input.productId,
        compartmentId: input.compartmentId,
        quantity: input.quantity,
      },
      { performedBy: actorId, refType: BORROW_REF_TYPE, refId: id },
      tx,
    );

    await this.audit.record(
      {
        action: 'borrowing.issue_on_behalf',
        entityType: 'borrowing',
        entityId: id,
        entityRef: borrowNo,
        summary: `Issued ${input.quantity} unit(s) on ${borrowNo} to another user`,
        metadata: {
          borrowNo,
          requesterId: input.requesterId,
          productId: input.productId,
          compartmentId: input.compartmentId,
          quantity: input.quantity,
          refType: input.refType,
          refId: input.refId,
        },
      },
      context,
      tx,
    );

    // The borrower did not ask for this, so they certainly need telling.
    await this.notifications.notify(
      {
        type: 'borrowing.issued_to_you',
        userIds: [input.requesterId],
        ref: borrowNo,
        link: NOTIFICATION_LINKS.myBorrowings,
        entityType: 'borrowing',
        entityId: id,
        actorId,
        actorName: context.actorName,
        context: { quantity: input.quantity, dueDate: input.expectedReturnDate },
      },
      tx,
    );

    return { id, borrowNo };
  }

  /**
   * The IM recording a handover off the shelf: ten arrive, the CTO takes one and says "put it
   * against me". `issueOnBehalf` above does this for goods arriving on a purchase, which is
   * why it starts with `receiveAndHold`; here the units are already on the shelf, so the
   * movement is reserve-then-issue on the placement that exists.
   *
   * One transaction, for the reason G-14 exists: the reservation and the issue that consumes
   * it are a single handover, and a split leaves either a reservation held by nothing or units
   * issued against no borrow.
   */
  async issueFromStock(
    input: IssueFromStockInput,
    actorId: string,
    context: AuditContext,
  ) {
    const id = await this.db.transaction().execute(async (tx) => {
      const borrower = await tx
        .selectFrom('users')
        .where('id', '=', input.borrowerId)
        .select(['id', 'full_name', 'is_active'])
        .executeTakeFirst();
      if (!borrower) throw new NotFoundError('User');
      // Issuing to a deactivated account would create a borrow nobody can return. Same rule
      // and wording as the purchase path in funds.service.ts.
      if (!borrower.is_active) {
        throw new ValidationFailedError({
          path: 'borrowerId',
          message: 'That user is deactivated, so nothing can be issued to them',
        });
      }

      const borrowNo = await this.nextBorrowNo(tx);
      const movement = {
        productId: input.productId,
        compartmentId: input.compartmentId,
        quantity: input.quantity,
      };

      // Reserve first, inside this transaction: `issue` below refuses to take more than is
      // reserved, so this is what proves the units are actually available to hand over.
      const placement = await this.stock.reserve(
        movement,
        { performedBy: actorId, refType: BORROW_REF_TYPE },
        tx,
      );

      const borrowId = await this.repo.insert(
        {
          borrowNo,
          requesterId: input.borrowerId,
          productId: input.productId,
          placementId: placement.id,
          compartmentId: input.compartmentId,
          quantity: input.quantity,
          projectId: input.projectId,
          isReturnable: input.isReturnable,
          expectedReturnDate: input.expectedReturnDate,
          purpose: input.purpose,
        },
        tx,
      );

      // Straight to ISSUED: the IM is the approver and the item is already in someone's hands.
      const didClaim = await this.repo.claimPendingDecision(
        borrowId,
        {
          status: BorrowStatus.ISSUED,
          decidedBy: actorId,
          decisionNote: input.purpose,
          markIssued: true,
        },
        tx,
      );
      if (!didClaim) throw new ConflictError('The borrow could not be issued');

      await this.stock.issue(
        movement,
        { performedBy: actorId, refType: BORROW_REF_TYPE, refId: borrowId },
        tx,
      );

      await this.audit.record(
        {
          action: 'borrowing.issue_on_behalf',
          entityType: 'borrowing',
          entityId: borrowId,
          entityRef: borrowNo,
          summary: `Issued ${input.quantity} unit(s) on ${borrowNo} to ${borrower.full_name} from stock`,
          metadata: {
            borrowNo,
            requesterId: input.borrowerId,
            productId: input.productId,
            compartmentId: input.compartmentId,
            quantity: input.quantity,
            source: 'STOCK',
          },
        },
        context,
        tx,
      );

      // The borrower never asked for this, so the notification is their record that it happened.
      await this.notifications.notify(
        {
          type: 'borrowing.issued_to_you',
          userIds: [input.borrowerId],
          ref: borrowNo,
          link: NOTIFICATION_LINKS.myBorrowings,
          entityType: 'borrowing',
          entityId: borrowId,
          actorId,
          actorName: context.actorName,
          context: { quantity: input.quantity, dueDate: input.expectedReturnDate },
        },
        tx,
      );

      return borrowId;
    });

    return this.requireView(id);
  }

  /** `executor` so a borrow number can be drawn inside the caller's transaction. */
  private async nextBorrowNo(executor: Db | Tx = this.db): Promise<string> {
    const row = await sql<{ n: string }>`SELECT nextval('borrow_no_seq') AS n`.execute(executor);
    const value = Number(row.rows[0]?.n ?? 1);
    return `BR-${String(value).padStart(6, '0')}`;
  }
}