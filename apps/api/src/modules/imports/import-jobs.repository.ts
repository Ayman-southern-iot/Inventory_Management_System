import { Inject, Injectable } from '@nestjs/common';
import type { ImportDiff, ImportIssue, ImportJobStatus } from '@ims/shared';
import { LIVE_IMPORT_STATUSES } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

/**
 * Rows in `import_jobs` (migration 0038).
 *
 * The one rule this table enforces on its own is `import_jobs_one_live`: a partial unique index
 * over `VALIDATING`, `AWAITING_CONFIRMATION` and `APPLYING`, which makes "two admins import at
 * once" (C32) not a code path at all. Nothing here checks for a live job before inserting —
 * a check would be a race, the index is not.
 */

/** Everything a run produced, kept in one jsonb column rather than five. */
export interface ImportJobReport {
  errors: ImportIssue[];
  warnings: ImportIssue[];
  diff: ImportDiff | null;
}

export interface ImportJobRow {
  id: string;
  kind: string;
  status: ImportJobStatus;
  file_id: string | null;
  file_name: string;
  file_sha256: string;
  snapshot_file_id: string | null;
  snapshot_deleted_at: Date | null;
  restored_from_job_id: string | null;
  total_rows: number | null;
  processed_rows: number;
  started_at: Date | null;
  heartbeat_at: Date | null;
  finished_at: Date | null;
  estimated_finish_at: Date | null;
  report: ImportJobReport | null;
  created_by: string;
  created_by_name: string;
  created_at: Date;
}

@Injectable()
export class ImportJobsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private baseSelect() {
    return (
      this.db
        .selectFrom('import_jobs')
        .innerJoin('users', 'users.id', 'import_jobs.created_by')
        // LEFT: a job survives its file being swept, and the history screen still has to show it.
        .leftJoin('stored_files', 'stored_files.id', 'import_jobs.file_id')
        .select([
          'import_jobs.id',
          'import_jobs.kind',
          'import_jobs.status',
          'import_jobs.file_id',
          'import_jobs.file_sha256',
          'import_jobs.snapshot_file_id',
          'import_jobs.snapshot_deleted_at',
          'import_jobs.restored_from_job_id',
          'import_jobs.total_rows',
          'import_jobs.processed_rows',
          'import_jobs.started_at',
          'import_jobs.heartbeat_at',
          'import_jobs.finished_at',
          'import_jobs.estimated_finish_at',
          'import_jobs.report',
          'import_jobs.created_by',
          'import_jobs.created_at',
          'users.full_name as created_by_name',
          'stored_files.original_name as file_name',
        ])
    );
  }

  async insert(values: {
    kind: string;
    status: ImportJobStatus;
    fileId: string;
    fileSha256: string;
    createdBy: string;
    /** Set when this run is a rollback of an earlier one (§10). */
    restoredFromJobId?: string | null;
  }): Promise<string> {
    const row = await this.db
      .insertInto('import_jobs')
      .values({
        kind: values.kind,
        status: values.status,
        file_id: values.fileId,
        file_sha256: values.fileSha256,
        created_by: values.createdBy,
        restored_from_job_id: values.restoredFromJobId ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async findById(id: string): Promise<ImportJobRow | undefined> {
    const row = await this.baseSelect().where('import_jobs.id', '=', id).executeTakeFirst();
    return row ? toRow(row) : undefined;
  }

  /** The job holding the one-live slot, if any. At most one by construction. */
  async findLive(): Promise<ImportJobRow | undefined> {
    const row = await this.baseSelect()
      .where('import_jobs.status', 'in', [...LIVE_IMPORT_STATUSES])
      .executeTakeFirst();
    return row ? toRow(row) : undefined;
  }

  async listRecent(limit: number): Promise<ImportJobRow[]> {
    const rows = await this.baseSelect()
      .orderBy('import_jobs.created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toRow);
  }

  async update(
    id: string,
    patch: {
      status?: ImportJobStatus;
      totalRows?: number | null;
      processedRows?: number;
      report?: ImportJobReport;
      startedAt?: Date | null;
      heartbeatAt?: Date | null;
      finishedAt?: Date | null;
      snapshotFileId?: string | null;
      snapshotDeletedAt?: Date | null;
    },
  ): Promise<void> {
    const values = {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.totalRows === undefined ? {} : { total_rows: patch.totalRows }),
      ...(patch.processedRows === undefined ? {} : { processed_rows: patch.processedRows }),
      ...(patch.startedAt === undefined ? {} : { started_at: patch.startedAt }),
      ...(patch.heartbeatAt === undefined ? {} : { heartbeat_at: patch.heartbeatAt }),
      ...(patch.snapshotFileId === undefined ? {} : { snapshot_file_id: patch.snapshotFileId }),
      ...(patch.snapshotDeletedAt === undefined
        ? {}
        : { snapshot_deleted_at: patch.snapshotDeletedAt }),
      ...(patch.report === undefined ? {} : { report: JSON.stringify(patch.report) }),
      ...(patch.finishedAt === undefined ? {} : { finished_at: patch.finishedAt }),
    };
    if (Object.keys(values).length === 0) return;

    await this.db.updateTable('import_jobs').set(values).where('id', '=', id).execute();
  }
}

function toRow(row: Record<string, unknown>): ImportJobRow {
  return {
    ...(row as unknown as ImportJobRow),
    // A file swept out from under a finished job leaves the name null; the row still has to
    // render, and "(file removed)" is the honest thing to show for it.
    file_name: (row.file_name as string | null) ?? '(file removed)',
  };
}
