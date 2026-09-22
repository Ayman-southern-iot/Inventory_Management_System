import { sql, type Kysely } from 'kysely';

/**
 * CSV product import — the job row that tracks one run (`importing_data.md` §6).
 *
 * One row per import attempt, from the moment a file is uploaded to the moment it completes,
 * fails or is abandoned. It carries four jobs at once, and each is load-bearing:
 *
 *  - **State.** Where the run is: validating, waiting on a human, applying, done.
 *  - **Progress.** `processed_rows` against `total_rows`, written on a separate connection while
 *    the apply transaction is open (a row written *inside* it is invisible until commit, which
 *    is exactly when progress stops being useful).
 *  - **The crash guard.** `heartbeat_at` is what lets a dead import release the system-wide
 *    lockout. Without it one hung task locks every user out permanently — see plan §8.1.
 *  - **The backup.** `snapshot_file_id` points at the round-trip export taken immediately before
 *    the run overwrote anything, which is what makes a one-click restore possible.
 *
 * Deliberately **not** append-only, unlike `stock_ledger` or `audit_log`. This row *is* the
 * progress; it has to be mutable. The permanent record of what an import did lives in the
 * `import.apply` audit row and in the ledger entries it wrote, both of which are append-only.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Two new kinds: the uploaded file, and the pre-image snapshot taken before it is applied.
  // Metadata-only, and Postgres allows the ADD VALUE in the same transaction as the table that
  // follows because nothing here *uses* the new values — same reasoning as migration 0023.
  await sql`ALTER TYPE stored_file_kind ADD VALUE 'PRODUCT_IMPORT'`.execute(db);
  await sql`ALTER TYPE stored_file_kind ADD VALUE 'PRODUCT_SNAPSHOT'`.execute(db);

  await sql`
    CREATE TYPE import_job_status AS ENUM (
      'VALIDATING', 'AWAITING_CONFIRMATION', 'APPLYING', 'COMPLETED', 'FAILED', 'CANCELLED'
    )
  `.execute(db);

  await db.schema
    .createTable('import_jobs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // 'products' today. A column rather than a second table, because a future import of some
    // other thing wants this exact machinery and none of its own.
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('status', sql`import_job_status`, (col) => col.notNull())
    .addColumn('file_id', 'uuid', (col) =>
      col.notNull().references('stored_files.id').onDelete('restrict'),
    )
    /**
     * The confirm gate. Validation and apply are separate requests, and between them the upload
     * could be replaced; a job must never be confirmed against a file other than the one whose
     * diff the human approved.
     */
    .addColumn('file_sha256', 'text', (col) => col.notNull())
    /**
     * The pre-image, captured after the lockout engages and before the transaction opens.
     * Nullable: it does not exist until apply begins, and it is cleared when an admin deletes
     * the backup to reclaim the bytes.
     */
    .addColumn('snapshot_file_id', 'uuid', (col) =>
      col.references('stored_files.id').onDelete('set null'),
    )
    .addColumn('snapshot_deleted_at', 'timestamptz')
    /** Set when this job is itself a rollback, pointing at the job whose snapshot it restores. */
    .addColumn('restored_from_job_id', 'uuid', (col) =>
      col.references('import_jobs.id').onDelete('set null'),
    )
    .addColumn('total_rows', 'integer')
    .addColumn('processed_rows', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('started_at', 'timestamptz')
    .addColumn('heartbeat_at', 'timestamptz')
    .addColumn('finished_at', 'timestamptz')
    .addColumn('estimated_finish_at', 'timestamptz')
    /** Errors while validating, the diff while awaiting confirmation, the outcome once done. */
    .addColumn('report', 'jsonb')
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  /**
   * At most one live job per kind.
   *
   * Two admins uploading at once is then refused by the database rather than by a check somebody
   * has to remember to write, and the second one gets a conflict instead of a half-interleaved
   * import. A partial index because the finished rows are history and there will be thousands.
   */
  await sql`
    CREATE UNIQUE INDEX import_jobs_one_live ON import_jobs (kind)
    WHERE status IN ('VALIDATING', 'AWAITING_CONFIRMATION', 'APPLYING')
  `.execute(db);

  await sql`CREATE INDEX import_jobs_created_idx ON import_jobs (created_at DESC)`.execute(db);

  await sql`
    ALTER TABLE import_jobs
    ADD CONSTRAINT import_jobs_processed_within_total
    CHECK (processed_rows >= 0 AND (total_rows IS NULL OR processed_rows <= total_rows))
  `.execute(db);

  // A deleted snapshot has no file; a file that is still there has not been deleted. Keeping the
  // two in step by constraint means the history screen cannot show a restore button for bytes
  // that are gone.
  await sql`
    ALTER TABLE import_jobs
    ADD CONSTRAINT import_jobs_snapshot_deletion_consistent
    CHECK (snapshot_deleted_at IS NULL OR snapshot_file_id IS NULL)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('import_jobs').ifExists().execute();
  await sql`DROP TYPE IF EXISTS import_job_status`.execute(db);
  /*
   * `stored_file_kind` keeps 'PRODUCT_IMPORT' and 'PRODUCT_SNAPSHOT'. Postgres cannot drop an
   * enum value inside a transaction, and there is no table left referencing them — the same
   * trade-off migration 0023 made and documented. Cleanup is a housekeeping migration if it is
   * ever worth one.
   */
}
