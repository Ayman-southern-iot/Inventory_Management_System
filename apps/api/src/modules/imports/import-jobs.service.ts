import { Inject, Injectable } from '@nestjs/common';
import { ImportJobStatus, LIVE_IMPORT_STATUSES, type ImportJob } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { ConflictError, ImportAlreadyRunningError, NotFoundError } from '../../common/errors';
import { isUniqueViolation } from '../../common/pg-errors';
import { ImportValidationService } from './import-validation.service';
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
 * Just enough of `ImportLockService` for `abandon` to call the one unlock.
 *
 * Passed in rather than injected because the lock service depends on this module's repository
 * and injecting it here would close the circle. The narrow type is the point: this path may
 * release the lock and may do nothing else to it.
 */
export interface ImportLockRelease {
  release(jobId: string, status: ImportJobStatus | null): Promise<void>;
}

@Injectable()
export class ImportJobsService {
  constructor(
    private readonly repo: ImportJobsRepository,
    private readonly validation: ImportValidationService,
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
    if (!live || live.status !== ImportJobStatus.AWAITING_CONFIRMATION) return;
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
