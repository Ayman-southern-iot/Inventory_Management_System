import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  IDEMPOTENCY_HEADER,
  Role,
  adjustStockSchema,
  listLedgerQuerySchema,
  moveStockSchema,
  receiveStockSchema,
  resolveQuarantineSchema,
  type AdjustStockInput,
  type LedgerEntry,
  type ListLedgerQuery,
  type MoveStockInput,
  type Paginated,
  type Placement,
  type ReceiveStockInput,
  type ResolveQuarantineInput,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { StockLedgerRepository } from './stock-ledger.repository';
import { toPlacement } from './stock.mappers';
import { StockService } from './stock.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuthenticatedThrottle } from '../../common/throttling';
import { ConflictError } from '../../common/errors';

/**
 * Only the movements a human performs are exposed.
 *
 * `reserve`, `release`, `issue` and `returnStock` are deliberately absent: they belong to
 * Phase 02's borrow lifecycle, which drives them from a request's state machine. Exposing them
 * as free-standing endpoints would let someone reserve stock with no borrow attached to it.
 */
@AuthenticatedThrottle
@Controller('stock')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly ledger: StockLedgerRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * `receive` and `adjust` are the two endpoints with no natural guard against being applied
   * twice. `move` has `expectedVersion`; a borrow decision is conditional on the request's
   * status. A double-clicked "Receive 50" simply receives 100, and nothing detects it —
   * reconciliation compares the ledger against placements and both agree. Hence the
   * Idempotency-Key, which `idempotency_keys` has existed for since Phase 02.
   */
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post('receive')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body(zodPipe(receiveStockSchema)) body: ReceiveStockInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() audit: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<Placement[]> {
    return this.runOnce(idempotencyKey, actor.id, `stock:receive:${body.productId}`, async () => {
      await this.stock.receive(
        {
          productId: body.productId,
          compartmentId: body.compartmentId,
          quantity: body.quantity,
        },
        { performedBy: actor.id, refType: 'MANUAL', ...(body.note ? { note: body.note } : {}) },
        audit,
      );
      return this.placementsOf(body.productId);
    });
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post('move')
  @HttpCode(HttpStatus.OK)
  async move(
    @Body(zodPipe(moveStockSchema)) body: MoveStockInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() audit: AuditContext,
  ): Promise<Placement[]> {
    await this.stock.move(
      {
        productId: body.productId,
        fromCompartmentId: body.fromCompartmentId,
        toCompartmentId: body.toCompartmentId,
        quantity: body.quantity,
        ...(body.expectedVersion === undefined ? {} : { expectedVersion: body.expectedVersion }),
      },
      { performedBy: actor.id, refType: 'MANUAL', ...(body.note ? { note: body.note } : {}) },
      audit,
    );
    // Both chips changed, so the whole placement set comes back rather than just the two rows —
    // the client redraws the card from one response instead of stitching a partial update.
    return this.placementsOf(body.productId);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post('adjust')
  @HttpCode(HttpStatus.OK)
  async adjust(
    @Body(zodPipe(adjustStockSchema)) body: AdjustStockInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() audit: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<Placement[]> {
    return this.runOnce(idempotencyKey, actor.id, `stock:adjust:${body.productId}`, async () => {
      await this.stock.adjust(
        {
          productId: body.productId,
          compartmentId: body.compartmentId,
          delta: body.delta,
          reason: body.reason,
        },
        { performedBy: actor.id, refType: 'ADJUSTMENT' },
        audit,
      );
      return this.placementOf(body.productId, body.compartmentId);
    });
  }

  /**
   * Settle quarantined quantity for a placement. Two outcomes:
   *   RELEASE — the units were verified usable; quarantined_qty decreases only.
   *   DISPOSE — the units are written off; quarantined_qty and quantity both decrease
   *             and a DISPOSE ledger row is appended.
   *
   * The body requires a note because the future reader needs to know which of the two this
   * was and why. Two clicks of "Release 5" against the same placement are also the kind of
   * error the idempotency key exists for, so we run this through `runOnce` too.
   */
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post('quarantine/resolve')
  @HttpCode(HttpStatus.OK)
  async resolveQuarantine(
    @Body(zodPipe(resolveQuarantineSchema)) body: ResolveQuarantineInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() audit: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<Placement[]> {
    return this.runOnce(
      idempotencyKey,
      actor.id,
      `stock:quarantine:${body.productId}:${body.compartmentId}:${body.action}`,
      async () => {
        await this.stock.resolveQuarantine(
          {
            productId: body.productId,
            compartmentId: body.compartmentId,
            action: body.action,
            quantity: body.quantity,
          },
          { performedBy: actor.id, refType: 'QUARANTINE', note: body.note },
          audit,
        );
        return this.placementOf(body.productId, body.compartmentId);
      },
    );
  }

  private async runOnce<T>(
    key: string | undefined,
    userId: string,
    scope: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const outcome = await this.idempotency.run({ key, userId, scope }, operation);
    if ('inFlight' in outcome) {
      // Inventing a response here would be a guess about stock. Telling the caller to retry
      // is honest — same choice as the borrowing controller.
      throw new ConflictError('That request is already being processed. Try again in a moment.');
    }
    return outcome.result;
  }

  /** Readable by any authenticated user; the ledger is the audit trail, not a secret. */
  @Get('ledger')
  async listLedger(
    @Query(zodPipe(listLedgerQuerySchema)) query: ListLedgerQuery,
  ): Promise<Paginated<LedgerEntry>> {
    return this.ledger.list(query);
  }

  private async placementsOf(productId: string): Promise<Placement[]> {
    const rows = await this.stock.placementsForProduct(productId);
    return rows.map(toPlacement);
  }

  /**
   * One placement, returned so the IM card can redraw the single chip that just changed. If the
   * row disappeared (DISPOSE of the last unit, or an adjust to zero) the result is `[]` — the
   * caller treats absence as "this compartment no longer holds stock".
   */
  private async placementOf(
    productId: string,
    compartmentId: string,
  ): Promise<Placement[]> {
    const rows = await this.stock.placementsForProduct(productId);
    return rows.filter((r) => r.compartment_id === compartmentId).map(toPlacement);
  }
}
