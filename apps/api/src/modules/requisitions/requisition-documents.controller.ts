import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { Role, type SupportingDocument } from '@ims/shared';
import { config } from '../../config';
import { ValidationFailedError } from '../../common/errors';
import { AuthenticatedThrottle } from '../../common/throttling';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { RequisitionDocumentsService } from './requisition-documents.service';

/**
 * Three routes on the supporting-document slot of a requisition.
 *
 *   POST   /requisitions/:id/supporting-document     — attach or replace (DRAFT, requester)
 *   DELETE /requisitions/:id/supporting-document     — clear the slot (DRAFT, requester)
 *   GET    /requisitions/:id/supporting-document     — stream the bytes back
 *
 * Authorise:
 *   - POST / DELETE: only the requester, only while DRAFT (enforced in the service). The
 *     role guard is widened so the route is reachable by the requester regardless of role
 *     (a requester may be a `GENERAL` user with no other role).
 *   - GET: requester / IM / Admin / any approver assigned to this requisition (enforced in
 *     the service). No role guard — the predicate is per-row, so a guard is the wrong layer.
 *
 * The interceptor size cap mirrors `funds.controller.ts` — multer buffers the body into
 * memory before the handler runs, so the cap must be at the multipart boundary, not in the
 * service.
 */
@AuthenticatedThrottle
@Controller('requisitions/:id/supporting-document')
export class RequisitionDocumentsController {
  constructor(private readonly docs: RequisitionDocumentsService) {}

  @Post()
  @Roles(Role.GENERAL, Role.INVENTORY_MANAGER, Role.APPROVER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: config.uploads.maxDocumentBytes } }),
  )
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<SupportingDocument> {
    if (!file) throw new ValidationFailedError({ path: 'file', message: 'No file was uploaded' });
    return this.docs.attach(id, file, actor.id, ctx);
  }

  @Delete()
  @Roles(Role.GENERAL, Role.INVENTORY_MANAGER, Role.APPROVER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<void> {
    await this.docs.remove(id, actor.id, ctx);
  }

  /**
   * Stream the bytes back. The same `inline` Content-Disposition the BOM PDF uses — clicking
   * the link should open the file in a new tab, not trigger a download. The browser decides
   * preview vs save from the MIME type.
   */
  @Get()
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    await this.docs.assertCanRead(id, actor);
    const { contents, mimeType, fileName } = await this.docs.readForDownload(id);
    response.setHeader('Content-Type', mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileName)}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(contents);
  }
}