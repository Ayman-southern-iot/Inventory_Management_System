import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import {
  BorrowStatus,
  type CreateBorrowRequestInput,
  type DecideBorrowInput,
  type ReturnBorrowInput,
  type RevertBorrowInput,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';
import { StockService } from '../stock/stock.service';
import { BorrowingRepository } from './borrowing.repository';
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
  ) {}

  /**
   * Submitting reserves the stock immediately.
   *
   * Reserving at submit rather than at approval is the whole point: two people cannot both be
   * promised the last unit while the IM thinks about it. `StockService.reserve` takes the row
   * lock, so the second submitter is refused rather than queued behind an optimistic check.
   */
  async create(input: CreateBorrowRequestInput, requesterId: string) {
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

    try {
      const borrowNo = await this.nextBorrowNo();
      const id = await this.repo.insert({
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
      });

      this.logger.log(`Borrow ${borrowNo} raised by ${requesterId} for ${input.quantity} unit(s)`);
      return this.requireView(id);
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
  }

  /**
   * The IM's decision. Approving issues the stock; rejecting releases the reservation.
   *
   * The status guard is a conditional UPDATE rather than a read-then-write: two IMs clicking at
   * the same instant must not both proceed, and `WHERE status = 'PENDING'` affecting zero rows
   * is how the loser finds out.
   */
  async decide(id: string, input: DecideBorrowInput, actorId: string) {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundError('Borrow request');
    if (request.status !== BorrowStatus.PENDING) {
      throw new InvalidBorrowTransitionError(request.status, input.approve ? 'approved' : 'rejected');
    }

    const nextStatus = input.approve ? BorrowStatus.ISSUED : BorrowStatus.REJECTED;
    const claimed = await this.repo.claimPendingDecision(id, {
      status: nextStatus,
      decidedBy: actorId,
      decisionNote: input.note,
      // A rejection never issued anything, so it carries no issue timestamp.
      markIssued: input.approve,
    });
    if (!claimed) throw new BorrowAlreadyDecidedError();

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
  async recordReturn(id: string, input: ReturnBorrowInput, actorId: string) {
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
    // and only the winner puts stock back — otherwise the ledger gains phantom units.
    const claimed = await this.repo.claimReturn(id, {
      quantity: input.quantity,
      expectedReturnedQty: request.returned_qty,
      status: fullyReturned ? BorrowStatus.RETURNED : BorrowStatus.PARTIALLY_RETURNED,
      markReturnedAt: fullyReturned,
    });
    if (!claimed) throw new BorrowAlreadyDecidedError();

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
  async revertToPending(id: string, input: RevertBorrowInput, actorId: string) {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundError('Borrow request');
    if (request.status !== BorrowStatus.ISSUED) {
      throw new InvalidBorrowTransitionError(request.status, 'reverted to pending');
    }
    if (request.returned_qty > 0) {
      throw new ConflictError('Part of this borrow has already been returned');
    }

    // Re-reserve what was issued, then put the request back in the queue.
    await this.stock.receive(
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
    await this.stock.reserve(
      {
        productId: request.product_id,
        compartmentId: request.compartment_id,
        quantity: request.quantity,
      },
      { performedBy: actorId, refType: BORROW_REF_TYPE, refId: id },
    );
    await this.repo.revertToPending(id);

    return this.requireView(id);
  }

  /** The requester withdrawing their own request before anyone has acted on it. */
  async cancel(id: string, actorId: string) {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundError('Borrow request');
    if (request.requester_id !== actorId) {
      throw new ForbiddenError('You can only cancel your own request');
    }
    if (request.status !== BorrowStatus.PENDING) {
      throw new InvalidBorrowTransitionError(request.status, 'cancelled');
    }

    const claimed = await this.repo.claimPendingDecision(id, {
      status: BorrowStatus.CANCELLED,
      decidedBy: actorId,
      decisionNote: null,
      markIssued: false,
    });
    if (!claimed) throw new BorrowAlreadyDecidedError();

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
  private async nextBorrowNo(): Promise<string> {
    const row = await sql<{ n: string }>`SELECT nextval('borrow_no_seq') AS n`.execute(this.db);
    const value = Number(row.rows[0]?.n ?? 1);
    return `BR-${String(value).padStart(6, '0')}`;
  }
}
