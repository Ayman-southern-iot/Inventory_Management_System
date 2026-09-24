import {
  Controller,
  Get,
  Delete,
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
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import type { RequestUser } from '../auth/request-user';
import { FilesService } from '../files/files.service';
import { UTF8_BOM, stripBom } from './import-format';
import { ImportApplyService } from './import-apply.service';
import { AllowDuringImport } from './import-lock.guard';
import { ImportLockService } from './import-lock.service';
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
    private readonly apply: ImportApplyService,
    private readonly lock: ImportLockService,
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

  /**
   * The job as it stands, for the confirm screen and for rejoining after a closed browser.
   *
   * Allow-listed through the lockout (§8): this is how anyone sees progress at all, including
   * the admin who started the import. Refusing it would leave the whole company staring at a
   * screen that cannot tell them when it ends.
   */
  @AllowDuringImport()
  @Get('imports/:id')
  async getJob(@Param('id', ParseUUIDPipe) id: string): Promise<ImportJob> {
    return this.jobs.get(id);
  }

  /**
   * Put the catalogue back to the state this job's snapshot holds (§10, part K).
   *
   * A new job, not a special path: it runs the whole pipeline, confirm step included, because
   * the snapshot is a round-trip file. 200 rather than 202 — this only reaches
   * `AWAITING_CONFIRMATION`; a human still has to approve what the restore would do, and the
   * screen that asks them is the same diff.
   */
  @Post('imports/:id/restore')
  @HttpCode(HttpStatus.OK)
  async restoreJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<ImportJob> {
    return this.jobs.restore(id, actor.id, this.files);
  }

  /**
   * The snapshot itself, as the CSV it is.
   *
   * Worth having separately from restore: an IM who wants to see what changed can diff this
   * against a fresh export in a spreadsheet, without putting the catalogue back to find out.
   */
  @Get('imports/:id/snapshot')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async downloadSnapshot(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { contents, fileName } = await this.jobs.readSnapshot(id, this.files);
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(contents);
  }

  /**
   * Reclaim the bytes (§10). The job, its diff and its history survive — only the restore point
   * goes, and `snapshot_deleted_at` records that it once existed.
   */
  @Delete('imports/:id/snapshot')
  @HttpCode(HttpStatus.OK)
  async deleteSnapshot(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuditContext() auditContext: AuditContext,
  ): Promise<ImportJob> {
    return this.jobs.deleteSnapshot(id, this.files, auditContext);
  }

  /** Every run, newest first — the history screen (§10). */
  @Get('imports')
  async listJobs(): Promise<ImportJob[]> {
    return this.jobs.listRecent();
  }

  /**
   * The human gate closing: apply what the diff said (§5.5).
   *
   * **202, not 200.** §11.4: the request that starts an apply cannot wait three minutes for a
   * response, so this answers with the job as soon as it is safely `APPLYING` and the work
   * continues server-side. Part J's progress endpoint is the read side of that; until it lands,
   * `GET /inventory/imports/:id` already shows where the run got to.
   */
  @Post('imports/:id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  async confirmJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() auditContext: AuditContext,
  ): Promise<ImportJob> {
    // `completed` is deliberately dropped: the point of 202 is not waiting for it. The service
    // attaches its own catch, so nothing here can become an unhandled rejection.
    const { job } = await this.apply.confirm(id, actor, auditContext);
    return job;
  }

  /**
   * The manual release (§8). Frees a lockout whose import is stuck.
   *
   * Allow-listed, necessarily: a lockout with no way out is a lockout that ends in a container
   * restart. It goes through the same `release` the heartbeat guard uses, so the two cannot
   * clear different halves of the state.
   */
  @AllowDuringImport()
  @Post('imports/:id/abandon')
  @HttpCode(HttpStatus.OK)
  async abandonJob(@Param('id', ParseUUIDPipe) id: string): Promise<ImportJob> {
    return this.jobs.abandon(id, this.lock);
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
