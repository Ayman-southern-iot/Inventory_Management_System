import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ImportJobStatus, Role } from '@ims/shared';
import { createTestApp, httpClient, type TestApp } from './app';
import { createUser, resetData } from './factories';

/**
 * Migration 0038 — the `import_jobs` table.
 *
 * Part A of the CSV import ships the vocabulary, not the pipeline, so what is worth testing is
 * the set of promises the *database* makes. Each of these is a guarantee the rest of the feature
 * leans on, and each would be a silent bug if the migration were subtly wrong:
 *
 *  - only one live job at a time, so two admins racing is refused rather than interleaved;
 *  - progress can never exceed the total, so a percentage cannot read 140%;
 *  - a deleted snapshot cannot still claim to have a file, so the history screen cannot offer a
 *    restore for bytes that are gone.
 *
 * The service layer will check all three too. These assert that the check is not the *only*
 * thing standing between a bug and the data.
 */
describe('import_jobs (migration 0038)', () => {
  let ctx: TestApp;
  let actorId: string;
  let fileId: string;

  /** A stored file to hang jobs off — `file_id` is NOT NULL and references it. */
  async function createStoredFile(): Promise<string> {
    const row = await ctx.db
      .insertInto('stored_files')
      .values({
        kind: 'PRODUCT_IMPORT',
        relative_path: `imports/${randomUUID()}.csv`,
        original_name: 'products.csv',
        mime_type: 'text/csv',
        size_bytes: 1024,
        uploaded_by: actorId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function insertJob(overrides: Record<string, unknown> = {}) {
    return ctx.db
      .insertInto('import_jobs')
      .values({
        kind: 'products',
        status: ImportJobStatus.VALIDATING,
        file_id: fileId,
        file_sha256: 'a'.repeat(64),
        created_by: actorId,
        ...overrides,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    const admin = await createUser(ctx.db, { roles: [Role.ADMIN] });
    actorId = admin.id;
    fileId = await createStoredFile();
  });

  it('accepts a job in each of the six states', async () => {
    for (const status of Object.values(ImportJobStatus)) {
      // One live slot, so finish each before starting the next.
      const job = await insertJob({ status });
      await ctx.db.deleteFrom('import_jobs').where('id', '=', job.id).execute();
    }
    expect.assertions(0);
  });

  describe('one live job at a time', () => {
    /** The partial index is what makes "two admins race" not a code path at all. */
    it.each([
      ImportJobStatus.VALIDATING,
      ImportJobStatus.AWAITING_CONFIRMATION,
      ImportJobStatus.APPLYING,
    ])('refuses a second job while one is %s', async (status) => {
      await insertJob({ status });
      await expect(insertJob()).rejects.toThrow(/import_jobs_one_live/);
    });

    it.each([ImportJobStatus.COMPLETED, ImportJobStatus.FAILED, ImportJobStatus.CANCELLED])(
      'allows a new job once the previous one is %s',
      async (status) => {
        await insertJob({ status });
        await expect(insertJob()).resolves.toBeDefined();
      },
    );

    /** Finished jobs are history; there will be thousands and they must not block each other. */
    it('allows many finished jobs to coexist', async () => {
      await insertJob({ status: ImportJobStatus.COMPLETED });
      await insertJob({ status: ImportJobStatus.COMPLETED });
      await insertJob({ status: ImportJobStatus.FAILED });

      const count = await ctx.db
        .selectFrom('import_jobs')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .executeTakeFirstOrThrow();
      expect(Number(count.c)).toBe(3);
    });
  });

  describe('progress can never lie', () => {
    it('refuses processed rows above the total', async () => {
      await expect(insertJob({ total_rows: 10, processed_rows: 11 })).rejects.toThrow(
        /import_jobs_processed_within_total/,
      );
    });

    it('refuses negative progress', async () => {
      await expect(insertJob({ processed_rows: -1 })).rejects.toThrow(
        /import_jobs_processed_within_total/,
      );
    });

    it('allows progress before the total is known', async () => {
      await expect(insertJob({ total_rows: null, processed_rows: 40 })).resolves.toBeDefined();
    });

    it('allows progress equal to the total', async () => {
      await expect(insertJob({ total_rows: 10, processed_rows: 10 })).resolves.toBeDefined();
    });
  });

  describe('a deleted snapshot keeps no file', () => {
    /** Otherwise the history screen offers a restore for bytes that are no longer on disk. */
    it('refuses a row claiming both a snapshot and its deletion', async () => {
      const snapshot = await createStoredFile();
      await expect(
        insertJob({
          status: ImportJobStatus.COMPLETED,
          snapshot_file_id: snapshot,
          snapshot_deleted_at: new Date(),
        }),
      ).rejects.toThrow(/import_jobs_snapshot_deletion_consistent/);
    });

    it('allows a snapshot that is still present', async () => {
      const snapshot = await createStoredFile();
      await expect(
        insertJob({ status: ImportJobStatus.COMPLETED, snapshot_file_id: snapshot }),
      ).resolves.toBeDefined();
    });

    it('allows a deletion that cleared the file', async () => {
      await expect(
        insertJob({
          status: ImportJobStatus.COMPLETED,
          snapshot_file_id: null,
          snapshot_deleted_at: new Date(),
        }),
      ).resolves.toBeDefined();
    });
  });

  it('points a restore at the job it came from', async () => {
    const original = await insertJob({ status: ImportJobStatus.COMPLETED });
    const restore = await insertJob({
      status: ImportJobStatus.COMPLETED,
      restored_from_job_id: original.id,
    });

    const row = await ctx.db
      .selectFrom('import_jobs')
      .select('restored_from_job_id')
      .where('id', '=', restore.id)
      .executeTakeFirstOrThrow();
    expect(row.restored_from_job_id).toBe(original.id);
  });

  /** The uploaded file is evidence; it must not vanish from under a job that references it. */
  it('refuses to delete a stored file a job still points at', async () => {
    await insertJob();
    await expect(
      ctx.db.deleteFrom('stored_files').where('id', '=', fileId).execute(),
    ).rejects.toThrow();
  });

  /**
   * Part E gave these rows a route. What this asserted in part A — that no route existed — is
   * no longer true, and the reason it existed still is: a route must not appear without its
   * guards. So it now asserts the guard rather than the absence, and `import-upload.int-spec`
   * covers the roles behind it.
   */
  it('is reachable over HTTP only with a session', async () => {
    const response = await httpClient(ctx.app).get('/inventory/imports');
    expect(response.status).toBe(401);
  });
});
