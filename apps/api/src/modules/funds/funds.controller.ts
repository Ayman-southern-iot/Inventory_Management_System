import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  IDEMPOTENCY_HEADER,
  Role,
  recordFundReceiptSchema,
  recordPurchaseSchema,
  verifyPurchaseSchema,
  sendToAccountsSchema,
  receiveIntoStockSchema,
  borrowToUserSchema,
  type RecordFundReceiptInput,
  type RecordPurchaseInput,
  type RequisitionFunding,
  type VerifyPurchaseInput,
  type SendToAccountsInput,
  type ReceiveIntoStockInput,
  type BorrowToUserInput,
} from '@ims/shared';
import { config } from '../../config';
import { zodPipe } from '../../common/zod-validation.pipe';
import { ConflictError, ValidationFailedError } from '../../common/errors';
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

  /**
   * "Wider" means the requester and this requisition's approvers as well as IM/Admin — not
   * everyone. Without the check any authenticated user could read a requisition's vendors,
   * invoice numbers and totals, and `GET /stock/ledger` hands out requisition ids to anyone.
   */
  @Get('funding')
  async funding(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<RequisitionFunding> {
    await this.funds.assertCanReadFunding(id, actor);
    return this.funds.funding(id);
  }

  @Post('send-to-accounts')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async sendToAccounts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendToAccountsSchema)) body: SendToAccountsInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<RequisitionFunding> {
    await this.funds.sendToAccounts(id, body, actor.id, ctx);
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

  /**
   * Attach the scanned invoice to one purchase. Separate from verification because a requisition
   * bought from three vendors has three invoices arriving on three different days.
   */
  @Post('purchases/:purchaseId/invoice')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  // The limit belongs on the interceptor, not only in FileStorageService: multer buffers the
  // whole upload into memory before the handler runs, so a check that happens after it has
  // finished cannot stop a 2GB body from exhausting the heap on a single-VM deployment.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: config.uploads.maxDocumentBytes } }),
  )
  async attachInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<RequisitionFunding> {
    if (!file) throw new ValidationFailedError({ path: 'file', message: 'No file was uploaded' });
    await this.funds.attachInvoice(id, purchaseId, file, actor.id, ctx);
    return this.funds.funding(id);
  }

  /**
   * Stream the invoice back.
   *
   * Authorised directly rather than through a signed URL: unlike the BOM PDF this is never handed
   * to anyone outside the system, so a shareable link would be capability without a purpose. The
   * permitted set is the people with a legitimate interest in this requisition's paperwork —
   * enforced in the service, which is where a per-row check belongs.
   */
  @Get('purchases/:purchaseId/invoice')
  async downloadInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
    @CurrentUser() actor: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    await this.funds.assertCanReadFunding(id, actor);
    const { contents, mimeType, fileName } = await this.funds.readInvoice(id, purchaseId);
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(contents);
  }

  /** Verify the purchase, and hand back whatever was not spent. */
  @Post('verify-purchase')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async verifyPurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(verifyPurchaseSchema)) body: VerifyPurchaseInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<RequisitionFunding> {
    return this.runOnce(idempotencyKey, actor.id, `funds:verify:${id}`, async () => {
      await this.funds.verifyPurchase(id, body, actor.id, ctx);
      return this.funds.funding(id);
    });
  }

  /**
   * Put a verified purchase onto the shelf. Idempotency-keyed for the same reason as the money
   * endpoints: a double-click here would receive the delivery twice, and the ledger would be
   * internally consistent while describing stock that does not exist.
   */
  @Post('receive-to-stock')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async receiveIntoStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(receiveIntoStockSchema)) body: ReceiveIntoStockInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<RequisitionFunding> {
    return this.runOnce(idempotencyKey, actor.id, `funds:stock:${id}`, async () => {
      await this.funds.receiveIntoStock(id, body, actor.id, ctx);
      return this.funds.funding(id);
    });
  }

  /**
   * The other exit: issue the purchased goods straight to a person rather than shelving them.
   * Idempotency-keyed — a double-click would create two borrows and two stock movements.
   */
  @Post('borrow-to-user')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async borrowToUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(borrowToUserSchema)) body: BorrowToUserInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<RequisitionFunding> {
    return this.runOnce(idempotencyKey, actor.id, `funds:borrow:${id}`, async () => {
      await this.funds.borrowToUser(id, body, actor.id, ctx);
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
