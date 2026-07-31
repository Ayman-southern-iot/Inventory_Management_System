import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Role, type StoredFile } from '@ims/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { config } from '../../config';
import { ValidationFailedError } from '../../common/errors';
import { SignatureService } from './signature.service';

/**
 * The signed-in user's own profile. Everything here is scoped to `@CurrentUser()` and there is
 * deliberately no `:userId` parameter — one approver must never be able to upload or read
 * another's signature, and the simplest way to guarantee that is to give the route no way to
 * name anyone else.
 *
 * `@Roles` still applies: only people who actually sign things need a signature on file.
 */
@Controller('me')
export class ProfileController {
  constructor(private readonly signatures: SignatureService) {}

  @Get('signature')
  @Roles(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN)
  async current(@CurrentUser() actor: RequestUser): Promise<{ signature: StoredFile | null }> {
    return { signature: await this.signatures.currentFor(actor.id) };
  }

  /**
   * The image itself, for the preview on the profile screen.
   *
   * Needs no signed URL because it needs no sharing: it serves the caller their own signature and
   * nothing else, so the bearer token is the whole authorization. The client fetches it as a blob
   * rather than pointing an `<img src>` at it, since an img tag cannot carry the token.
   */
  @Get('signature/content')
  @Roles(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN)
  async content(
    @CurrentUser() actor: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { contents, mimeType } = await this.signatures.readOwn(actor.id);
    response.setHeader('Content-Type', mimeType);
    // A signature is not something to leave in a shared cache.
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(contents);
  }

  /**
   * Upload or replace. A replacement **inserts a new file** and repoints the user; the previous
   * one stays exactly where it is, because approvals already reference it and a BOM printed last
   * month must keep rendering the signature it was actually signed with.
   */
  @Post('signature')
  @Roles(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  // Capped at the interceptor because multer buffers the entire body into memory before the
  // handler runs — FileStorageService's check happens too late to prevent the heap exhaustion.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.uploads.maxImageBytes } }))
  async upload(
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ signature: StoredFile }> {
    // The interceptor gives us `undefined` rather than throwing when the field is missing.
    if (!file?.buffer?.length) {
      throw new ValidationFailedError([{ path: 'file', message: 'No file was uploaded' }]);
    }
    return { signature: await this.signatures.upload(actor.id, file, ctx) };
  }

  /** Stop signing. Past approvals keep their snapshot; only the current pointer is cleared. */
  @Delete('signature')
  @Roles(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<void> {
    await this.signatures.clear(actor.id, ctx);
  }
}
