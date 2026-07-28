import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  Role,
  adjustStockSchema,
  listLedgerQuerySchema,
  moveStockSchema,
  receiveStockSchema,
  type AdjustStockInput,
  type LedgerEntry,
  type ListLedgerQuery,
  type MoveStockInput,
  type Paginated,
  type Placement,
  type ReceiveStockInput,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { StockLedgerRepository } from './stock-ledger.repository';
import { toPlacement } from './stock.mappers';
import { StockService } from './stock.service';

/**
 * Only the movements a human performs are exposed.
 *
 * `reserve`, `release`, `issue` and `returnStock` are deliberately absent: they belong to
 * Phase 02's borrow lifecycle, which drives them from a request's state machine. Exposing them
 * as free-standing endpoints would let someone reserve stock with no borrow attached to it.
 */
@Controller('stock')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly ledger: StockLedgerRepository,
  ) {}

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post('receive')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body(zodPipe(receiveStockSchema)) body: ReceiveStockInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<Placement[]> {
    await this.stock.receive(
      {
        productId: body.productId,
        compartmentId: body.compartmentId,
        quantity: body.quantity,
      },
      { performedBy: actor.id, refType: 'MANUAL', ...(body.note ? { note: body.note } : {}) },
    );
    return this.placementsOf(body.productId);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post('move')
  @HttpCode(HttpStatus.OK)
  async move(
    @Body(zodPipe(moveStockSchema)) body: MoveStockInput,
    @CurrentUser() actor: RequestUser,
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
  ): Promise<Placement[]> {
    await this.stock.adjust(
      {
        productId: body.productId,
        compartmentId: body.compartmentId,
        delta: body.delta,
        reason: body.reason,
      },
      { performedBy: actor.id, refType: 'ADJUSTMENT' },
    );
    return this.placementsOf(body.productId);
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
}
