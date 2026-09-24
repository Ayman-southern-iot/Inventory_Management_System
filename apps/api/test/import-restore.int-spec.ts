import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { ErrorCode, ImportJobStatus, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUserAndLogin, resetData } from './factories';
import { createStockFixture, placementOf, type StockFixture } from './stock-factories';
import { SYSTEM_AUDIT_CONTEXT, type AuditContext } from '../src/modules/audit/audit-context';
import { StockService } from '../src/modules/stock/stock.service';
import { FilesService } from '../src/modules/files/files.service';
import { ImportApplyService } from '../src/modules/imports/import-apply.service';
import { ImportJobsService } from '../src/modules/imports/import-jobs.service';
import { ProductExportService } from '../src/modules/imports/product-export.service';
import { IMPORT_COLUMNS, stripBom } from '../src/modules/imports/import-format';

/**
 * Snapshots, history and rollback (`importing_data.md` §10, parts F and K).
 *
 * The design claim being tested is that **restore is not a special path** — the snapshot is a
 * round-trip export file, so putting the catalogue back runs the same validation, the same diff,
 * the same confirm gate and the same apply as any other import. If that holds, restore inherits
 * every test already written for those; if it does not, it is a second code path pretending.
 */
describe('import snapshots and restore', () => {
  let ctx: TestApp;
  let fixture: StockFixture;
  let actorId: string;
  let im: HttpClient;
  let jobs: ImportJobsService;
  let apply: ImportApplyService;
  let files: FilesService;
  let exporter: ProductExportService;

  const auditContext = (): AuditContext => ({ ...SYSTEM_AUDIT_CONTEXT, actorId });

  async function exported(): Promise<string[]> {
    return stripBom(await exporter.toCsv())
      .split('\r\n')
      .filter((line) => line.length > 0);
  }

  function edit(lines: string[], productId: string, column: string, value: string): string[] {
    const index = IMPORT_COLUMNS.indexOf(column as never);
    return lines.map((line, position) => {
      if (position < 2 || !line.includes(productId)) return line;
      const cells = line.split(',');
      cells[index] = value;
      return cells.join(',');
    });
  }

  const file = (lines: string[]): string => `${lines.join('\r\n')}\r\n`;

  /** A whole import, start to finish, so there is a snapshot to restore from. */
  async function runImport(contents: string): Promise<string> {
    const stored = await files.upload({
      kind: 'PRODUCT_IMPORT',
      contents: Buffer.from(contents, 'utf8'),
      originalName: 'products.csv',
      uploadedBy: actorId,
    });
    const job = await jobs.start({
      fileId: stored.id,
      fileSha256: createHash('sha256').update(Buffer.from(contents, 'utf8')).digest('hex'),
      contents,
      actorId,
    });
    const { completed } = await apply.confirm(job.id, { id: actorId }, auditContext());
    await completed;
    return job.id;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    jobs = ctx.app.get(ImportJobsService);
    apply = ctx.app.get(ImportApplyService);
    files = ctx.app.get(FilesService);
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
    im = session.client;
    actorId = session.user.id;
    await ctx.app
      .get(StockService)
      .receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        { performedBy: actorId, note: 'restore fixture' },
      );
  });

  describe('putting the catalogue back', () => {
    /**
     * The whole feature in one test: import a change, restore the snapshot, and the number is
     * back where it started — through the ordinary pipeline, with a confirm step in the middle.
     */
    it('undoes an import by restoring the snapshot it took', async () => {
      const first = await runImport(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );
      expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentA))?.quantity).toBe(
        4,
      );

      const restore = await jobs.restore(first, actorId, files);
      expect(restore.status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);
      expect(restore.restoredFromJobId).toBe(first);

      const { completed } = await apply.confirm(restore.id, { id: actorId }, auditContext());
      await completed;

      expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentA))?.quantity).toBe(
        10,
      );
    });

    /** I2 holds for a restore too: it stops at the gate, it does not write on click. */
    it('waits for a human rather than restoring immediately', async () => {
      const first = await runImport(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );

      const restore = await jobs.restore(first, actorId, files);

      expect(restore.status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);
      expect(restore.diff).not.toBeNull();
      // Nothing moved yet.
      expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentA))?.quantity).toBe(
        4,
      );
    });

    /**
     * §2.3: a restore is a compensating adjustment, not an erasure. Both movements stay — the
     * stock really did move twice, and an audited system has to say so.
     */
    it('leaves both movements in the ledger', async () => {
      const first = await runImport(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );
      const before = await ctx.db
        .selectFrom('stock_ledger')
        .select('id')
        .where('product_id', '=', fixture.productId)
        .execute();

      const restore = await jobs.restore(first, actorId, files);
      const { completed } = await apply.confirm(restore.id, { id: actorId }, auditContext());
      await completed;

      const after = await ctx.db
        .selectFrom('stock_ledger')
        .select('id')
        .where('product_id', '=', fixture.productId)
        .execute();
      expect(after.length).toBe(before.length + 1);
    });

    /**
     * The snapshot is copied rather than shared. `import_jobs.file_id` is ON DELETE RESTRICT, so
     * pointing the restore at the snapshot row would make that backup undeletable for as long as
     * the restore existed — and §10 explicitly allows deleting a backup to reclaim the bytes.
     */
    it('gives the restore its own input file, leaving the snapshot deletable', async () => {
      const first = await runImport(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );
      const source = await ctx.db
        .selectFrom('import_jobs')
        .select('snapshot_file_id')
        .where('id', '=', first)
        .executeTakeFirstOrThrow();

      const restore = await jobs.restore(first, actorId, files);
      const copy = await ctx.db
        .selectFrom('import_jobs')
        .select('file_id')
        .where('id', '=', restore.id)
        .executeTakeFirstOrThrow();

      expect(copy.file_id).not.toBe(source.snapshot_file_id);
      // And the snapshot can still be deleted, which is the point of not sharing it.
      await expect(jobs.deleteSnapshot(first, files, auditContext())).resolves.toBeDefined();
    });
  });

  describe('the snapshot itself', () => {
    it('can be downloaded as the round-trip file it is', async () => {
      const first = await runImport(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );

      const response = await im.get(`/inventory/imports/${first}/snapshot`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.text).toContain('# ims-product-import');
      // It holds the numbers from *before* that import.
      const line = stripBom(response.text)
        .split('\r\n')
        .find((row) => row.includes(fixture.productId));
      expect(line!.split(',')[IMPORT_COLUMNS.indexOf('on_hand')]).toBe('10');
    });

    /**
     * A hard delete of the file, a soft one of the fact: the bytes go, the job and its diff stay,
     * and `snapshot_deleted_at` records that a backup once existed (§10).
     */
    it('can be deleted to reclaim the bytes, leaving the run in the history', async () => {
      const first = await runImport(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );

      const after = await jobs.deleteSnapshot(first, files, auditContext());

      expect(after.canRestore).toBe(false);
      expect(after.diff).not.toBeNull();
      const row = await ctx.db
        .selectFrom('import_jobs')
        .select(['snapshot_file_id', 'snapshot_deleted_at'])
        .where('id', '=', first)
        .executeTakeFirstOrThrow();
      expect(row.snapshot_file_id).toBeNull();
      expect(row.snapshot_deleted_at).not.toBeNull();
    });

    it('records the deletion in the audit log', async () => {
      const first = await runImport(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );
      await jobs.deleteSnapshot(first, files, auditContext());

      const rows = await ctx.db
        .selectFrom('audit_log')
        .select('action')
        .where('entity_id', '=', first)
        .where('action', '=', 'import.snapshot_delete')
        .execute();
      expect(rows).toHaveLength(1);
    });

    /** C44. Better a named refusal than a restore that finds nothing to restore. */
    it('refuses to restore a snapshot that was deleted', async () => {
      const first = await runImport(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );
      await jobs.deleteSnapshot(first, files, auditContext());

      await expect(jobs.restore(first, actorId, files)).rejects.toMatchObject({
        response: { code: ErrorCode.IMPORT_SNAPSHOT_DELETED },
      });
    });

    it('refuses to delete a snapshot twice', async () => {
      const first = await runImport(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );
      await jobs.deleteSnapshot(first, files, auditContext());

      await expect(jobs.deleteSnapshot(first, files, auditContext())).rejects.toMatchObject({
        response: { code: ErrorCode.IMPORT_SNAPSHOT_DELETED },
      });
    });

    it('answers 404 for a job that does not exist', async () => {
      const response = await im.get(`/inventory/imports/${randomUUID()}/snapshot`);
      expect(response.status).toBe(404);
    });
  });

  describe('the history', () => {
    it('lists past runs with their diffs and whether they can be restored', async () => {
      const first = await runImport(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );

      const response = await im.get('/inventory/imports');

      expect(response.status).toBe(200);
      const listed = response.body.find((job: { id: string }) => job.id === first);
      expect(listed).toBeDefined();
      expect(listed.status).toBe(ImportJobStatus.COMPLETED);
      expect(listed.canRestore).toBe(true);
      expect(listed.diff.shelvesChanged).toBe(1);
    });
  });
});
