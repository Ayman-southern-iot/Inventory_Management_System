import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { ImportIssueCode, ImportJobStatus, Role, StockMovementType } from '@ims/shared';
import { createTestApp, httpClient, type TestApp } from './app';
import { createUserAndLogin, resetData } from './factories';
import {
  createProduct,
  createStockFixture,
  ledgerRows,
  placementOf,
  type StockFixture,
} from './stock-factories';
import { SYSTEM_AUDIT_CONTEXT } from '../src/modules/audit/audit-context';
import type { AuditContext } from '../src/modules/audit/audit-context';
import { StockService } from '../src/modules/stock/stock.service';
import { FilesService } from '../src/modules/files/files.service';
import { ImportApplyService } from '../src/modules/imports/import-apply.service';
import { ImportJobsService } from '../src/modules/imports/import-jobs.service';
import { ProductExportService } from '../src/modules/imports/product-export.service';
import { IMPORT_COLUMNS, stripBom } from '../src/modules/imports/import-format';

/**
 * Applying an approved import (`importing_data.md` §5.5, part G).
 *
 * This is the first slice of this feature that writes, so what is worth testing is not that the
 * numbers land — it is the things that make landing them safe: the delta comes from the locked
 * row rather than from the preview, the ledger gets one row per change, a failure leaves nothing
 * behind, and a backup exists before any of it starts.
 */
describe('import apply', () => {
  let ctx: TestApp;
  let fixture: StockFixture;
  let actorId: string;
  let apply: ImportApplyService;
  let jobs: ImportJobsService;
  let exporter: ProductExportService;

  /** The system context, with this spec's actor — the shape `AuditService.record` expects. */
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

  /** Uploads through the service rather than HTTP; the endpoint has its own spec. */
  async function startJob(contents: string): Promise<string> {
    const stored = await ctx.app.get(FilesService).upload({
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
    return job.id;
  }

  /** Runs a whole import to completion — upload, validate, confirm, apply. */
  async function runImport(contents: string) {
    const jobId = await startJob(contents);
    const { completed } = await apply.confirm(jobId, { id: actorId }, auditContext());
    await completed;
    return jobs.get(jobId);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    apply = ctx.app.get(ImportApplyService);
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
        { performedBy: actorId, note: 'apply fixture' },
      );
  });

  describe('what it writes', () => {
    it('moves a shelf to the count the file asked for', async () => {
      const job = await runImport(file(edit(await exported(), fixture.productId, 'on_hand', '4')));

      expect(job.status).toBe(ImportJobStatus.COMPLETED);
      expect(job.finishedAt).not.toBeNull();
      const placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement?.quantity).toBe(4);
    });

    /** One movement per changed shelf, and it is an ADJUST — not a RECEIPT. Nothing arrived. */
    it('records the movement in the ledger, tagged with the job', async () => {
      const before = (await ledgerRows(ctx.db, fixture.productId)).length;
      const job = await runImport(file(edit(await exported(), fixture.productId, 'on_hand', '4')));

      const rows = await ledgerRows(ctx.db, fixture.productId);
      expect(rows).toHaveLength(before + 1);
      const last = rows[rows.length - 1]!;
      expect(last.movement_type).toBe(StockMovementType.ADJUST);
      expect(last.quantity).toBe(6);
      expect(last.note).toContain(job.id);
    });

    it('creates a product the file introduces', async () => {
      const lines = await exported();
      const row = IMPORT_COLUMNS.map((column) => {
        if (column === 'product_name') return 'Hokuyo UST-10LX';
        if (column === 'unit') return 'pcs';
        if (column === 'default_returnable') return 'yes';
        if (column === 'status') return 'Active';
        if (column === 'product_code') return `LIDAR-${randomUUID().slice(0, 6)}`;
        if (column === 'on_hand') return '0';
        return '';
      }).join(',');

      await runImport(file([...lines, row]));

      const created = await ctx.db
        .selectFrom('products')
        .select(['id', 'is_active'])
        .where('name', '=', 'Hokuyo UST-10LX')
        .executeTakeFirst();
      expect(created).toBeDefined();
      expect(created!.is_active).toBe(true);
    });

    /** I1: the file is the desired state, so what it never mentions is retired. */
    it('retires a product the file leaves out', async () => {
      const doomed = await createProduct(ctx.db, {
        categoryId: fixture.categoryId,
        name: `Doomed ${randomUUID().slice(0, 8)}`,
      });
      const lines = (await exported()).filter((line) => !line.includes(doomed));

      await runImport(file(lines));

      const row = await ctx.db
        .selectFrom('products')
        .select('is_active')
        .where('id', '=', doomed)
        .executeTakeFirstOrThrow();
      expect(row.is_active).toBe(false);
    });

    /** I10: one row for the decision, not one per thing it touched. */
    it('writes exactly one audit row for the whole import', async () => {
      const job = await runImport(file(edit(await exported(), fixture.productId, 'on_hand', '4')));

      const rows = await ctx.db
        .selectFrom('audit_log')
        .select(['action', 'entity_id'])
        .where('entity_id', '=', job.id)
        .execute();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe('import.apply');
      const adjusts = await ctx.db
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'stock.adjust')
        .execute();
      expect(adjusts).toEqual([]);
    });

    /** I11 and C46: the same file twice is a no-op, so a failed import can simply be re-run. */
    it('changes nothing the second time the same file is applied', async () => {
      const contents = file(edit(await exported(), fixture.productId, 'on_hand', '4'));
      await runImport(contents);
      const afterFirst = await ledgerRows(ctx.db, fixture.productId);

      // The file no longer matches reality's *old* state, so re-export and re-import it as-is.
      const second = await runImport(file(await exported()));

      expect(second.status).toBe(ImportJobStatus.COMPLETED);
      expect(await ledgerRows(ctx.db, fixture.productId)).toHaveLength(afterFirst.length);
      expect(second.diff!.shelvesChanged).toBe(0);
    });
  });

  describe('the backup', () => {
    /** C38, and the reason the snapshot is taken before the transaction rather than inside it. */
    it('writes a snapshot of the previous state before applying', async () => {
      const job = await runImport(file(edit(await exported(), fixture.productId, 'on_hand', '4')));

      const row = await ctx.db
        .selectFrom('import_jobs')
        .select('snapshot_file_id')
        .where('id', '=', job.id)
        .executeTakeFirstOrThrow();
      expect(row.snapshot_file_id).not.toBeNull();

      // It is a round-trip file, and it holds the numbers from *before* the import.
      const { contents } = await ctx.app.get(FilesService).readContents(row.snapshot_file_id!);
      expect(contents.toString('utf8')).toContain('# ims-product-import');
      const shelfLine = stripBom(contents.toString('utf8'))
        .split('\r\n')
        .find((line) => line.includes(fixture.productId));
      expect(shelfLine).toBeDefined();
      expect(shelfLine!.split(',')[IMPORT_COLUMNS.indexOf('on_hand')]).toBe('10');
    });

    it('says a job can be restored once its snapshot exists', async () => {
      const job = await runImport(file(edit(await exported(), fixture.productId, 'on_hand', '4')));
      expect(job.canRestore).toBe(true);
    });
  });

  describe('what it refuses', () => {
    it('refuses to confirm a job that is not waiting', async () => {
      const jobId = await startJob(file(await exported()));
      await jobs.cancel(jobId);

      await expect(apply.confirm(jobId, { id: actorId }, auditContext())).rejects.toThrow(
        /nothing to confirm/,
      );
    });

    /**
     * §5.4's last line. The bytes are rehashed at confirm, so the diff a human approved is
     * provably the diff that gets written.
     */
    it('refuses a job whose file changed underneath it', async () => {
      const jobId = await startJob(file(await exported()));
      await ctx.db
        .updateTable('import_jobs')
        .set({ file_sha256: 'deadbeef'.repeat(8) })
        .where('id', '=', jobId)
        .execute();

      await expect(apply.confirm(jobId, { id: actorId }, auditContext())).rejects.toMatchObject({
        response: { code: 'IMPORT_FILE_CHANGED' },
      });
    });

    /**
     * C21. The preview said this was fine; a borrow landed while the human was reading it.
     *
     * Caught at **confirm**, by the re-validation that runs before the transaction opens — not
     * by the under-lock re-check, which is the narrower guard behind it. Either way nothing is
     * written, and the job says why.
     */
    it('refuses when a reservation appears between preview and confirm', async () => {
      const jobId = await startJob(file(edit(await exported(), fixture.productId, 'on_hand', '0')));

      await ctx.db
        .updateTable('stock_placements')
        .set({ reserved_qty: 3 })
        .where('product_id', '=', fixture.productId)
        .where('compartment_id', '=', fixture.compartmentA)
        .execute();

      await expect(apply.confirm(jobId, { id: actorId }, auditContext())).rejects.toMatchObject({
        response: { code: 'IMPORT_VALIDATION_FAILED' },
      });

      const job = await jobs.get(jobId);
      expect(job.status).toBe(ImportJobStatus.FAILED);
      expect(job.errors.map((i) => i.code)).toContain(ImportIssueCode.BELOW_RESERVED);

      // And nothing moved.
      const placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement?.quantity).toBe(10);
    });

    /** I7. A rejected import writes nothing at all — no stock, no ledger, no audit row. */
    it('leaves the catalogue untouched when the apply is refused', async () => {
      const before = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      const ledgerBefore = (await ledgerRows(ctx.db, fixture.productId)).length;

      const jobId = await startJob(file(edit(await exported(), fixture.productId, 'on_hand', '0')));
      await ctx.db
        .updateTable('stock_placements')
        .set({ reserved_qty: 3 })
        .where('product_id', '=', fixture.productId)
        .execute();

      await expect(apply.confirm(jobId, { id: actorId }, auditContext())).rejects.toThrow();

      const after = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(after?.quantity).toBe(before?.quantity);
      expect(await ledgerRows(ctx.db, fixture.productId)).toHaveLength(ledgerBefore);
      const audits = await ctx.db
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'import.apply')
        .execute();
      expect(audits).toEqual([]);
    });

    it('releases the slot once an import has completed', async () => {
      await runImport(file(edit(await exported(), fixture.productId, 'on_hand', '4')));

      // A second import can start, which it could not while the first held a live status.
      const second = await startJob(file(await exported()));
      expect((await jobs.get(second)).status).toBe(ImportJobStatus.AWAITING_CONFIRMATION);
    });
  });
});
