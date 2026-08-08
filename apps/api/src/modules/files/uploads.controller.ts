import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role, type SupportingDocument } from '@ims/shared';
import { config } from '../../config';
import { ValidationFailedError } from '../../common/errors';
import { AuthenticatedThrottle } from '../../common/throttling';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { FilesService } from './files.service';
import { AuditService } from '../audit/audit.service';

/**
 * Pre-draft supporting-document upload.
 *
 *   POST /uploads/supporting-document   — create an orphan stored_files row
 *
 * Lets the requester pick a file on the empty Make Requisition form, before any
 * requisition row exists. The file is written to `stored_files` immediately
 * with `kind = 'SUPPORTING_DOCUMENT'` and `pending_claim_by = actor.id`. When
 * the draft is saved (`POST /requisitions`), `RequisitionsService.createDraft`
 * claims the file in the same transaction: it sets
 * `requisitions.supporting_document_file_id` and clears `pending_claim_by`.
 *
 * The audit row uses a separate action (`requisition.supporting_document_pending`)
 * so the trail distinguishes "file picked on empty form" from "file attached on
 * a saved draft". The orphan's `_pending` row is paired with the eventual
 * `_attached` row the create service writes; an orphan that is never claimed
 * shows up as a `_pending` row without a follow-up — the sweep job writes no
 * audit for the deletion (it is housekeeping, not a domain event).
 *
 * Auth: any authenticated user. The `pendingClaimBy = actor.id` row guards
 * against an attacker claiming another user's orphan — only the uploader can.
 */
@AuthenticatedThrottle
@Controller('uploads/supporting-document')
export class SupportingDocumentUploadController {
  constructor(
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @Roles(Role.GENERAL, Role.INVENTORY_MANAGER, Role.APPROVER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: config.uploads.maxDocumentBytes } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<SupportingDocument> {
    if (!file) throw new ValidationFailedError({ path: 'file', message: 'No file was uploaded' });
    const stored = await this.files.upload({
      kind: 'SUPPORTING_DOCUMENT',
      contents: file.buffer,
      originalName: file.originalname,
      uploadedBy: actor.id,
      pendingClaimBy: actor.id,
    });
    await this.audit.record(
      {
        action: 'requisition.supporting_document_pending',
        entityType: 'stored_file',
        entityId: stored.id,
        summary: `Pre-draft upload of supporting document ${stored.original_name}`,
        metadata: {
          fileId: stored.id,
          originalName: stored.original_name,
          mimeType: stored.mime_type,
          sizeBytes: stored.size_bytes,
        },
      },
      ctx,
    );
    return {
      fileId: stored.id,
      originalName: stored.original_name,
      mimeType: stored.mime_type,
      sizeBytes: stored.size_bytes,
      uploadedAt: stored.created_at.toISOString(),
    };
  }
}
