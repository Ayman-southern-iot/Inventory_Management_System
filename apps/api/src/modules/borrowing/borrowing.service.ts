import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import {
  BorrowStatus,
  Role,
  type CreateBorrowRequestInput,
  type DecideBorrowInput,
  type ReturnBorrowInput,
  type RevertBorrowInput,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';
import { StockService } from '../stock/stock.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_LINKS } from '../notifications/notifications.links';
import type { AuditContext } from '../audit/audit-context';
import { BorrowingRepository } from './borrowing.repository';
import type { Tx } from '../audit/audit.repository';
import {
  BorrowAlreadyDecidedError,
  InvalidBorrowTransitionError,
} from './borrowing.errors';

/** Ledger provenance, so a movement can be traced back to the request that caused it. */
const BORROW_REF_TYPE = 'BORROW';

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
    // Audit row commits atomically with the status flip. `stock.issue` / `stock.release` are
    // each their own transaction (they hold the placement row lock) — so we write the audit row
    // first, then perform the stock move; if the stock move fails the audit row's transaction
    // has already committed the decision, which we then revert.
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
          userIds: [request.requester_id],
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
    });

    try {
      if (input.approve) {
        await this.stock.issue(
          {
            productId: request.product_id,
            compartmentId: request.compartment_id,
            quantity: request.quantity,
          },
          { performedBy: actorId, refType: BORROW_REF_TYPE, refId: id },
        );
      } else {
        await this.stock.release(
          {
            productId: request.product_id,
            compartmentId: request.compartment_id,
            quantity: request.quantity,
          },
          { performedBy: actorId, refType: BORROW_REF_TYPE, refId: id },
        );
      }
    } catch (error) {
      // The stock move failed after the row was claimed. Put the request back so it is visible
      // in the pending list again rather than sitting in a status the shelf does not agree with.
      await this.repo.revertToPending(id);
      throw error;
    }

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
            conditionNote: input.conditionNote,
          },
        },
        context,
        tx,
      );

      // The IM usually records the return on the borrower's behalf, so the borrower is the one
      // who needs telling. `notify` drops the actor, so an IM returning their own borrow gets
      // nothing — which is correct.
      await this.notifications.notify(
        {
          type: 'borrowing.returned',
          userIds: [request.requester_id],
          ref: request.borrow_no,
          link: NOTIFICATION_LINKS.myBorrowings,
          entityType: 'borrowing',
          entityId: id,
          actorId,
          actorName: context.actorName,
          context: { quantity: input.quantity },
        },
        tx,
      );
    });

    try {
      await this.stock.returnStock(
        {
          productId: request.product_id,
          compartmentId: input.compartmentId,
          quantity: input.quantity,
        },
        { performedBy: actorId, refType: BORROW_REF_TYPE, refId: id },
      );
      await this.repo.insertReturn({
        borrowRequestId: id,
        quantity: input.quantity,
        compartmentId: input.compartmentId,
        receivedBy: actorId,
        conditionNote: input.conditionNote,
      });
    } catch (error) {
      await this.repo.rollbackReturn(id, {
        quantity: input.quantity,
        status: request.status,
      });
      throw error;
    }

    return this.requireView(id);
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

      // The borrower had this issued and now does not. That is theirs to know about.
      await this.notifications.notify(
        {
          type: 'borrowing.reverted',
          userIds: [request.requester_id],
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
    });

    await this.stock.release(
      {
        productId: request.product_id,
        compartmentId: request.compartment_id,
        quantity: request.quantity,
      },
      { performedBy: actorId, refType: BORROW_REF_TYPE, refId: id },
    );

    return this.requireView(id);
  }

  private async requireView(id: string) {
    const view = await this.repo.findViewById(id);
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

  /** `executor` so a borrow number can be drawn inside the caller's transaction. */
  private async nextBorrowNo(executor: Db | Tx = this.db): Promise<string> {
    const row = await sql<{ n: string }>`SELECT nextval('borrow_no_seq') AS n`.execute(executor);
    const value = Number(row.rows[0]?.n ?? 1);
    return `BR-${String(value).padStart(6, '0')}`;
  }
}