import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  IDEMPOTENCY_HEADER,
  Role,
  bomDownloadQuerySchema,
  generateBomSchema,
  listBomsQuerySchema,
  voidBomSchema,
  type Bom,
  type BomCandidate,
  type BomDetail,
  type BomDownloadQuery,
  type BomSignedUrlResponse,
  type GenerateBomInput,
  type ListBomsQuery,
  type Paginated,
  type VoidBomInput,
} from '@ims/shared';
import { ConflictError } from '../../common/errors';
import { IdempotencyService } from '../../common/idempotency.service';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle, publicThrottle } from '../../common/throttling';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { BomsService } from './boms.service';

@Controller('boms')
@AuthenticatedThrottle
export class BomsController {
  constructor(
    private readonly boms: BomsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Approved requisitions not already on a live BOM, with each requisition's lines
   * pre-filled so the IM only has to type unit cost + vendor.
   */
  @Get('candidates')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  async candidates(): Promise<BomCandidate[]> {
    return this.boms.candidates();
  }

  /**
   * Generate a BOM from one or more approved requisitions.
   *
   * Idempotent per (user, idempotency-key): a double-click submits one BOM, not two,
   * even before the one-live-BOM unique index would catch the second attempt.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(zodPipe(generateBomSchema)) body: GenerateBomInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<BomDetail> {
    return this.runOnce(idempotencyKey, actor.id, `bom:generate:${this.idempotencyScope(body)}`, () =>
      this.boms.generate(body, actor.id, ctx),
    );
  }

  // A BOM carries vendor names, unit costs and the approver footprint for every department.
  // The web app already restricts /boms/* to IM and Admin (App.tsx); these three read handlers
  // were the only place that intent was not actually enforced, so any authenticated General
  // user could read every BOM and pull its PDF.
  @Get()
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  async list(
    @Query(zodPipe(listBomsQuerySchema)) query: ListBomsQuery,
  ): Promise<Paginated<Bom>> {
    return this.boms.list(query);
  }

  @Get(':id')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<BomDetail> {
    return this.boms.requireDetail(id);
  }

  /**
   * Live BOM for a requisition — the IM's quantity override is what the funds panel renders
   * in the record-purchase dialog. Returns `null` if the requisition has no live BOM (older
   * requisitions, or pre-customize fixtures); the client falls back to the original quantity.
   * Same role gate as `/boms/:id` so a general user cannot enumerate BOMs via this route.
   */
  @Get('by-requisition/:requisitionId')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  async findByRequisition(
    @Param('requisitionId', ParseUUIDPipe) requisitionId: string,
  ): Promise<BomDetail | null> {
    return this.boms.findLiveByRequisition(requisitionId);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  async voidBom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(voidBomSchema)) body: VoidBomInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<BomDetail> {
    return this.boms.void(id, body, actor.id, ctx);
  }

  /**
   * Render (or re-render) the PDF and write it under the configured storage root.
   * Idempotent per (user, idempotency-key): a double-click produces one render, not two.
   * Bounced BOMs return 409 — Accounts must never see a document whose sources went back
   * to the approver queue.
   */
  @Post(':id/render')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async renderPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<{ bom: BomDetail }> {
    return this.runOnce(
      idempotencyKey,
      actor.id,
      `bom:render:${id}`,
      async () => ({ bom: await this.boms.ensurePdf(id, actor.id, ctx) }),
    );
  }

  /** Issue a short-lived signed download URL. The URL is the credential, so minting one is
   * exactly as sensitive as reading the BOM itself and carries the same roles. */
  @Get(':id/pdf-url')
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  async pdfUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<BomSignedUrlResponse> {
    return this.boms.signDownloadUrl(id, actor.id);
  }

  /**
   * Stream the cached PDF. `@Public()` because the token in the query string *is* the auth.
   * The service rejects bad/expired/mismatched-BOM tokens with a 403 before touching the
   * database. `@Throttle({public})` keeps this reachable-but-bounded — a token is not free to
   * spam.
   */
  @Get(':id/pdf')
  @publicThrottle
  @Public()
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(bomDownloadQuerySchema)) query: BomDownloadQuery,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const { buffer } = await this.boms.readPdfForDownload(id, query.token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(buffer.length));
    // `inline` lets the browser open the PDF in a tab; the IM download button adds
    // `Content-Disposition: attachment` on the client side. Task 4.3 ships the resource;
    // the SPA UX lives in 4.4.
    res.setHeader('Content-Disposition', 'inline');
    res.end(buffer);
  }

  /**
   * Scopes the idempotency key to the actual content of the request — two clicks with
   * the same key but different line edits must NOT replay the first response.
   */
  private idempotencyScope(input: GenerateBomInput): string {
    return input.requisitionIds.slice().sort().join(',');
  }

  private async runOnce<T>(
    key: string | undefined,
    userId: string,
    scope: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const outcome = await this.idempotency.run({ key, userId, scope }, operation);
    if ('inFlight' in outcome) {
      throw new ConflictError('That BOM generation is already being processed. Try again in a moment.');
    }
    return outcome.result;
  }
}
