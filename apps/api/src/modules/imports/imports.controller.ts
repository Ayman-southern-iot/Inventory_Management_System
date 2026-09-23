import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  HttpStatus,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { Role, queryBoolean, type ImportJob } from '@ims/shared';
import { config } from '../../config';
import { ValidationFailedError } from '../../common/errors';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { FilesService } from '../files/files.service';
import { UTF8_BOM, stripBom } from './import-format';
import { ImportJobsService } from './import-jobs.service';
import { ProductExportService } from './product-export.service';

const exportQuerySchema = z.object({
  /**
   * `queryBoolean`, never `z.coerce.boolean()`: this arrives as query-string text and coercion
   * reads every non-empty string — `"false"` included — as `true`.
   *
   * Defaults to **true**, unlike every other `includeInactive` in the codebase. This file is the
   * desired state of the whole catalogue, and one that silently omitted retired products would
   * look complete while telling the next import to deactivate things it had simply not been shown.
   */
  includeInactive: queryBoolean(true),
});

/**
 * The round-trip CSV (`importing_data.md` part B).
 *
 * Deliberately the first thing built, and useful on its own: it is the file you hand to Claude,
 * the format the importer will read back, and the shape a pre-import snapshot is taken in.
 * Nothing else in the feature can be built honestly until this exists, because everything else
 * is defined in terms of it.
 *
 * IM and Admin only. The file carries the whole catalogue including retired products and
 * internal ids — more than the browse screens show, and not something every signed-in user needs.
 */
@AuthenticatedThrottle
@Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
@Controller('inventory')
export class ImportsController {
  constructor(
    private readonly exporter: ProductExportService,
    private readonly files: FilesService,
    private readonly jobs: ImportJobsService,
  ) {}

  /**
   * `POST /inventory/imports` — upload a file and get back what it would do (§5.1).
   *
   * Nothing is written to the catalogue here. The file is stored, validated, and parked in
   * `AWAITING_CONFIRMATION` with its diff attached; a human reads that and decides. The
   * transition out of it is apply, which is part G.
   *
   * The role gate is the controller's, shared with the export above — IM and Admin — rather than
   * a second one written for this route. `fields: 0` for the reason the supporting-document
   * upload gives: `fileSize` bounds the file but not the envelope, and multer's defaults would
   * otherwise buffer an unbounded number of text parts that the express body caps never see.
   */
  @Post('imports')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: config.imports.maxFileBytes, files: 1, fields: 0 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: RequestUser,
  ): Promise<ImportJob> {
    if (!file) throw new ValidationFailedError({ path: 'file', message: 'No file was uploaded' });

    /*
     * Stored before it is validated, on purpose: `import_jobs.file_id` is NOT NULL, the job is
     * the audit trail for "who uploaded what", and a file that failed validation is exactly the
     * one somebody will want to look at again. Storage has already refused anything that is not
     * a UTF-8 CSV by this point (C22).
     */
    const stored = await this.files.upload({
      kind: 'PRODUCT_IMPORT',
      contents: file.buffer,
      originalName: file.originalname,
      uploadedBy: actor.id,
    });

    /*
     * Hashed from the bytes as received, before the BOM is stripped for parsing. The recheck at
     * confirm compares what is on disk against this, so both sides have to mean the same bytes
     * (§5.4). Part G does the comparing.
     */
    const fileSha256 = createHash('sha256').update(file.buffer).digest('hex');

    return this.jobs.start({
      fileId: stored.id,
      fileSha256,
      contents: stripBom(file.buffer.toString('utf8')),
      actorId: actor.id,
    });
  }

  /** The job as it stands, for the confirm screen and for rejoining after a closed browser. */
  @Get('imports/:id')
  async getJob(@Param('id', ParseUUIDPipe) id: string): Promise<ImportJob> {
    return this.jobs.get(id);
  }

  /** Every run, newest first — the history screen (§10). */
  @Get('imports')
  async listJobs(): Promise<ImportJob[]> {
    return this.jobs.listRecent();
  }

  /** Give up an import that is waiting, releasing the one-live slot for somebody else. */
  @Post('imports/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelJob(@Param('id', ParseUUIDPipe) id: string): Promise<ImportJob> {
    return this.jobs.cancel(id);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(
    @Query(zodPipe(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>,
    @Res() response: Response,
  ): Promise<void> {
    const csv = await this.exporter.toCsv({ includeInactive: query.includeInactive });
    const stamp = new Date().toISOString().slice(0, 10);

    response.setHeader('Content-Disposition', `attachment; filename="ims-products-${stamp}.csv"`);
    /*
     * A byte-order mark, because the single most likely reader is Excel on Windows and without
     * one it decodes UTF-8 as the system code page — so a product named "Ø-ring 12mm" opens as
     * mojibake, gets "corrected" by hand, and comes back as a rename. The parser strips it.
     */
    response.send(`${UTF8_BOM}${csv}`);
  }
}
