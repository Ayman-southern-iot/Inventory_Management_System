import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { FileStorageService } from './file-storage.service';

/** The TTL for an orphan SUPPORTING_DOCUMENT before the sweep deletes it. */
const ORPHAN_TTL_HOURS = 24;

/**
 * Sweep job for orphan SUPPORTING_DOCUMENT uploads.
 *
 * `POST /uploads/supporting-document` creates a `stored_files` row in the orphan state
 * (`pending_claim_by = actor.id`) so a requester can attach a file before saving the draft.
 * The draft-create transaction is responsible for claiming it. If the user abandons the
 * form, the orphan stays — and the bytes sit on disk — until this job runs.
 *
 * Window: 24 hours. Generous enough that the user can leave the tab open overnight and
 * come back without re-uploading, short enough that an abandoned upload doesn't accumulate.
 * The partial index `stored_files_pending_claim_idx` makes the query O(orphan count).
 *
 * The delete is row-then-bytes, not bytes-then-row: a row that survived a crash between
 * steps is at worst a row pointing at a missing file, which `FileStorageService.read`
 * surfaces as ENOENT (handled by every read site). The opposite — bytes gone, row alive —
 * is harder to clean up and harder to detect.
 *
 * The sweep is idempotent. A row whose `pending_claim_by` was set to null by a successful
 * claim is filtered out by the WHERE clause; the row itself is the record. The bytes-delete
 * is best-effort and swallows ENOENT, so a failure does not leave the row stranded.
 */
@Injectable()
export class PendingUploadSweepJob {
  private readonly logger = new Logger(PendingUploadSweepJob.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: FileStorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'pending-upload-sweep' })
  async run(): Promise<number> {
    const cutoff = new Date(Date.now() - ORPHAN_TTL_HOURS * 60 * 60 * 1000);
    const orphans = await this.db
      .selectFrom('stored_files as sf')
      .leftJoin('requisitions as r', 'r.supporting_document_file_id', 'sf.id')
      .select(['sf.id', 'sf.relative_path'])
      .where('sf.kind', '=', 'SUPPORTING_DOCUMENT')
      .where('sf.pending_claim_by', 'is not', null)
      .where('sf.created_at', '<', cutoff)
      .where('r.id', 'is', null) // not pointed at by any requisition — defensive, the FK is RESTRICT
      .execute();
    if (orphans.length === 0) return 0;

    const ids = orphans.map((o) => o.id);
    await this.db.deleteFrom('stored_files').where('id', 'in', ids).execute();
    for (const o of orphans) {
      // Best-effort: a missing file is fine (the row is gone; nothing left to read).
      await this.storage.remove(o.relative_path);
    }
    this.logger.log(`Pending upload sweep: removed ${orphans.length} orphan SUPPORTING_DOCUMENT row(s) older than ${cutoff.toISOString()}`);
    return orphans.length;
  }
}
