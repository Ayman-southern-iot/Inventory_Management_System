import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { ErrorCode, ImportJobStatus, Role } from '@ims/shared';
import { createTestApp, httpClient, type TestApp } from './app';
import { createUserAndLogin, resetData } from './factories';
import { createProduct, createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';
import { ImportJobsService } from '../src/modules/imports/import-jobs.service';
import { ProductExportService } from '../src/modules/imports/product-export.service';
import { stripBom } from '../src/modules/imports/import-format';

/**
 * The state machine between a file arriving and a human approving it
 * (`importing_data.md` §5.1–5.4, part E).
 *
 * It stops at `AWAITING_CONFIRMATION` on purpose — the transition out of it is apply, which is
 * part G. What is testable today is everything that holds the decision in between: the job
 * survives, the diff is attached and served, a second run is refused rather than racing, and an
 * abandoned job releases the slot instead of blocking imports for ever.
 */
describe('import jobs', () => {
  let ctx: TestApp;
  let fixture: StockFixture;
  let actorId: string;
  let jobs: ImportJobsService;
  let exporter: ProductExportService;

  /** A stored file for a job to point at. The upload path itself is a separate STOP. */
  async function storedFile(): Promise<{ fileId: string; sha256: string }> {
    const row = await ctx.db
      .insertInto('stored_files')
      .values({
        kind: 'PRODUCT_IMPORT',
        relative_path: `product_import/${randomUUID()}.csv`,
        original_name: 'products.csv',
        mime_type: 'text/csv',
        size_bytes: 1024,
        uploaded_by: actorId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { fileId: row.id, sha256: randomUUID().replace(/-/g, '').repeat(2) };
  }

  const exported = () => exporter.toCsv();

  async function start(contents?: string) {
    const file = await storedFile();
    return jobs.start({
      fileId: file.fileId,
      fileSha256: file.sha256,
      contents: contents ?? (await exported()),
      actorId,
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    jobs = ctx.app.get(ImportJobsService);
    exporter = ctx.app.get(ProductExportService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    fixture = await createStockFixture(ctx.db);
    const session = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.INVENTORY_MANAGER],
    });
    actorId = session.user.id;
    await ctx.app
      .get(StockService)
      .receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        { performedBy: actorId, note: 'jobs fixture' },
      );
  });

  describe('starting one', () => {
    it('parks a clean file for a human, with its diff attached', async () => {
      const job = await start();

      expect(job.status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);
      expect(job.errors).toEqual([]);
      expect(job.diff).not.toBeNull();
      expect(job.finishedAt).toBeNull();
      expect(job.createdById).toBe(actorId);
      expect(job.totalRows).toBeGreaterThan(0);
    });

    it('fails a file that cannot be imported, and says why', async () => {
      const job = await start('not a fingerprint\r\nnot,headers\r\n1,2\r\n');

      expect(job.status).toBe(ImportJobStatus.FAILED);
      expect(job.diff).toBeNull();
      expect(job.errors.length).toBeGreaterThan(0);
      expect(job.finishedAt).not.toBeNull();
    });

    /** The job outlives the request, which is what makes closing the browser survivable (C33). */
    it('can be read back after the request that made it', async () => {
      const started = await start();
      const fetched = await jobs.get(started.id);

      expect(fetched.id).toBe(started.id);
      expect(fetched.status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);
      expect(fetched.diff).toEqual(started.diff);
    });

    it('serves the warnings alongside the diff', async () => {
      // Filtered by id, not by name. Products are never deleted between specs — every foreign
      // key to them is RESTRICT, so `resetData` cannot — and another file's leftover
      // "Doomed ..." was being caught by a name substring and retired along with this one.
      const doomed = await createProduct(ctx.db, {
        categoryId: fixture.categoryId,
        name: `Doomed ${randomUUID().slice(0, 8)}`,
      });
      const withoutIt = stripBom(await exported())
        .split('\r\n')
        .filter((line, index) => index < 2 || !line.includes(doomed));

      const job = await start(`${withoutIt.join('\r\n')}\r\n`);
      expect(job.diff!.warnings.length).toBeGreaterThan(0);
      expect(job.diff!.productsDeactivated).toBe(1);
    });
  });

  describe('one at a time', () => {
    /**
     * C32. The partial unique index is the guard — a check-then-insert would let two admins
     * uploading in the same second both pass the check. What the second one sees has to be a
     * readable conflict, though, not a constraint name.
     */
    it('refuses a second import while one waits for confirmation', async () => {
      const first = await start();
      expect(first.status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);

      await expect(start()).rejects.toMatchObject({
        response: { code: ErrorCode.IMPORT_ALREADY_RUNNING },
      });
    });

    it('allows another once the first has failed', async () => {
      const failed = await start('not a fingerprint\r\n');
      expect(failed.status).toBe(ImportJobStatus.FAILED);

      const second = await start();
      expect(second.status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);
    });

    it('allows another once the first is cancelled', async () => {
      const first = await start();
      await jobs.cancel(first.id);

      const second = await start();
      expect(second.status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);
    });
  });

  describe('giving up the slot', () => {
    it('cancels a job that is waiting', async () => {
      const job = await start();
      const cancelled = await jobs.cancel(job.id);

      expect(cancelled.status).toBe(ImportJobStatus.CANCELLED);
      expect(cancelled.finishedAt).not.toBeNull();
      expect(cancelled.expiresAt).toBeNull();
    });

    it('refuses to cancel one that is already finished', async () => {
      const job = await start();
      await jobs.cancel(job.id);

      await expect(jobs.cancel(job.id)).rejects.toThrow(/only one waiting for confirmation/);
    });

    /**
     * Expiry is arithmetic on `created_at`, evaluated by whatever request next looks — §3.6
     * rules out a job framework, and a timer would be a moving part that can itself die. Here
     * the row is aged by hand rather than by waiting an hour.
     */
    it('releases the slot when nobody ever confirmed', async () => {
      const abandoned = await start();
      expect(abandoned.expiresAt).not.toBeNull();

      // Raw, because `created_at` is deliberately not updatable through the query builder —
      // it is a CreatedAt column and nothing in the application should be able to move it.
      await sql`update import_jobs set created_at = now() - interval '48 hours' where id = ${abandoned.id}::uuid`.execute(
        ctx.db,
      );

      // The next read is what notices. Nothing ran in between.
      const second = await start();
      expect(second.status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);

      const expired = await jobs.get(abandoned.id);
      expect(expired.status).toBe(ImportJobStatus.CANCELLED);
    });

    it('does not expire one that is still inside its window', async () => {
      const job = await start();
      const again = await jobs.get(job.id);
      expect(again.status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);
    });
  });

  describe('the history', () => {
    it('lists finished runs newest first', async () => {
      const first = await start('not a fingerprint\r\n');
      const second = await start();

      const listed = await jobs.listRecent();
      expect(listed.map((job) => job.id)).toEqual([second.id, first.id]);
      expect(listed[0]!.createdByName).toMatch(/^Test /);
    });

    /** Part F fills the snapshot; until it does, a restore button would find nothing. */
    it('says no job can be restored yet', async () => {
      await start();
      const listed = await jobs.listRecent();
      expect(listed.every((job) => job.canRestore === false)).toBe(true);
    });
  });
});
