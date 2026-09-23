import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import request from 'supertest';
import { ErrorCode, ImportJobStatus, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUserAndLogin, resetData } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';
import { ImportLockService } from '../src/modules/imports/import-lock.service';

/**
 * The system-wide lockout (`importing_data.md` §8, part I).
 *
 * §8.1 calls the crash guard "the most important paragraph in this document", and the reason is
 * asymmetric risk: getting the lockout *on* is easy, getting it reliably *off* is what stands
 * between one dead import and the company being locked out until somebody restarts a container.
 * So most of this file is about release, not about refusal.
 */
describe('the import lockout', () => {
  let ctx: TestApp;
  let fixture: StockFixture;
  let lock: ImportLockService;
  let im: HttpClient;
  let general: HttpClient;
  let actorId: string;

  /** Puts the system in the state a live apply leaves it in, without running one. */
  async function lockedJob(): Promise<string> {
    const stored = await ctx.db
      .insertInto('stored_files')
      .values({
        kind: 'PRODUCT_IMPORT',
        relative_path: `product_import/${randomUUID()}.csv`,
        original_name: 'products.csv',
        mime_type: 'text/csv',
        size_bytes: 10,
        uploaded_by: actorId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const job = await ctx.db
      .insertInto('import_jobs')
      .values({
        kind: 'products',
        status: ImportJobStatus.APPLYING,
        file_id: stored.id,
        file_sha256: 'a'.repeat(64),
        created_by: actorId,
        started_at: new Date(),
        heartbeat_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    lock.engage(job.id, new Date(Date.now() + 10 * 60 * 1000));
    return job.id;
  }

  /** Ages the heartbeat past the timeout, as a task that died without crashing would. */
  async function stopTheHeart(jobId: string): Promise<void> {
    await sql`
      update import_jobs
      set heartbeat_at = now() - interval '1 hour', started_at = now() - interval '1 hour'
      where id = ${jobId}::uuid
    `.execute(ctx.db);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    lock = ctx.app.get(ImportLockService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    fixture = await createStockFixture(ctx.db);
    const manager = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.INVENTORY_MANAGER],
    });
    im = manager.client;
    actorId = manager.user.id;
    general = (await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.GENERAL] }))
      .client;
    await ctx.app
      .get(StockService)
      .receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
        { performedBy: actorId, note: 'lockout fixture' },
      );
  });

  afterEach(async () => {
    // The boolean is process state, not database state, so `resetData` cannot clear it. A test
    // that left it engaged would lock out every spec that ran after it in the same process.
    const held = lock.heldJobId();
    if (held) await lock.release(held, null);
    await sql`update import_jobs set status = 'CANCELLED' where status = 'APPLYING'`.execute(
      ctx.db,
    );
  });

  describe('while an import is applying', () => {
    it('refuses an ordinary request with 503 and says when it should end', async () => {
      await lockedJob();

      const response = await im.get('/products');
      expect(response.status).toBe(503);
      expect(response.body.code).toBe(ErrorCode.SYSTEM_IMPORT_IN_PROGRESS);
      expect(response.body.details.estimatedFinishAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('refuses the importing manager their own other screens', async () => {
      await lockedJob();
      expect((await im.get('/locations')).status).toBe(503);
    });

    it('lets everything through again once the lock is released', async () => {
      const jobId = await lockedJob();
      expect((await im.get('/products')).status).toBe(503);

      await lock.release(jobId, ImportJobStatus.COMPLETED);

      expect((await im.get('/products')).status).toBe(200);
    });
  });

  /**
   * Requirement: assert the *ordering*, not only the outcome on the allow-listed routes.
   *
   * `@Roles` attaches `RolesGuard` with `UseGuards`, which makes it route-level, and Nest runs
   * every global guard before any route-level one. So the lockout guard is provably ahead of the
   * role check — and the way to see that is a request that would fail *both*: a general user on
   * an IM-only route. 503 means the lockout ran first; 403 would mean it did not.
   */
  describe('where the guard sits in the chain', () => {
    it('refuses with 503, not 403, when the caller also lacks the role', async () => {
      // Without the lock this is a plain 403, which is what makes the comparison meaningful.
      expect((await general.get('/inventory/export')).status).toBe(403);

      await lockedJob();

      const response = await general.get('/inventory/export');
      expect(response.status).toBe(503);
      expect(response.body.code).toBe(ErrorCode.SYSTEM_IMPORT_IN_PROGRESS);
    });

    /**
     * The other global guard. Order between two global guards is registration order, which is
     * not something to assume — so it is pinned here: an unauthenticated caller during a lockout
     * gets 503, meaning the lockout guard is ahead of `JwtAuthGuard`.
     *
     * Either order is defensible; what is not defensible is nobody knowing which one it is.
     */
    it('pins its order against the authentication guard', async () => {
      await lockedJob();
      expect((await httpClient(ctx.app).get('/products')).status).toBe(503);
    });
  });

  describe('the four routes that must survive it', () => {
    it('lets the progress read through, or nobody can see when it ends', async () => {
      const jobId = await lockedJob();
      const response = await im.get(`/inventory/imports/${jobId}`);
      expect(response.status).toBe(200);
      expect(response.body.status).toBe(ImportJobStatus.APPLYING);
    });

    it('lets the health check through, or Docker restarts the API mid-import', async () => {
      await lockedJob();
      // Hit without the global prefix: `setGlobalPrefix` excludes 'health' so the container's
      // check does not have to know the API version, which is also why the usual client cannot
      // reach it.
      const response = await request(ctx.app.getHttpServer()).get('/health');
      expect(response.status).toBe(200);
    });

    it('lets a token refresh through, or the watching admin is logged out mid-run', async () => {
      const session = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
        roles: [Role.INVENTORY_MANAGER],
      });
      await lockedJob();

      const response = await httpClient(ctx.app)
        .post('/auth/refresh')
        .send({ refreshToken: session.session.refreshToken });
      expect(response.status).not.toBe(503);
    });

    it('lets abandon through, or the only way out is a container restart', async () => {
      const jobId = await lockedJob();
      const response = await im.post(`/inventory/imports/${jobId}/abandon`);
      expect(response.status).toBe(200);
    });
  });

  /**
   * §8.1's crash guard, and the specific gap the review flagged: a test that only checks the
   * job row would pass even if the in-memory boolean were never cleared, which is exactly the
   * bug. So every assertion here is "a request that was being refused now succeeds".
   */
  describe('when the import dies without taking the process with it', () => {
    it('lifts the 503 on the next request, not just the row', async () => {
      const jobId = await lockedJob();
      expect((await im.get('/products')).status).toBe(503);

      await stopTheHeart(jobId);

      // The request that notices is the one that was about to be refused. It is let through
      // rather than made to retry.
      expect((await im.get('/products')).status).toBe(200);
      // And again, now that nothing holds the lock at all.
      expect((await im.get('/products')).status).toBe(200);
    });

    it('marks the dead job failed as well, so the one-live slot is free', async () => {
      const jobId = await lockedJob();
      await stopTheHeart(jobId);

      await im.get('/products');

      const row = await ctx.db
        .selectFrom('import_jobs')
        .select(['status', 'finished_at'])
        .where('id', '=', jobId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe(ImportJobStatus.FAILED);
      expect(row.finished_at).not.toBeNull();
    });

    it('keeps refusing while the heartbeat is still fresh', async () => {
      await lockedJob();
      expect((await im.get('/products')).status).toBe(503);
      expect((await im.get('/products')).status).toBe(503);
    });

    /**
     * The other half of §8.1: the process restarted, so the boolean is already false, but the
     * row still says `APPLYING` and the partial unique index is still blocking the next import.
     */
    it('clears a row left applying by a process that is no longer here', async () => {
      const jobId = await lockedJob();
      await stopTheHeart(jobId);
      await lock.release(jobId, null); // what a restart does: boolean only

      expect((await im.get('/products')).status).toBe(200);
      expect(await lock.releaseIfDead()).toBe(true);

      const row = await ctx.db
        .selectFrom('import_jobs')
        .select('status')
        .where('id', '=', jobId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe(ImportJobStatus.FAILED);
    });
  });

  describe('abandon', () => {
    /** Requirement: abandon and the heartbeat path must not be two ways of clearing the lock. */
    it('frees both stores, so the next request succeeds and the row is finished', async () => {
      const jobId = await lockedJob();
      expect((await im.get('/products')).status).toBe(503);

      await im.post(`/inventory/imports/${jobId}/abandon`);

      expect(lock.isLocked()).toBe(false);
      expect((await im.get('/products')).status).toBe(200);
      const row = await ctx.db
        .selectFrom('import_jobs')
        .select('status')
        .where('id', '=', jobId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe(ImportJobStatus.FAILED);
    });

    it('refuses to abandon an import that is already finished', async () => {
      const jobId = await lockedJob();
      await im.post(`/inventory/imports/${jobId}/abandon`);

      const second = await im.post(`/inventory/imports/${jobId}/abandon`);
      expect(second.status).toBe(409);
    });
  });
});
