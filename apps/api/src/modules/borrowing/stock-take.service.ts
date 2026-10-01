import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  returnDateProblem,
  type Placement,
  type TakeStockInput,
  type TakeStockResult,
} from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../common/errors';
import type { AuditContext } from '../audit/audit-context';
import { toPlacement } from '../stock/stock.mappers';
import { StockService } from '../stock/stock.service';
import { BorrowingRepository } from './borrowing.repository';
import { BorrowingService } from './borrowing.service';
import { DirectTakeDisabledError } from './borrowing.errors';

/**
 * `POST /stock/take` — stock off a shelf in one call (ADR-0002).
 *
 * **Not a third way to issue stock.** It is `BorrowingService.issueFromStock` — the IM's
 * handover, one transaction of reserve → borrow row → ISSUED → `StockService.issue` → audit →
 * notification — reached by a different route. What this adds is only what a caller with no
 * human in the loop needs in front of it: the release flag, the per-call cap, the product checks
 * the borrow form makes, and the product's own returnable default.
 *
 * It writes no SQL of its own. The stock movement is `StockService`'s; the placement it returns
 * is read back through `StockService` after the transaction commits.
 */
@Injectable()
export class StockTakeService {
  private readonly logger = new Logger(StockTakeService.name);

  constructor(
    private readonly borrowing: BorrowingService,
    private readonly repo: BorrowingRepository,
    private readonly stock: StockService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Called before anything else so a switched-off feature answers the same whatever is sent. */
  assertEnabled(): void {
    if (!this.config.directTake.isEnabled) throw new DirectTakeDisabledError();
  }

  /**
   * The holder is always the caller (OQ-KT1): `actorId` is the key's service account or the
   * signed-in person, and it is passed as both the borrower and the issuer.
   */
  async take(input: TakeStockInput, actorId: string, context: AuditContext): Promise<TakeStockResult> {
    this.assertEnabled();

    // Per call, from config (OQ-KT2). Larger handovers go through a borrow request.
    const maxQuantity = this.config.directTake.maxQuantityPerCall;
    if (input.quantity > maxQuantity) {
      throw new ValidationFailedError({
        path: 'quantity',
        message: `At most ${maxQuantity} can be taken in one call`,
      });
    }

    // The same three refusals the borrow form makes (`BorrowingService.create`), in the same words.
    const product = await this.repo.findProductForBorrow(input.productId);
    if (!product) throw new NotFoundError('Product');
    if (!product.is_active) throw new ConflictError('That product has been archived');
    if (!product.is_trackable) {
      throw new ConflictError('That product is not stock-tracked, so it cannot be taken');
    }

    // The contract checks the return date only when the caller states the flag; once the
    // product's default has filled it in, the same predicate runs on the resolved value.
    const isReturnable = input.isReturnable ?? product.default_returnable;
    const dateProblem = returnDateProblem(isReturnable, input.expectedReturnDate);
    if (dateProblem) {
      throw new ValidationFailedError({ path: 'expectedReturnDate', message: dateProblem });
    }

    // An unknown project would otherwise surface as a foreign-key violation, i.e. a 500 to an
    // integrator. (The borrow form has the same gap; it is recorded, not changed here.)
    if (input.projectId !== null && !(await this.repo.projectExists(input.projectId))) {
      throw new NotFoundError('Project');
    }

    const borrow = await this.borrowing.issueFromStock(
      {
        borrowerId: actorId,
        productId: input.productId,
        compartmentId: input.compartmentId,
        quantity: input.quantity,
        projectId: input.projectId,
        isReturnable,
        expectedReturnDate: input.expectedReturnDate,
        purpose: input.purpose,
      },
      actorId,
      context,
      {
        // `channel` is what the caller *says*; which key acted is `audit_log.api_key_id`.
        auditMetadata: { via: 'stock.take', channel: input.channel },
        // OQ-KT4: a take made with a key tells the IMs. A person taking — an IM or an admin —
        // was at the shelf themselves, so nothing happened that no human saw.
        notifyInventoryManagers: context.apiKeyId != null,
        // Only a key's account has a daily allowance (Arif 2026-10-01): a person at the shelf is
        // the check on themselves, and their takes are not counted.
        ...(context.apiKeyId != null
          ? { dailyUnitAllowance: this.config.directTake.dailyUnitsPerAccount }
          : {}),
      },
    );

    /*
     * Read back *after* the take has committed, and never allowed to fail it. This runs inside
     * the idempotency callback: an error here would make IdempotencyService drop the claim, and
     * a retry with the same key would then take the stock a second time. The shelf is a
     * convenience for the caller; the take itself is already true.
     */
    let placement: Placement | null = null;
    try {
      const placements = await this.stock.placementsForProduct(input.productId);
      placement =
        placements
          .map(toPlacement)
          .find((candidate) => candidate.compartmentId === input.compartmentId) ?? null;
    } catch (error) {
      this.logger.warn(`Take ${borrow.borrowNo} committed; placement read-back failed: ${String(error)}`);
    }

    // Ids and quantities only — no requester, holder or decider names (OQ-KT6).
    return {
      borrowId: borrow.id,
      borrowNo: borrow.borrowNo,
      status: borrow.status,
      productId: borrow.productId,
      compartmentId: borrow.compartmentId,
      quantity: borrow.quantity,
      isReturnable: borrow.isReturnable,
      expectedReturnDate: borrow.expectedReturnDate,
      placement,
    };
  }
}
