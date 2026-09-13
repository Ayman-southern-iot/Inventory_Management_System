import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BorrowStatus, Role, type InventoryReport } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * The inventory report has to account for borrowed stock.
 *
 * Reported from the screen: the products list showed `esp` with 5 owned (1 on a shelf, 4 out
 * with someone) and the exported report showed 1. Issuing a borrow takes the stock out of its
 * compartment, and the report read `stock_placements` alone — so everything out on loan was
 * invisible, and the printed total the company sends to Accounts was short by exactly the amount
 * people were holding.
 *
 * The borrow is driven through the real endpoints rather than by writing rows: only StockService
 * writes stock (rules/40-database.md), and a fixture that wrote around it would be asserting the
 * report against a state the application cannot produce.
 */
describe('the inventory report counts what is out on loan', () => {
  let ctx: TestApp;
  let stock: StockService;
  let im: { id: string; client: HttpClient };
  let requester: { id: string; client: HttpClient };
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
    im = await actorFor([Role.GENERAL, Role.INVENTORY_MANAGER]);
    requester = await actorFor([Role.GENERAL]);

    fixture = await createStockFixture(ctx.db);
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  /** Raises a borrow and approves it, which is what actually issues the stock. */
  async function borrowAndIssue(quantity: number): Promise<string> {
    const created = await requester.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Field testing',
    });
    expect(created.status).toBe(201);

    const decided = await im.client
      .post(`/borrowing/${created.body.id}/decision`)
      .send({ approve: true, note: 'ok' });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe(BorrowStatus.ISSUED);

    return created.body.id as string;
  }

  const productRow = async () => {
    const report = (await im.client.get('/reports/inventory')).body as InventoryReport;
    return report.rows.find((row) => row.productId === fixture.productId)!;
  };

  it('splits owned stock into what is on the shelf and what is out', async () => {
    await borrowAndIssue(4);
    const row = await productRow();

    expect(row.totalQuantity).toBe(6); // left in the compartment
    expect(row.totalOnLoan).toBe(4); // with the borrower
    expect(row.totalOwned).toBe(10); // still the company's
  });

  it('agrees with the products list, which is where the mismatch was noticed', async () => {
    await borrowAndIssue(4);

    /*
     * Fetched by id, not found in a page of `/products`.
     *
     * The suite shares one database, so by the time the whole run reaches this spec the list is
     * long enough that the fixture's product is no longer on the first page — and scanning it
     * gave `undefined`, which passed alone and failed in the full run.
     */
    const product = (await im.client.get(`/products/${fixture.productId}`)).body as {
      totalOwned: number;
      totalInUse: number;
      totalAvailable: number;
    };
    const row = await productRow();

    expect(row.totalOwned).toBe(product.totalOwned);
    expect(row.totalOnLoan).toBe(product.totalInUse);
    expect(row.totalAvailable).toBe(product.totalAvailable);
  });

  it('counts a partial return back onto the shelf', async () => {
    const borrowId = await borrowAndIssue(4);

    const returned = await im.client
      .post(`/borrowing/${borrowId}/returns`)
      .send({ quantity: 3, compartmentId: fixture.compartmentA, condition: 'GOOD' });
    expect(returned.status).toBe(200);

    const row = await productRow();
    expect(row.totalOnLoan).toBe(1);
    expect(row.totalQuantity).toBe(9);
    expect(row.totalOwned).toBe(10);
  });

  it('does not multiply the loan by the number of compartments the product sits in', async () => {
    // The loan figure is computed per product, so the query repeats it on every placement row.
    // Summing those rows instead of assigning would report 8 here rather than 4.
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentB, quantity: 5 },
      { performedBy: im.id, refType: 'TEST' },
    );
    await borrowAndIssue(4);

    const row = await productRow();
    expect(row.placements.length).toBe(2);
    expect(row.totalOnLoan).toBe(4);
    expect(row.totalOwned).toBe(15);
  });

  it('totals owned across the whole report, so the printed total is the real holding', async () => {
    await borrowAndIssue(4);
    const report = (await im.client.get('/reports/inventory')).body as InventoryReport;

    const summedOwned = report.rows.reduce((sum, row) => sum + row.totalOwned, 0);
    const summedOnLoan = report.rows.reduce((sum, row) => sum + row.totalOnLoan, 0);

    expect(report.totals.totalOwned).toBe(summedOwned);
    expect(report.totals.totalOnLoan).toBe(summedOnLoan);
    expect(report.totals.totalOwned).toBe(report.totals.totalQuantity + report.totals.totalOnLoan);
  });

  it('gives the borrowed stock its own line in the CSV, with no compartment', async () => {
    await borrowAndIssue(4);
    const csv = (await im.client.get('/reports/inventory/export.csv')).text as string;

    const lines = csv.split('\n');
    expect(lines[0]).toContain('Holding');

    const loanLine = lines.find((line) => line.includes('On loan'));
    expect(loanLine).toBeDefined();
    // Quantity 4, and nothing available from it: it is not on a shelf to be handed over.
    expect(loanLine).toContain(',On loan,,,4,0,0,0,');
  });
});
