import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ImportJobStatus, LIVE_IMPORT_STATUSES, type ImportJob } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import {
  ConflictError,
  ImportAlreadyRunningError,
  ImportSnapshotDeletedError,
  NotFoundError,
} from '../../common/errors';
import { isUniqueViolation } from '../../common/pg-errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { stripBom } from './import-format';
import { ImportValidationService } from './import-validation.service';
import { ImportLockService } from './import-lock.service';
import {
  ImportJobsRepository,
  type ImportJobReport,
  type ImportJobRow,
} from './import-jobs.repository';

/**
 * The state machine between uploading a file and approving what it would do
 * (`importing_data.md` §5.1–5.4).
 *
 * The reason this is a persisted job rather than one request: validation and apply are separate
 * decisions, minutes apart, made by a person reading a diff. Something has to hold the outcome in
 * between, survive the browser being closed (C33), and stop a second admin starting a run while
 * the first is still deciding (C32).
 *
 * **Part E stops at `AWAITING_CONFIRMATION`.** The transition out of it is apply, and apply is
 * part G; a confirm endpoint whose success path did nothing could only be asserted on "returned
 * 200", which is the absence of an invariant dressed up as a test.
 */
export const IMPORT_JOB_KIND = 'products';

/**
 * Just the file operations a restore needs.
 *
 * Passed in rather than injected for the same reason `ImportLockRelease` is: this module is
 * below `FilesModule` in the graph the other direction, and the narrow type says exactly what
 * this path may do with files — read one, write one, nothing else.
 */
export interface ImportFileStore {
  readContents(id: string): Promise<{ contents: Buffer }>;
  upload(input: {
    kind: 'PRODUCT_IMPORT';
    contents: Buffer;
    originalName: string;
    uploadedBy: string;
  }): Promise<{ id: string }>;
}

/** `ImportFileStore` plus the one destructive operation, kept separate for the same reason. */
export interface ImportSnapshotStore {
  remove(id: string): Promise<void>;
}

/**
 * Just enough of `ImportLockService` for `abandon` to call the one unlock.
 *
 * The narrow type is the point: that path may release the lock and may do nothing else to it.
 * The controller passes it in, which also lets `abandon` be tested without the lock service.
 *
 * It said here that injecting the lock service would close a dependency circle. It would not —
 * `ImportLockService` depends on this module's *repository*, not on this service — and the crash
 * reclaim below needs more of it than `release`, so the service is now injected as well. This
 * interface stays because a caller that only releases should still only be able to release.
 */
export interface ImportLockRelease {
  release(jobId: string, status: ImportJobStatus | null): Promise<void>;
}

@Injectable()
export class ImportJobsService {
  constructor(
    private readonly repo: ImportJobsRepository,
    private readonly validation: ImportValidationService,
    private readonly audit: AuditService,
    private readonly lock: ImportLockService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Validate a file that is already stored, and park the result for a human.
   *
   * The file arrives as text the caller has already read, not as an id to go and fetch: that
   * keeps this testable without the upload path, and part K's restore hands it a snapshot the
   * same way.
   */
  async start(input: {
    fileId: string;
    fileSha256: string;
    contents: string;
    actorId: string;
    isRestore?: boolean;
    restoredFromJobId?: string | null;
  }): Promise<ImportJob> {
    // Before competing for the one-live slot, release it if the holder has gone stale. A job
    // nobody ever confirmed would otherwise block every future import for ever.
    await this.expireStaleJob();

    let jobId: string;
    try {
      jobId = await this.repo.insert({
        kind: IMPORT_JOB_KIND,
        status: ImportJobStatus.VALIDATING,
        fileId: input.fileId,
        fileSha256: input.fileSha256,
        createdBy: input.actorId,
        restoredFromJobId: input.restoredFromJobId ?? null,
      });
    } catch (error) {
      /*
       * C32. The partial unique index is the guard, not a check-then-insert — two admins
       * uploading in the same second both pass a check and only one passes the index. What
       * reaches the user has to be a readable 409, though, not a raw constraint name.
       */
      if (isUniqueViolation(error)) throw new ImportAlreadyRunningError();
      throw error;
    }

    const outcome = await this.validation.validate(input.contents, {
      isRestore: input.isRestore,
    });

    const report: ImportJobReport = {
      errors: outcome.errors,
      warnings: outcome.warnings,
      diff: outcome.diff,
    };

    const failed = outcome.errors.length > 0;
    await this.repo.update(jobId, {
      status: failed ? ImportJobStatus.FAILED : ImportJobStatus.AWAITING_CONFIRMATION,
      totalRows: outcome.rowCount,
      report,
      // A failed run is over. One awaiting confirmation is not, which is what holds the slot.
      finishedAt: failed ? new Date() : null,
    });

    return this.require(jobId);
  }

  async get(id: string): Promise<ImportJob> {
    await this.expireStaleJob();
    return this.require(id);
  }

  async listRecent(): Promise<ImportJob[]> {
    await this.expireStaleJob();
    const rows = await this.repo.listRecent(this.config.imports.historyLimit);
    return rows.map((row) => toContract(row, this.config));
  }

  /** The person who started it changed their mind, or an admin is clearing the slot. */
  async cancel(id: string): Promise<ImportJob> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError('Import');

    if (row.status !== ImportJobStatus.AWAITING_CONFIRMATION) {
      throw new ConflictError(
        `This import is ${row.status.toLowerCase().replace(/_/g, ' ')}; only one waiting for confirmation can be cancelled.`,
      );
    }

    await this.repo.update(id, {
      status: ImportJobStatus.CANCELLED,
      finishedAt: new Date(),
    });
    return this.require(id);
  }

  /**
   * Put the catalogue back to the state a snapshot holds (§10, part K).
   *
   * **It is an import, not a special path.** The snapshot is a round-trip export file, so
   * restoring runs the same validation, the same diff, the same confirm gate, the same lockout
   * and the same apply as any other file. There is no second format and no second code path that
   * could drift from the first — which is the whole reason the snapshot was written in that
   * format rather than as a dump.
   *
   * The bytes are copied into a new `PRODUCT_IMPORT` file rather than the job pointing at the
   * snapshot itself. `import_jobs.file_id` is `ON DELETE RESTRICT`, so sharing the row would
   * make the snapshot undeletable for as long as the restore existed — and deleting a backup to
   * reclaim the bytes is a thing §10 explicitly allows.
   */
  async restore(sourceJobId: string, actorId: string, files: ImportFileStore): Promise<ImportJob> {
    const source = await this.repo.findById(sourceJobId);
    if (!source) throw new NotFoundError('Import');
    if (!source.snapshot_file_id || source.snapshot_deleted_at !== null) {
      throw new ImportSnapshotDeletedError();
    }

    const { contents } = await files.readContents(source.snapshot_file_id);
    const copy = await files.upload({
      kind: 'PRODUCT_IMPORT',
      contents,
      originalName: `restore-of-${sourceJobId}.csv`,
      uploadedBy: actorId,
    });

    return this.start({
      fileId: copy.id,
      fileSha256: createHash('sha256').update(contents).digest('hex'),
      contents: stripBom(contents.toString('utf8')),
      actorId,
      // §10: a snapshot is this system's own file, so the caps written for arbitrary user input
      // do not apply. The schema check still does; the origin check does not.
      isRestore: true,
      restoredFromJobId: sourceJobId,
    });
  }

  /** The snapshot's bytes, for an IM who wants to read it rather than apply it. */
  async readSnapshot(
    jobId: string,
    files: ImportFileStore,
  ): Promise<{ contents: Buffer; fileName: string }> {
    const row = await this.repo.findById(jobId);
    if (!row) throw new NotFoundError('Import');
    if (!row.snapshot_file_id || row.snapshot_deleted_at !== null) {
      throw new ImportSnapshotDeletedError();
    }

    const { contents } = await files.readContents(row.snapshot_file_id);
    const stamp = row.created_at.toISOString().slice(0, 10);
    return { contents, fileName: `ims-snapshot-${stamp}.csv` };
  }

  /**
   * Delete a backup to reclaim the bytes (§10).
   *
   * **A hard delete of the file, a soft one of the fact.** The point of deleting a backup is the
   * disk space, so the file and its `stored_files` row go; but the job keeps its diff, its
   * history and a `snapshot_deleted_at` stamp, because "this import happened and its backup was
   * deliberately removed" is exactly what somebody will want to know later. Trying to restore it
   * afterwards gets `IMPORT_SNAPSHOT_DELETED` rather than a confusing empty file.
   */
  async deleteSnapshot(
    jobId: string,
    files: ImportSnapshotStore,
    auditContext: AuditContext,
  ): Promise<ImportJob> {
    const row = await this.repo.findById(jobId);
    if (!row) throw new NotFoundError('Import');
    if (!row.snapshot_file_id || row.snapshot_deleted_at !== null) {
      throw new ImportSnapshotDeletedError();
    }

    /*
     * The pointer is cleared before the file goes. `snapshot_file_id` is ON DELETE SET NULL, so
     * the order is not strictly required — but doing it this way means a failure halfway leaves a
     * job with no snapshot rather than a job pointing at a file that is gone.
     */
    await this.repo.update(jobId, { snapshotFileId: null, snapshotDeletedAt: new Date() });
    await files.remove(row.snapshot_file_id);

    await this.audit.record(
      {
        action: 'import.snapshot_delete',
        entityType: 'import_job',
        entityId: jobId,
        summary: `Deleted the backup taken before import ${jobId}`,
        metadata: { jobId, snapshotFileId: row.snapshot_file_id },
      },
      auditContext,
    );

    return this.require(jobId);
  }

  /**
   * Free a stuck import by hand (§8).
   *
   * Unlike `cancel`, this is for a job that is *applying* — one whose task has died without
   * taking the process with it, leaving everybody locked out. It does not undo anything: the
   * apply transaction either committed or rolled back on its own, and this only clears the
   * state that is still claiming otherwise.
   *
   * **The unlock itself is `ImportLockService.release`, not a second copy of it here.** Two
   * implementations of "clear the lockout" is how the two stores drift apart, which is the
   * failure §8.1 is written about.
   */
  async abandon(id: string, lock: ImportLockRelease): Promise<ImportJob> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError('Import');

    if (!LIVE_IMPORT_STATUSES.includes(row.status)) {
      throw new ConflictError(
        `This import is already ${row.status.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }

    await lock.release(id, ImportJobStatus.FAILED);
    return this.require(id);
  }

  /**
   * Expiry, checked on read rather than on a timer.
   *
   * §3.6 rules out a job framework, and §8.2 already chose lazy staleness checking for the
   * heartbeat, so a cron here would contradict both and add a moving part that can itself die.
   * There is no `expires_at` column and none is needed: `created_at` is stored and the window is
   * config, so "has this expired" is arithmetic on a row somebody is already reading.
   *
   * Nothing is lost by the check being late. The only thing expiry protects is the one-live
   * slot, and the slot only matters at the moment somebody wants it — which is a read.
   */
  private async expireStaleJob(): Promise<void> {
    const live = await this.repo.findLive();
    if (!live) return;

    /*
     * A job left `APPLYING` by a process that died, reclaimed here (C41).
     *
     * `ImportLockService.releaseIfDead` was written for exactly this and says so, but its only
     * caller is `ImportLockGuard`, which returns early on `!isLocked()`. After a crash the
     * restarted process holds no in-memory lock, so `isLocked()` is false, so the check never
     * ran — and because `import_jobs_one_live` covers `APPLYING`, **every future import was
     * refused 409 for ever.** Verified against the demo stack: the API was killed four seconds
     * into a 3,657-shelf apply, and imports were still refused 135 seconds later, well past the
     * 60-second heartbeat.
     *
     * Here rather than in the guard because this is the moment it matters — somebody is trying
     * to start an import — and because `start` and `get` both already call this. It is still the
     * same single unlock: `releaseIfDead` refuses to touch a job whose heartbeat is recent, so a
     * long but healthy apply is never mistaken for a dead one.
     */
    if (live.status === ImportJobStatus.APPLYING) {
      await this.lock.releaseIfDead();
      return;
    }

    if (live.status !== ImportJobStatus.AWAITING_CONFIRMATION) return;
    if (!isExpired(live, this.config)) return;

    await this.repo.update(live.id, {
      status: ImportJobStatus.CANCELLED,
      finishedAt: new Date(),
    });
  }

  private async require(id: string): Promise<ImportJob> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError('Import');
    return toContract(row, this.config);
  }
}

function isExpired(row: ImportJobRow, config: AppConfig): boolean {
  const deadline = row.created_at.getTime() + config.imports.confirmationTtlMinutes * 60 * 1000;
  return Date.now() > deadline;
}

export function toContract(row: ImportJobRow, config: AppConfig): ImportJob {
  const report = row.report ?? { errors: [], warnings: [], diff: null };

  return {
    id: row.id,
    status: row.status,
    fileName: row.file_name,
    totalRows: row.total_rows,
    processedRows: row.processed_rows,
    percent: percentOf(row),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    estimatedFinishAt: row.estimated_finish_at?.toISOString() ?? null,
    errors: report.errors,
    diff: report.diff,
    /*
     * A backup exists and has not been reclaimed. Part F fills `snapshot_file_id`; until then
     * this is honestly false on every job rather than optimistically true, because a restore
     * button that finds nothing to restore is worse than no button.
     */
    canRestore: row.snapshot_file_id !== null && row.snapshot_deleted_at === null,
    restoredFromJobId: row.restored_from_job_id,
    createdById: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    // Not stored: derived from `created_at` and config, so the window can be changed without a
    // migration and without rewriting rows that were created under the old one.
    expiresAt: expiryOf(row, config),
  };
}

function expiryOf(row: ImportJobRow, config: AppConfig): string | null {
  if (row.status !== ImportJobStatus.AWAITING_CONFIRMATION) return null;
  return new Date(
    row.created_at.getTime() + config.imports.confirmationTtlMinutes * 60 * 1000,
  ).toISOString();
}

function percentOf(row: ImportJobRow): number | null {
  if (row.total_rows === null || row.total_rows === 0) return null;
  return Math.min(100, Math.round((row.processed_rows / row.total_rows) * 100));
}
