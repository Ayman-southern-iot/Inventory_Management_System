import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ErrorCode, ImportJobStatus, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUserAndLogin, resetData } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';
import { CONFIG, type AppConfig } from '../src/config';
import { StockService } from '../src/modules/stock/stock.service';
import { ProductExportService } from '../src/modules/imports/product-export.service';

/**
 * `POST /inventory/imports` and the three reads beside it (`importing_data.md` §5.1).
 *
 * The endpoint writes nothing to the catalogue: it stores the file, validates it, and parks the
 * result for a human. What is worth testing here is the envelope rather than the rules — who may
 * reach it, what it refuses before a byte is stored, and that a job with its diff comes back.
 */
describe('import upload', () => {
  let ctx: TestApp;
  let fixture: StockFixture;
  let im: HttpClient;
  let general: HttpClient;

  const csv = async (): Promise<Buffer> =>
    Buffer.from(await ctx.app.get(ProductExportService).toCsv(), 'utf8');

  const upload = (client: HttpClient, body: Buffer, name = 'products.csv') =>
    client.post('/inventory/imports').attach('file', body, name);

  beforeAll(async () => {
    ctx = await createTestApp();
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
    general = (await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.GENERAL] }))
      .client;

    await ctx.app
      .get(StockService)
      .receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
        { performedBy: manager.user.id, note: 'upload fixture' },
      );
  });

  describe('who may reach it', () => {
    /** The gate is the controller's, shared with the export — not a second one for this route. */
    it('refuses a general user', async () => {
      const response = await upload(general, await csv());
      expect(response.status).toBe(403);
    });

    it('refuses an unauthenticated caller', async () => {
      const response = await upload(httpClient(ctx.app), await csv());
      expect(response.status).toBe(401);
    });

    it('accepts an inventory manager', async () => {
      const response = await upload(im, await csv());
      expect(response.status).toBe(200);
    });
  });

  describe('what it refuses before anything is stored', () => {
    it('refuses a request with no file', async () => {
      const response = await im.post('/inventory/imports');
      expect(response.status).toBe(400);
    });

    /** A PDF is a perfectly good upload elsewhere in this system, and not here. */
    it('refuses a PDF', async () => {
      const response = await upload(im, Buffer.from('%PDF-1.4 invoice'), 'invoice.pdf');

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/could not be read as a CSV/);
      const files = await ctx.db.selectFrom('stored_files').selectAll().execute();
      expect(files).toEqual([]);
    });

    it('refuses a spreadsheet renamed to .csv', async () => {
      const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x80, 0x81]);
      const response = await upload(im, xlsx);

      expect(response.status).toBe(400);
      const files = await ctx.db.selectFrom('stored_files').selectAll().execute();
      expect(files).toEqual([]);
    });

    /**
     * **Where the byte cap actually bites**, which the error type answers and reasoning does not.
     *
     * Two layers could stop an oversized upload: multer, which aborts the multipart stream at
     * `limits.fileSize` before the whole body is received, or `FileStorageService`, which
     * compares `contents.byteLength` after the buffer already exists. Only the first is
     * acceptable as the primary guard — the second means a 200 MB file is read into memory in
     * full and then refused, which is what C32's streaming philosophy exists to prevent, for
     * bytes instead of rows.
     *
     * So this asserts the service's own message is *absent*: if it appears, multer did not stop
     * it and the cap is post-hoc.
     */
    it('refuses an oversized file at the multipart layer, not after buffering it', async () => {
      const max = ctx.app.get<AppConfig>(CONFIG).imports.maxFileBytes;
      const oversized = Buffer.alloc(max + 4096, 0x61);

      const response = await upload(im, oversized);

      // 413, from multer aborting the stream — not our own 400, which would mean the whole
      // file had been buffered before anything looked at its size.
      expect(response.status).toBe(413);
      expect(JSON.stringify(response.body)).not.toMatch(/That file is too large/);
      const files = await ctx.db.selectFrom('stored_files').selectAll().execute();
      expect(files).toEqual([]);
    });

    /** Text, decodes cleanly, and still not ours — caught by the fingerprint, with its message. */
    it('stores a CSV that is not ours, and fails the job rather than the upload', async () => {
      const response = await upload(im, Buffer.from('a,b\r\n1,2\r\n', 'utf8'), 'other.csv');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe(ImportJobStatus.FAILED);
      expect(response.body.errors[0].message).toMatch(
        /does not look like a file exported from this system/,
      );
    });
  });

  describe('what comes back', () => {
    it('parks the run with its diff, for a human to approve', async () => {
      const response = await upload(im, await csv());

      expect(response.status).toBe(200);
      expect(response.body.status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);
      expect(response.body.diff).not.toBeNull();
      expect(response.body.fileName).toBe('products.csv');
      expect(response.body.expiresAt).not.toBeNull();
    });

    it('records the file against the job, with its hash', async () => {
      const response = await upload(im, await csv());

      const row = await ctx.db
        .selectFrom('import_jobs')
        .select(['file_id', 'file_sha256'])
        .where('id', '=', response.body.id)
        .executeTakeFirstOrThrow();

      expect(row.file_id).not.toBeNull();
      expect(row.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('serves the job back by id, and in the history', async () => {
      const created = (await upload(im, await csv())).body;

      const fetched = await im.get(`/inventory/imports/${created.id}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.id).toBe(created.id);

      const listed = await im.get('/inventory/imports');
      expect(listed.status).toBe(200);
      expect(listed.body.map((job: { id: string }) => job.id)).toContain(created.id);
    });

    it('refuses a second upload while the first waits', async () => {
      await upload(im, await csv());
      const second = await upload(im, await csv());

      expect(second.status).toBe(409);
      expect(second.body.code).toBe(ErrorCode.IMPORT_ALREADY_RUNNING);
    });

    it('lets the slot go when the run is cancelled', async () => {
      const first = (await upload(im, await csv())).body;

      const cancelled = await im.post(`/inventory/imports/${first.id}/cancel`);
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe(ImportJobStatus.CANCELLED);

      expect((await upload(im, await csv())).status).toBe(200);
    });

    it('answers 404 for an import that does not exist', async () => {
      const response = await im.get(`/inventory/imports/${randomUUID()}`);
      expect(response.status).toBe(404);
    });
  });
});
