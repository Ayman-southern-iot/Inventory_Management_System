import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUserAndLogin, resetData } from './factories';
import {
  createCategory,
  createProduct,
  createStockFixture,
  type StockFixture,
} from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';
import { IMPORT_COLUMNS, UTF8_BOM, stripBom } from '../src/modules/imports/import-format';

/**
 * `GET /inventory/export` — the round-trip CSV (`importing_data.md` part B).
 *
 * This file is the input to the Claude skill, the format the importer will read back, and the
 * shape a pre-import snapshot is taken in. Everything downstream is defined in terms of it, so
 * what is worth testing is the parts that would silently poison that round trip:
 *
 *  - the immutable ids are present, because without them an update becomes a duplicate;
 *  - a product with no stock still gets a row, because otherwise its own export tells the next
 *    import to deactivate it;
 *  - read-only columns carry the derived numbers, so nobody is tempted to compute them.
 */
describe('product export', () => {
  let ctx: TestApp;
  let im: HttpClient;
  let actorId: string;
  let fixture: StockFixture;

  /** Split on CRLF, drop the fingerprint and the header, ignore the trailing blank. */
  function dataRows(body: string): string[] {
    return stripBom(body)
      .split('\r\n')
      .slice(2)
      .filter((line) => line.length > 0);
  }

  function cell(row: string, column: string): string {
    const index = IMPORT_COLUMNS.indexOf(column as never);
    // Good enough for fixtures, which contain no embedded commas — the parser in part C is the
    // thing that has to be rigorous about quoting.
    return (row.split(',')[index] ?? '').replace(/^"|"$/g, '');
  }

  const rowFor = (body: string, productId: string): string[] =>
    dataRows(body).filter((row) => cell(row, 'product_id') === productId);

  beforeAll(async () => {
    ctx = await createTestApp();
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
  });

  describe('the envelope', () => {
    it('serves a CSV attachment', async () => {
      const response = await im.get('/inventory/export');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toMatch(/attachment; filename=".*\.csv"/);
    });

    /** Without it Excel on Windows decodes UTF-8 as the code page and mangles every accent. */
    it('starts with a byte-order mark', async () => {
      const response = await im.get('/inventory/export');
      expect(response.text.startsWith(UTF8_BOM)).toBe(true);
    });

    it('carries a fingerprint naming the format, the schema and this deployment', async () => {
      const response = await im.get('/inventory/export');
      const first = stripBom(response.text).split('\r\n')[0]!;

      expect(first).toMatch(/^# ims-product-import v1 · exported .+ · schema \d{4} · origin .+$/);
    });

    /** The same installation must fingerprint the same, or every file it wrote becomes foreign. */
    it('uses a stable deployment id across exports', async () => {
      const first = (await im.get('/inventory/export')).text;
      const second = (await im.get('/inventory/export')).text;
      const origin = (body: string) => /origin (\S+)/.exec(body)?.[1];

      expect(origin(first)).toBeDefined();
      expect(origin(first)).toBe(origin(second));
    });

    it('writes the columns in the contracted order', async () => {
      const response = await im.get('/inventory/export');
      const header = stripBom(response.text).split('\r\n')[1];
      expect(header).toBe(IMPORT_COLUMNS.join(','));
    });
  });

  describe('what each row carries', () => {
    beforeEach(async () => {
      const stock = ctx.app.get(StockService);
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        { performedBy: actorId, note: 'export fixture' },
      );
    });

    /** Without these an update is indistinguishable from a create, and the round trip duplicates. */
    it('carries the immutable ids', async () => {
      const response = await im.get('/inventory/export');
      const rows = rowFor(response.text, fixture.productId);

      expect(rows).toHaveLength(1);
      expect(cell(rows[0]!, 'product_id')).toBe(fixture.productId);
      expect(cell(rows[0]!, 'category_id')).toBe(fixture.categoryId);
      expect(cell(rows[0]!, 'storage_id')).not.toBe('');
    });

    it('carries the shelf as text as well as by id', async () => {
      const response = await im.get('/inventory/export');
      const row = rowFor(response.text, fixture.productId)[0]!;

      expect(cell(row, 'room')).not.toBe('');
      expect(cell(row, 'zone')).not.toBe('');
      expect(cell(row, 'compartment')).toBe('A1');
      expect(cell(row, 'on_hand')).toBe('10');
    });

    it('reports the derived quantities rather than leaving them to be computed', async () => {
      const response = await im.get('/inventory/export');
      const row = rowFor(response.text, fixture.productId)[0]!;

      expect(cell(row, 'reserved')).toBe('0');
      expect(cell(row, 'quarantined')).toBe('0');
      expect(cell(row, 'available')).toBe('10');
      expect(cell(row, 'in_use_total')).toBe('0');
      expect(cell(row, 'owned_total')).toBe('10');
    });

    it('resolves the category path root-first, so nobody walks a tree', async () => {
      /*
       * Unique names, not readable ones. Root category names are globally unique
       * (`categories_root_name_key`) and `resetData` deliberately leaves categories in place,
       * so a spec that hardcodes "Electronics" fails the moment another spec does the same —
       * in whichever order they happen to run.
       */
      const tag = randomUUID().slice(0, 8);
      const names = [`Top ${tag}`, `Middle ${tag}`, `Leaf ${tag}`];
      const parent = await createCategory(ctx.db, { name: names[0] });
      const child = await createCategory(ctx.db, { name: names[1], parentId: parent });
      const leaf = await createCategory(ctx.db, { name: names[2], parentId: child });
      const productId = await createProduct(ctx.db, { categoryId: leaf });

      const response = await im.get('/inventory/export');
      const row = rowFor(response.text, productId)[0]!;

      expect(cell(row, 'category_path')).toBe(names.join(' / '));
      expect(cell(row, 'category_id')).toBe(leaf);
    });

    it('quotes the two columns Excel would otherwise destroy', async () => {
      const response = await im.get('/inventory/export');
      const row = rowFor(response.text, fixture.productId)[0]!;
      const raw = row.split(',');

      // `0001` becomes 1 and `1-2` becomes a date without quotes — on open, before anybody types.
      expect(raw[IMPORT_COLUMNS.indexOf('product_code')]).toMatch(/^".*"$/);
      expect(raw[IMPORT_COLUMNS.indexOf('storage_id')]).toMatch(/^".*"$/);
    });
  });

  describe('one row per product per shelf', () => {
    it('writes a row for each shelf a product sits on', async () => {
      const stock = ctx.app.get(StockService);
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 7 },
        { performedBy: actorId, note: 'shelf A' },
      );
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentB, quantity: 3 },
        { performedBy: actorId, note: 'shelf B' },
      );

      const response = await im.get('/inventory/export');
      const rows = rowFor(response.text, fixture.productId);

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => cell(row, 'on_hand')).sort()).toEqual(['3', '7']);
      // Product-level columns repeat, so the file is editable in a spreadsheet without lookups.
      expect(new Set(rows.map((row) => cell(row, 'product_name'))).size).toBe(1);
    });

    /**
     * The row that is easy to forget and expensive to miss: without it a brand-new catalogue
     * entry is absent from its own export, so the next import reads the file as the desired
     * state and deactivates it.
     */
    it('writes a blank-location row for a product holding nothing', async () => {
      const response = await im.get('/inventory/export');
      const rows = rowFor(response.text, fixture.productId);

      expect(rows).toHaveLength(1);
      expect(cell(rows[0]!, 'room')).toBe('');
      expect(cell(rows[0]!, 'compartment')).toBe('');
      expect(cell(rows[0]!, 'on_hand')).toBe('0');
    });

    it('leaves the category columns blank for an uncategorised product', async () => {
      const productId = await createProduct(ctx.db, { categoryId: null });
      const response = await im.get('/inventory/export');
      const row = rowFor(response.text, productId)[0]!;

      expect(cell(row, 'category_id')).toBe('');
      expect(cell(row, 'category_path')).toBe('');
    });
  });

  describe('retired products', () => {
    /** Omitting them would look complete and tell the next import to deactivate what it never saw. */
    it('includes them by default, marked Inactive', async () => {
      await ctx.db
        .updateTable('products')
        .set({ is_active: false })
        .where('id', '=', fixture.productId)
        .execute();

      const response = await im.get('/inventory/export');
      const row = rowFor(response.text, fixture.productId)[0]!;
      expect(cell(row, 'status')).toBe('Inactive');
    });

    it('can be asked to leave them out', async () => {
      await ctx.db
        .updateTable('products')
        .set({ is_active: false })
        .where('id', '=', fixture.productId)
        .execute();

      const response = await im.get('/inventory/export?includeInactive=false');
      expect(rowFor(response.text, fixture.productId)).toHaveLength(0);
    });
  });

  describe('who may take it', () => {
    it('is refused to a general user', async () => {
      const general = await createUserAndLogin(ctx.db, httpClient(ctx.app), {});
      expect((await general.client.get('/inventory/export')).status).toBe(403);
    });

    it('is refused without a session', async () => {
      expect((await httpClient(ctx.app).get('/inventory/export')).status).toBe(401);
    });

    /** It is not part of `inventory:read`; a key must not be able to pull every internal id. */
    it('is not reachable with an API key', async () => {
      const admin = await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.ADMIN] });
      const created = await admin.client.post('/admin/api-keys').send({
        name: 'Export probe',
        scopes: ['inventory:read'],
        expiresInDays: null,
      });

      const response = await httpClient(ctx.app, { token: created.body.token }).get(
        '/inventory/export',
      );
      expect(response.status).toBe(403);
    });
  });
});
