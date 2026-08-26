import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type InventoryReport } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * EX-02, requirements §10: "Bill of Materials and inventory records can be exported as PDF for
 * the Inventory Manager to submit physical copies to the accounts department."
 *
 * The BOM half shipped in phase 04. The inventory half never did, and QA filed it under D-024
 * without its own defect id, which is how the last unimplemented REQUIRED obligation in the
 * document stayed invisible through two QA rounds.
 *
 * Stock is seeded through StockService, never by inserting placements directly: only StockService
 * writes stock (rules/40-database.md), and a fixture that writes around it would be testing the
 * report against a state the application cannot actually produce.
 */
describe('the inventory report (EX-02, requirements §10)', () => {
  let ctx: TestApp;
  let stock: StockService;
  let im: HttpClient;
  let general: HttpClient;
  let fixture: StockFixture;

  const actorFor = async (roles: Role[]) => {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return { id: user.id, client: http.as(session.accessToken) };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    const imActor = await actorFor([Role.GENERAL, Role.INVENTORY_MANAGER]);
    im = imActor.client;
    general = (await actorFor([Role.GENERAL])).client;

    fixture = await createStockFixture(ctx.db);
    // The same product on two shelves — the case the placement model exists for, and the one a
    // flat "quantity on the product row" report would render wrong.
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 40 },
      { performedBy: imActor.id, refType: 'TEST' },
    );
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentB, quantity: 30 },
      { performedBy: imActor.id, refType: 'TEST' },
    );
  });

  it('reports the product once, with a row per location', async () => {
    const response = await im.get('/reports/inventory');
    expect(response.status).toBe(200);

    const report = response.body as InventoryReport;
    const product = report.rows.find((row) => row.productId === fixture.productId);

    expect(product).toBeDefined();
    expect(product!.totalQuantity).toBe(70);
    expect(product!.placements).toHaveLength(2);
    expect(product!.placements.map((p) => p.quantity).sort((a, b) => a - b)).toEqual([30, 40]);
  });

  it('names the compartment by its code, which is the label on the shelf', async () => {
    const report = (await im.get('/reports/inventory')).body as InventoryReport;
    const product = report.rows.find((row) => row.productId === fixture.productId)!;

    // storage_compartments carries `code` ("A1"), not `name` — only the zone has a name. A
    // report that selected the wrong column would fail at run time, not at compile time.
    expect(product.placements.map((p) => p.compartmentName).sort()).toEqual(['A1', 'B2']);
    expect(product.placements.every((p) => p.zoneName.length > 0)).toBe(true);
  });

  it('totals from the rows it prints, so the report reconciles with itself', async () => {
    const report = (await im.get('/reports/inventory')).body as InventoryReport;

    const summed = report.rows.reduce((sum, row) => sum + row.totalQuantity, 0);
    expect(report.totals.totalQuantity).toBe(summed);
    expect(report.totals.productCount).toBe(report.rows.length);
  });

  it('keeps a product that holds nothing, rather than dropping it', async () => {
    // The default. `inStockOnly` is the opt-in for the other behaviour.
    const report = (await im.get('/reports/inventory')).body as InventoryReport;
    const empty = report.rows.filter((row) => row.totalQuantity === 0);

    const filtered = (await im.get('/reports/inventory?inStockOnly=true')).body as InventoryReport;
    expect(filtered.rows.every((row) => row.totalQuantity > 0)).toBe(true);
    expect(filtered.rows.length).toBe(report.rows.length - empty.length);
  });

  it('exports a CSV with one line per placement', async () => {
    const response = await im.get('/reports/inventory/export.csv');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');

    const body = response.text as string;
    const lines = body.trim().split('\n');
    expect(lines[0]).toContain('Storage ID');
    expect(lines[0]).toContain('Compartment');

    /**
     * Scoped to this fixture's product by its Storage ID.
     *
     * Compartment codes are only unique within a zone, and the suite shares one database, so
     * every earlier spec's fixture also has a compartment coded "A1". Asserting on the code
     * alone counted five other products' rows and would have kept passing however wrong the
     * report was.
     */
    const report = (await im.get('/reports/inventory')).body as InventoryReport;
    const product = report.rows.find((row) => row.productId === fixture.productId)!;
    const productLines = lines.filter((line) => line.split(',')[0] === product.productCode);

    expect(productLines).toHaveLength(2);
    expect(productLines.map((line) => line.split(',')[5]).sort()).toEqual(['A1', 'B2']);
    expect(lines.at(-1)).toContain('TOTAL');
  });

  it('exports a PDF, which is the format §10 actually asks for', async () => {
    const response = await im.get('/reports/inventory/export.pdf');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment');
    // %PDF- is the file signature. A 200 carrying the SPA's index.html was D-024 exactly, and
    // the browser saves it under the .pdf name either way, so the user believes it worked.
    expect(Buffer.from(response.body).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('is not readable by a general user', async () => {
    // Same guard as the expense report: the whole company's holdings are not a requester's view.
    expect((await general.get('/reports/inventory')).status).toBe(403);
    expect((await general.get('/reports/inventory/export.csv')).status).toBe(403);
    expect((await general.get('/reports/inventory/export.pdf')).status).toBe(403);
  });
});
