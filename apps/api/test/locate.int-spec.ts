import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiKeyScope,
  ErrorCode,
  ImportJobStatus,
  LOCATE_MAX_PRODUCTS,
  LocateState,
  Role,
  type LocateEvent,
} from '@ims/shared';
import { ImportLockService } from '../src/modules/imports/import-lock.service';
import { LocateFeed } from '../src/modules/locate/locate-feed';
import { StockService } from '../src/modules/stock/stock.service';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createServiceAccount, issueBoundKey } from './api-key-factories';
import { createUserAndLogin, resetData, type CreatedUser } from './factories';
import { TEST_ENV } from './config/test-env';
import {
  createCompartment,
  createProduct,
  createRoom,
  createZone,
} from './stock-factories';

/**
 * Drawer lights (Phase 13): `POST /locate`, `GET /locate/next`, `GET /locate/latest`.
 *
 * The feed is process state — `resetData` cannot reach it — so no test here assumes it starts
 * empty. Each one reads the head first and asks only about what came after it.
 */
describe('drawer lights (locate)', () => {
  let ctx: TestApp;
  let feed: LocateFeed;
  let stock: StockService;
  let admin: HttpClient;
  let general: HttpClient;
  let generalUser: CreatedUser;
  let actorId: string;

  /** A cabinet of our own: unique room, drawer and cell names, so nothing from another spec matches. */
  let room: string;
  let zone: string;
  let cellA: { id: string; code: string };
  let cellB: { id: string; code: string };

  const head = (): number => feed.latest()?.seq ?? 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    feed = ctx.app.get(LocateFeed);
    stock = ctx.app.get(StockService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    const adminSession = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.ADMIN],
    });
    admin = adminSession.client;
    actorId = adminSession.user.id;
    const generalSession = await createUserAndLogin(ctx.db, httpClient(ctx.app));
    general = generalSession.client;
    generalUser = generalSession.user;

    const tag = randomUUID().slice(0, 8);
    room = `Cabinet ${tag}`;
    zone = `Z${tag}`;
    const zoneId = await createZone(ctx.db, zone, await createRoom(ctx.db, room));
    cellA = { id: await createCompartment(ctx.db, zoneId, '1A'), code: '1A' };
    cellB = { id: await createCompartment(ctx.db, zoneId, '2B-2C'), code: '2B-2C' };
  });

  async function stocked(compartmentId: string, quantity: number, name?: string): Promise<string> {
    const productId = await createProduct(ctx.db, name === undefined ? {} : { name });
    await stock.receive({ productId, compartmentId, quantity }, { performedBy: actorId });
    return productId;
  }

  async function readOnlyKey(scopes: ApiKeyScope[]): Promise<HttpClient> {
    const response = await admin
      .post('/admin/api-keys')
      .send({ name: `Light ${randomUUID().slice(0, 8)}`, scopes, expiresInDays: null });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return httpClient(ctx.app, { token: response.body.token as string });
  }

  /* -------------------------------------------------------------- resolving */

  describe('what a locate lights', () => {
    it('lights the drawer green where some are available, and says only drawers and cells (K2)', async () => {
      const name = `K2 probe ${randomUUID().slice(0, 8)}`;
      const productId = await stocked(cellA.id, 3, name);

      const response = await general.post('/locate').send({ productIds: [productId] });
      expect(response.status, JSON.stringify(response.body)).toBe(202);
      expect(response.body.seq).toBeGreaterThan(0);

      const event = feed.latest();
      expect(event?.seq).toBe(response.body.seq);
      expect(event?.drawers).toEqual([
        { zone, room, state: LocateState.GREEN, cells: [cellA.code] },
      ]);

      const latest = await general.get('/locate/latest');
      expect(latest.status).toBe(200);
      const body = JSON.stringify(latest.body);
      for (const secret of [productId, name, generalUser.id, generalUser.email, actorId]) {
        expect(body, `the event carries ${secret}`).not.toContain(secret);
      }
      expect(Object.keys(latest.body as LocateEvent).sort()).toEqual(['drawers', 'seq', 'ts', 'ttlMs']);
    });

    it('lights it red at the cell the stock last left, once the last unit has gone', async () => {
      const productId = await stocked(cellB.id, 2);
      await stock.adjust(
        { productId, compartmentId: cellB.id, delta: -2, reason: 'locate: ran out' },
        { performedBy: actorId },
      );
      // The placement is gone at zero (StockService), so only the ledger remembers the cell.
      const placements = await ctx.db
        .selectFrom('stock_placements')
        .select('id')
        .where('product_id', '=', productId)
        .execute();
      expect(placements).toEqual([]);

      const response = await general.post('/locate').send({ productIds: [productId] });
      expect(response.status).toBe(202);
      expect(feed.latest()?.drawers).toEqual([
        { zone, room, state: LocateState.RED, cells: [cellB.code] },
      ]);
    });

    it('follows the stock: after a full move and a run-out, red is where it last was', async () => {
      const productId = await stocked(cellA.id, 1);
      await stock.move(
        { productId, fromCompartmentId: cellA.id, toCompartmentId: cellB.id, quantity: 1 },
        { performedBy: actorId },
      );
      await stock.adjust(
        { productId, compartmentId: cellB.id, delta: -1, reason: 'locate: ran out after a move' },
        { performedBy: actorId },
      );

      await general.post('/locate').send({ productIds: [productId] });
      expect(feed.latest()?.drawers[0]?.cells).toEqual([cellB.code]);
    });

    it('rolls up to one light per drawer, green winning over red', async () => {
      const inStock = await stocked(cellA.id, 4);
      const runOut = await stocked(cellB.id, 1);
      await stock.adjust(
        { productId: runOut, compartmentId: cellB.id, delta: -1, reason: 'locate: ran out' },
        { performedBy: actorId },
      );

      await general.post('/locate').send({ productIds: [runOut, inStock] });
      expect(feed.latest()?.drawers).toEqual([
        { zone, room, state: LocateState.GREEN, cells: [cellA.code, cellB.code] },
      ]);
    });

    it('counts a product named twice once', async () => {
      const productId = await stocked(cellA.id, 1);
      const before = head();
      const response = await general.post('/locate').send({ productIds: [productId, productId] });
      expect(response.body.seq).toBeGreaterThan(before);
      expect(feed.latest()?.drawers).toEqual([
        { zone, room, state: LocateState.GREEN, cells: [cellA.code] },
      ]);
    });

    it('publishes nothing for a product that was never on a shelf, or one archived', async () => {
      const neverStocked = await createProduct(ctx.db);
      const archived = await stocked(cellA.id, 1);
      await ctx.db.updateTable('products').set({ is_active: false }).where('id', '=', archived).execute();
      const before = head();

      const response = await general
        .post('/locate')
        .send({ productIds: [neverStocked, archived, randomUUID()] });
      expect(response.status).toBe(202);
      expect(response.body).toEqual({ seq: null });
      expect(head()).toBe(before);
    });

    it(`refuses more than ${LOCATE_MAX_PRODUCTS} products, and an empty list`, async () => {
      const ids = Array.from({ length: LOCATE_MAX_PRODUCTS + 1 }, () => randomUUID());
      const tooMany = await general.post('/locate').send({ productIds: ids });
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.code).toBe(ErrorCode.VALIDATION_FAILED);
      const none = await general.post('/locate').send({ productIds: [] });
      expect(none.status).toBe(400);
    });
  });

  /* ------------------------------------------------------------- long-poll */

  describe('GET /locate/next', () => {
    it('wakes a waiting light within 200 ms of a locate', async () => {
      const light = await readOnlyKey([ApiKeyScope.LOCATE_READ]);
      const productId = await stocked(cellA.id, 1);
      let wokenAt = Number.POSITIVE_INFINITY;
      const waiting = light.get(`/locate/next?after=${head()}&wait=5`).then((response) => {
        wokenAt = performance.now();
        return response;
      });
      // Await the condition, not a sleep: the poll is parked in the feed.
      await vi.waitFor(() => expect(feed.waiting).toBe(1));

      const posted = await general.post('/locate').send({ productIds: [productId] });
      // Timed from the locate's own answer, not from sending it: the event is published before
      // the POST answers, so what is measured is the wake, not the POST's database work.
      const answeredAt = performance.now();
      const woken = await waiting;

      expect(woken.status).toBe(200);
      expect(woken.body.seq).toBe(posted.body.seq);
      expect(wokenAt - answeredAt).toBeLessThan(200);
    });

    it('frees the waiting slot when the light disconnects', async () => {
      const light = await readOnlyKey([ApiKeyScope.LOCATE_READ]);
      const request = light.get(`/locate/next?after=${head()}&wait=20`);
      // Started with a callback rather than awaited: an aborted request never settles a promise.
      request.end(() => undefined);
      await vi.waitFor(() => expect(feed.waiting).toBe(1));
      request.abort();
      await vi.waitFor(() => expect(feed.waiting).toBe(0));
    });

    it('answers 204 with no body when nothing happens in time', async () => {
      const light = await readOnlyKey([ApiKeyScope.LOCATE_READ]);
      const startedAt = performance.now();
      const response = await light.get(`/locate/next?after=${head()}&wait=1`);
      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(900);
      expect(feed.waiting).toBe(0);
    });

    it('hands a light that is behind the next event, and one that is current nothing', async () => {
      const light = await readOnlyKey([ApiKeyScope.LOCATE_READ]);
      const productId = await stocked(cellA.id, 1);
      const first = (await general.post('/locate').send({ productIds: [productId] })).body.seq as number;
      const second = (await general.post('/locate').send({ productIds: [productId] })).body.seq as number;

      expect((await light.get(`/locate/next?after=${first - 1}&wait=0`)).body.seq).toBe(first);
      expect((await light.get(`/locate/next?after=${first}&wait=0`)).body.seq).toBe(second);
      expect((await light.get(`/locate/next?after=${second}&wait=0`)).status).toBe(204);
    });

    it('gives a light starting up, or one older than the ring, the newest event only', async () => {
      const light = await readOnlyKey([ApiKeyScope.LOCATE_READ]);
      const productId = await stocked(cellA.id, 1);
      await general.post('/locate').send({ productIds: [productId] });
      const newest = (await general.post('/locate').send({ productIds: [productId] })).body.seq as number;

      expect((await light.get('/locate/next?wait=0')).body.seq).toBe(newest);
      expect((await light.get('/locate/next?after=0&wait=0')).body.seq).toBe(newest);
    });
  });

  /* ------------------------------------------------------------------ scopes */

  describe('who may do what', () => {
    it('lets a read-only light key be made with no service account and no expiry', async () => {
      const response = await admin.post('/admin/api-keys').send({
        name: `Drawer lights ${randomUUID().slice(0, 8)}`,
        scopes: [ApiKeyScope.LOCATE_READ],
        expiresInDays: null,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
    });

    it('holds locate:write to the write-key rules: a service account is required', async () => {
      const response = await admin.post('/admin/api-keys').send({
        name: 'Voice unit with no principal',
        scopes: [ApiKeyScope.LOCATE_WRITE],
        expiresInDays: 30,
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body.details)).toContain('serviceAccountId');
    });

    it('refuses a locate from a locate:read key and from an inventory:read key', async () => {
      const productId = await stocked(cellA.id, 1);
      for (const scopes of [[ApiKeyScope.LOCATE_READ], [ApiKeyScope.INVENTORY_READ]]) {
        const key = await readOnlyKey(scopes);
        const response = await key.post('/locate').send({ productIds: [productId] });
        expect(response.status, scopes.join()).toBe(403);
        expect(response.body.code).toBe(ErrorCode.API_KEY_SCOPE_DENIED);
      }
    });

    it('refuses the feed to a locate:write key and to an inventory:read key', async () => {
      const writer = httpClient(ctx.app, {
        token: (await issueBoundKey(admin, [ApiKeyScope.LOCATE_WRITE])).token,
      });
      const reader = await readOnlyKey([ApiKeyScope.INVENTORY_READ]);
      for (const key of [writer, reader]) {
        const response = await key.get('/locate/next?wait=0');
        expect(response.status).toBe(403);
        expect(response.body.code).toBe(ErrorCode.API_KEY_SCOPE_DENIED);
      }
    });

    it('lets a locate:write key report, and a locate:read key read', async () => {
      const productId = await stocked(cellA.id, 1);
      const writer = httpClient(ctx.app, {
        token: (await issueBoundKey(admin, [ApiKeyScope.LOCATE_WRITE])).token,
      });
      const light = await readOnlyKey([ApiKeyScope.LOCATE_READ]);

      const posted = await writer.post('/locate').send({ productIds: [productId] });
      expect(posted.status).toBe(202);
      expect((await light.get('/locate/latest')).body.seq).toBe(posted.body.seq);
    });
  });

  /* -------------------------------------------------------------- rate limit */

  describe('the per-caller limit', () => {
    const limit = Number(TEST_ENV.THROTTLE_LOCATE_LIMIT);

    it('refuses a user past the limit with a Retry-After, and not another user at the same address', async () => {
      const productId = await stocked(cellA.id, 1);
      // One address for both, so a per-address count would refuse the second user too.
      const sameAddress = httpClient(ctx.app);
      const first = (await createUserAndLogin(ctx.db, sameAddress)).client;
      const second = (await createUserAndLogin(ctx.db, sameAddress)).client;

      for (let call = 0; call < limit; call += 1) {
        expect((await first.post('/locate').send({ productIds: [productId] })).status).toBe(202);
      }
      const refused = await first.post('/locate').send({ productIds: [productId] });
      expect(refused.status).toBe(429);
      expect(refused.body.code).toBe(ErrorCode.RATE_LIMITED);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);

      expect((await second.post('/locate').send({ productIds: [productId] })).status).toBe(202);
    });

    it('counts per key, even for two keys acting as the same service account', async () => {
      const productId = await stocked(cellA.id, 1);
      const serviceAccountId = await createServiceAccount(admin);
      const keyA = httpClient(ctx.app, {
        token: (await issueBoundKey(admin, [ApiKeyScope.LOCATE_WRITE], { serviceAccountId })).token,
      });
      const keyB = httpClient(ctx.app, {
        token: (await issueBoundKey(admin, [ApiKeyScope.LOCATE_WRITE], { serviceAccountId })).token,
      });

      for (let call = 0; call < limit; call += 1) {
        expect((await keyA.post('/locate').send({ productIds: [productId] })).status).toBe(202);
      }
      const refused = await keyA.post('/locate').send({ productIds: [productId] });
      expect(refused.status).toBe(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);

      expect((await keyB.post('/locate').send({ productIds: [productId] })).status).toBe(202);
    });
  });

  /* -------------------------------------------------------------- full house */

  describe('when every waiting slot is taken', () => {
    let small: TestApp;

    beforeAll(async () => {
      small = await createTestApp({ locate: { maxWaiters: 1 } });
    });
    afterAll(async () => {
      await small.close();
    });

    it('refuses the next poll with a 429 and a Retry-After shorter than an event lives', async () => {
      const adminOfSmall = (
        await createUserAndLogin(small.db, httpClient(small.app), { roles: [Role.ADMIN] })
      ).client;
      const issued = await adminOfSmall
        .post('/admin/api-keys')
        .send({ name: `Light ${randomUUID().slice(0, 8)}`, scopes: [ApiKeyScope.LOCATE_READ], expiresInDays: null });
      expect(issued.status).toBe(201);
      const light = httpClient(small.app, { token: issued.body.token as string });
      const smallFeed = small.app.get(LocateFeed);

      const parked = light.get('/locate/next?wait=20').then((response) => response.status);
      await vi.waitFor(() => expect(smallFeed.waiting).toBe(1));
      const refused = await light.get('/locate/next?wait=20');
      expect(refused.status).toBe(429);
      expect(refused.body.code).toBe(ErrorCode.RATE_LIMITED);
      const retryAfter = Number(refused.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThan(Number(TEST_ENV.LOCATE_EVENT_TTL_SECONDS));

      smallFeed.onModuleDestroy(); // releases the parked poll with a 204
      await expect(parked).resolves.toBe(204);
    });
  });

  /* ---------------------------------------------------------- import lockout */

  describe('during an import', () => {
    let lock: ImportLockService;

    beforeEach(() => {
      lock = ctx.app.get(ImportLockService);
    });

    afterEach(async () => {
      // Process state that `resetData` cannot clear: left engaged, it would 503 every later spec.
      const held = lock.heldJobId();
      if (held) await lock.release(held, null);
      await sql`update import_jobs set status = 'CANCELLED' where status = 'APPLYING'`.execute(
        ctx.db,
      );
    });

    /** The state a live apply leaves, as `import-lockout.int-spec.ts` builds it. */
    async function engageLock(): Promise<void> {
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
    }

    it('refuses /locate and /locate/next with 503 and a Retry-After the light can back off by', async () => {
      const light = await readOnlyKey([ApiKeyScope.LOCATE_READ]);
      await engageLock();

      for (const response of [
        await general.post('/locate').send({ productIds: [randomUUID()] }),
        await light.get('/locate/next?wait=0'),
      ]) {
        expect(response.status).toBe(503);
        expect(response.body.code).toBe(ErrorCode.SYSTEM_IMPORT_IN_PROGRESS);
        const retryAfter = Number(response.headers['retry-after']);
        expect(retryAfter).toBeGreaterThan(0);
        expect(retryAfter).toBeLessThanOrEqual(10 * 60);
      }
    });
  });
});
