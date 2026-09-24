import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ImportJobStatus, Role } from '@ims/shared';
import { createTestApp, httpClient, type TestApp } from '../app';
import { createUserAndLogin } from '../factories';
import { createCategory, createCompartment, createZone } from '../stock-factories';
import { SYSTEM_AUDIT_CONTEXT, type AuditContext } from '../../src/modules/audit/audit-context';
import { FilesService } from '../../src/modules/files/files.service';
import { StockService } from '../../src/modules/stock/stock.service';
import { ImportApplyService } from '../../src/modules/imports/import-apply.service';
import { ImportJobsService } from '../../src/modules/imports/import-jobs.service';
import { ProductExportService } from '../../src/modules/imports/product-export.service';
import { IMPORT_COLUMNS, stripBom } from '../../src/modules/imports/import-format';

/**
 * How long an apply actually takes, at three sizes (`importing_data.md` §11.2 and §15).
 *
 * `IMPORT_MAX_CHANGED_SHELVES` was set from a table of *estimated* round trips, and §15 records
 * that as an outstanding measurement. This is that measurement: a real file, through the real
 * validate → confirm → apply path, against Postgres, with the ceilings raised out of the way so
 * the sizes above the shipped default can be reached at all.
 *
 * It asserts almost nothing. The output is the point — a run prints a table, and the number in
 * `.env.example` is then a timing rather than arithmetic. Two assertions guard the *validity* of
 * that output: the import must actually complete, and it must actually have changed the shelves
 * it claims, or the timing is of nothing.
 *
 * Not in the integration suite on purpose; see `vitest.bench.config.ts`.
 */

/** Shelves per product, so each size also exercises the per-product trackable hoist of part H. */
const SHELVES_PER_PRODUCT = 4;
const SIZES = [500, 5_000, 20_000] as const;

interface Result {
  shelves: number;
  products: number;
  seedMs: number;
  validateMs: number;
  applyMs: number;
  perShelfMs: number;
}

describe('import apply — cost by changed shelves', () => {
  let ctx: TestApp;
  let apply: ImportApplyService;
  let jobs: ImportJobsService;
  let exporter: ProductExportService;
  let stock: StockService;
  let actorId: string;
  const results: Result[] = [];

  const auditContext = (): AuditContext => ({ ...SYSTEM_AUDIT_CONTEXT, actorId });

  beforeAll(async () => {
    /*
     * The shipped ceilings exist to stop exactly what this file does, so they are lifted here
     * rather than edited anywhere real. `createTestApp` overrides the provider for this app only;
     * nothing on disk changes and no other spec sees it.
     */
    ctx = await createTestApp({
      imports: { maxRows: 1_000_000, maxChangedShelves: 1_000_000, maxFileBytes: 512 * 1024 * 1024 },
    });
    apply = ctx.app.get(ImportApplyService);
    jobs = ctx.app.get(ImportJobsService);
    exporter = ctx.app.get(ProductExportService);
    stock = ctx.app.get(StockService);

    const session = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.INVENTORY_MANAGER],
    });
    actorId = session.user.id;
  });

  afterAll(async () => {
    // The table is the deliverable. Printed once, after every size, so a partial run is obvious.
    const table = results
      .map(
        (r) =>
          `${String(r.shelves).padStart(7)} shelves | ${String(r.products).padStart(6)} products |` +
          ` seed ${(r.seedMs / 1000).toFixed(1)}s | validate ${(r.validateMs / 1000).toFixed(1)}s |` +
          ` apply ${(r.applyMs / 1000).toFixed(1)}s | ${r.perShelfMs.toFixed(2)} ms/shelf`,
      )
      .join('\n');
    console.log(`\nimport apply cost — importing_data.md §11.2\n${table}\n`);
    await ctx.close();
  });

  /**
   * One category, `count / SHELVES_PER_PRODUCT` products, and a placement on each shelf holding
   * one unit — so the file that follows is an *update* of every shelf, which is the expensive
   * path and the realistic one. Seeded through `StockService`, because nothing else may write
   * stock, and timed separately so it never lands in the apply figure.
   */
  async function seed(count: number): Promise<{ products: string[]; ms: number }> {
    const started = Date.now();
    const categoryId = await createCategory(ctx.db, { name: `Bench ${randomUUID().slice(0, 8)}` });
    const zoneId = await createZone(ctx.db, `Bench zone ${randomUUID().slice(0, 8)}`);

    const shelves: string[] = [];
    for (let index = 0; index < SHELVES_PER_PRODUCT; index += 1) {
      shelves.push(await createCompartment(ctx.db, zoneId));
    }

    const products: string[] = [];
    const rows = Array.from({ length: count / SHELVES_PER_PRODUCT }, () => ({
      product_code: `BENCH-${randomUUID().slice(0, 12)}`,
      name: `Bench product ${randomUUID().slice(0, 12)}`,
      category_id: categoryId,
      is_active: true,
    }));
    // Chunked: one 5,000-row INSERT exceeds the bind-parameter limit.
    for (let start = 0; start < rows.length; start += 500) {
      const inserted = await ctx.db
        .insertInto('products')
        .values(rows.slice(start, start + 500))
        .returning('id')
        .execute();
      products.push(...inserted.map((row) => row.id));
    }

    for (const productId of products) {
      for (const compartmentId of shelves) {
        await stock.receive({ productId, compartmentId, quantity: 1 }, { performedBy: actorId });
      }
    }

    return { products, ms: Date.now() - started };
  }

  /** The exported catalogue with `on_hand` bumped on every row this run just seeded. */
  function bump(lines: string[], mine: Set<string>): string {
    const onHand = IMPORT_COLUMNS.indexOf('on_hand');
    const productId = IMPORT_COLUMNS.indexOf('product_id');
    const edited = lines.map((line, position) => {
      if (position < 2) return line;
      const cells = line.split(',');
      if (!mine.has(cells[productId] ?? '')) return line;
      cells[onHand] = '2';
      return cells.join(',');
    });
    return `${edited.join('\r\n')}\r\n`;
  }

  for (const shelves of SIZES) {
    it(`applies ${shelves.toLocaleString()} changed shelves`, async () => {
      const { products, ms: seedMs } = await seed(shelves);
      const mine = new Set(products);

      const lines = stripBom(await exporter.toCsv())
        .split('\r\n')
        .filter((line) => line.length > 0);
      const contents = bump(lines, mine);

      const stored = await ctx.app.get(FilesService).upload({
        kind: 'PRODUCT_IMPORT',
        contents: Buffer.from(contents, 'utf8'),
        originalName: 'bench.csv',
        uploadedBy: actorId,
      });

      const validateStarted = Date.now();
      const job = await jobs.start({
        fileId: stored.id,
        fileSha256: createHash('sha256').update(Buffer.from(contents, 'utf8')).digest('hex'),
        contents,
        actorId,
      });
      const validateMs = Date.now() - validateStarted;

      // The timing is of nothing unless the diff really is this size.
      expect(job.diff?.shelvesChanged).toBe(shelves);

      const applyStarted = Date.now();
      const { completed } = await apply.confirm(job.id, { id: actorId }, auditContext());
      await completed;
      const applyMs = Date.now() - applyStarted;

      const finished = await jobs.get(job.id);
      expect(finished.status).toBe(ImportJobStatus.COMPLETED);

      results.push({
        shelves,
        products: products.length,
        seedMs,
        validateMs,
        applyMs,
        perShelfMs: applyMs / shelves,
      });
    });
  }
});
