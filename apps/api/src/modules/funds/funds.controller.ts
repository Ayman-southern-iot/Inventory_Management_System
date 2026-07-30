import { Body, Controller, Get, HttpCode, HttpStatus, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  IDEMPOTENCY_HEADER,
  Role,
  recordFundReceiptSchema,
  recordPurchaseSchema,
  type RecordFundReceiptInput,
  type RecordPurchaseInput,
  type RequisitionFunding,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { ConflictError } from '../../common/errors';
import { IdempotencyService } from '../../common/idempotency.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { FundsService } from './funds.service';

/**
 * The money half of a requisition's life. Every mutation is Inventory-Manager (or Admin) only:
 * a coarse role check with no per-row component, so it belongs on the guard rather than in the
 * service (rules/20-backend.md).
 *
 * Reading the funding summary is deliberately wider — the requester needs to see where their own
 * money has got to, and approvers need it for the expense view in 5.8.
 */
@Controller('requisitions/:id')
export class FundsController {
  constructor(
    private readonly funds: FundsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('funding')
  async funding(@Param('id', ParseUUIDPipe) id: string): Promise<RequisitionFunding> {
    return this.funds.funding(id);
  }

  @Post('send-to-accounts')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async sendToAccounts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<RequisitionFunding> {
    await this.funds.sendToAccounts(id, actor.id, ctx);
    return this.funds.funding(id);
  }

  /**
   * Recording money is the endpoint a double-click would duplicate silently — two identical
   * receipts look exactly like two genuine instalments. Hence the Idempotency-Key, the same
   * guard `stock/receive` carries for the same reason.
   */
  @Post('fund-receipts')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async recordReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(recordFundReceiptSchema)) body: RecordFundReceiptInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<RequisitionFunding> {
    return this.runOnce(idempotencyKey, actor.id, `funds:receipt:${id}`, async () => {
      await this.funds.recordReceipt(id, body, actor.id, ctx);
      return this.funds.funding(id);
    });
  }

  @Post('purchases')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async recordPurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(recordPurchaseSchema)) body: RecordPurchaseInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<RequisitionFunding> {
    return this.runOnce(idempotencyKey, actor.id, `funds:purchase:${id}`, async () => {
      await this.funds.recordPurchase(id, body, actor.id, ctx);
      return this.funds.funding(id);
    });
  }

  private async runOnce<T>(
    key: string | undefined,
    userId: string,
    scope: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const outcome = await this.idempotency.run({ key, userId, scope }, operation);
    if ('inFlight' in outcome) {
      throw new ConflictError('That request is already being processed. Try again in a moment.');
    }
    return outcome.result;
  }
}
