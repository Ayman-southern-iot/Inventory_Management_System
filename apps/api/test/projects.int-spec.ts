import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BorrowStatus, ErrorCode, ProjectUsage, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { createStockFixture, ledgerRows } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * The Project Hub, which is entirely derived: `borrow_requests` already carries `project_id`,
 * `quantity`, `returned_qty` and `status`, so there is no project-items table to drift out of
 * step with the borrow it describes.
 *
 * The assertion that matters most is in the detach test: removing an item from a project must
 * leave both the borrow row and the stock ledger exactly as they were, because the borrow is
 * what makes `SUM(ledger) == SUM(placements)` hold.
 */
describe('projects hub', () => {
  let ctx: TestApp;
  let stock: StockService;
  let im: { id: string; client: HttpClient };
  let general: { id: string; client: HttpClient };

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);
    await resetData(ctx.db);

    const imUser = await createUser(ctx.db, { roles: [Role.GENERAL, Role.INVENTORY_MANAGER] });
    const imHttp = httpClient(ctx.app);
    const imSession = await login(imHttp, imUser.email);
    im = { id: imUser.id, client: imHttp.as(imSession.accessToken) };

    const generalUser = await createUser(ctx.db, { roles: [Role.GENERAL] });
    const generalHttp = httpClient(ctx.app);
    const generalSession = await login(generalHttp, generalUser.email);
    general = { id: generalUser.id, client: generalHttp.as(generalSession.accessToken) };
  });

  afterAll(async () => {
    await ctx.close();
  });

  interface TestBorrow {
    id: string;
    borrowNo: string;
    productId: string;
    compartmentId: string;
  }

  /**
   * A borrow of its own freshly created product, raised by the general user against `projectId`.
   *
   * One product per borrow, exactly as `stock-factories` intends: placements are never wiped
   * between tests, so a shared product would make the ledger assertions read another test's
   * history.
   */
  const createPendingBorrow = async (projectId: string, quantity: number): Promise<TestBorrow> => {
    const fixture = await createStockFixture(ctx.db);
    // Through StockService, like every other spec — nothing here writes a placement itself.
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity },
      { performedBy: im.id, refType: 'TEST' },
    );

    const created = await general.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity,
      projectId,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Project hub fixture',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe(BorrowStatus.PENDING);

    return {
      id: created.body.id,
      borrowNo: created.body.borrowNo,
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
    };
  };

  /** The same, then approved by the IM — which is what issues the stock. */
  const createIssuedBorrow = async (projectId: string, quantity: number): Promise<TestBorrow> => {
    const borrow = await createPendingBorrow(projectId, quantity);
    const decided = await im.client
      .post(`/borrowing/${borrow.id}/decision`)
      .send({ approve: true, note: 'ok' });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(decided.body.status).toBe(BorrowStatus.ISSUED);
    return borrow;
  };

  const returnUnits = async (borrow: TestBorrow, quantity: number) => {
    const response = await im.client
      .post(`/borrowing/${borrow.id}/returns`)
      .send({ quantity, compartmentId: borrow.compartmentId, condition: 'GOOD' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response;
  };

  const countLedgerRows = async (productId: string): Promise<number> =>
    (await ledgerRows(ctx.db, productId)).length;

  const itemsOf = async (projectId: string, query = '') =>
    general.client.get(`/projects/${projectId}/items${query}`);

  const borrowIdsIn = (body: { items: { borrowRequestId: string }[] }): string[] =>
    body.items.map((item) => item.borrowRequestId);

  it('lists a project and derives IN_USE for an issued borrow', async () => {
    const project = await general.client.post('/projects').send({ name: `Hub ${Date.now()}` });
    expect(project.status, JSON.stringify(project.body)).toBe(201);

    // Borrow 5, issue them, return 2 -> PARTIALLY_RETURNED, still IN_USE with 3 outstanding.
    const borrow = await createIssuedBorrow(project.body.id, 5);
    await returnUnits(borrow, 2);

    const items = await itemsOf(project.body.id);
    expect(items.status).toBe(200);
    const row = items.body.items.find(
      (item: { borrowRequestId: string }) => item.borrowRequestId === borrow.id,
    );
    expect(row).toMatchObject({
      usage: ProjectUsage.IN_USE,
      quantity: 5,
      returnedQty: 2,
      outstandingQty: 3,
      borrowNo: borrow.borrowNo,
      productId: borrow.productId,
    });
    expect(typeof items.body.total).toBe('number');

    // The detail header counts the same derivation.
    const detail = await general.client.get(`/projects/${project.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: project.body.id, inUseCount: 1, returnedCount: 0 });

    // And the project itself is listed.
    const list = await general.client.get('/projects?limit=100');
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toContain(project.body.id);
  });

  it('excludes a pending borrow, because it has not reached the project (OQ-23)', async () => {
    const project = await general.client.post('/projects').send({ name: `Pending ${Date.now()}` });
    const pending = await createPendingBorrow(project.body.id, 1);

    const items = await itemsOf(project.body.id);
    expect(items.status).toBe(200);
    expect(borrowIdsIn(items.body)).not.toContain(pending.id);
    expect(items.body.total).toBe(0);
  });

  it('filters to RETURNED only', async () => {
    const project = await general.client.post('/projects').send({ name: `Filter ${Date.now()}` });
    const open = await createIssuedBorrow(project.body.id, 1);
    const closed = await createIssuedBorrow(project.body.id, 1);
    await returnUnits(closed, 1);

    const returned = await itemsOf(project.body.id, `?usage=${ProjectUsage.RETURNED}`);
    expect(returned.status).toBe(200);
    expect(borrowIdsIn(returned.body)).toContain(closed.id);
    expect(borrowIdsIn(returned.body)).not.toContain(open.id);

    const inUse = await itemsOf(project.body.id, `?usage=${ProjectUsage.IN_USE}`);
    expect(borrowIdsIn(inUse.body)).toContain(open.id);
    expect(borrowIdsIn(inUse.body)).not.toContain(closed.id);

    // Unfiltered shows both, so the filter is narrowing rather than the data being missing.
    const both = await itemsOf(project.body.id);
    expect(borrowIdsIn(both.body)).toEqual(expect.arrayContaining([open.id, closed.id]));
  });

  it('refuses detach to a general user and allows it to the IM, without touching stock', async () => {
    const project = await general.client.post('/projects').send({ name: `Detach ${Date.now()}` });
    const borrow = await createIssuedBorrow(project.body.id, 1);

    const ledgerBefore = await countLedgerRows(borrow.productId);

    expect(
      (await general.client.delete(`/projects/${project.body.id}/items/${borrow.id}`)).status,
    ).toBe(403);
    expect((await im.client.delete(`/projects/${project.body.id}/items/${borrow.id}`)).status).toBe(
      204,
    );

    // Gone from the project...
    const items = await itemsOf(project.body.id);
    expect(borrowIdsIn(items.body)).not.toContain(borrow.id);

    // ...but still a borrow, with its status and its stock history untouched.
    const log = await im.client.get(`/borrowing?search=${borrow.borrowNo}`);
    const logged = log.body.items.find((row: { id: string }) => row.id === borrow.id);
    expect(logged).toMatchObject({
      status: BorrowStatus.ISSUED,
      outstandingQty: 1,
      projectId: null,
    });
    expect(await countLedgerRows(borrow.productId)).toBe(ledgerBefore);
    expect(await stock.findReconciliationMismatches()).toEqual([]);

    // Who removed it is recorded — the only trace an item leaving a project leaves behind.
    const audit = await ctx.db
      .selectFrom('audit_log')
      .select(['actor_id', 'metadata'])
      .where('action', '=', 'project.item.detach')
      .where('entity_id', '=', project.body.id)
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_id: im.id,
      metadata: { borrowRequestId: borrow.id },
    });
  });

  it('404s when the borrow belongs to a different project', async () => {
    const a = await general.client.post('/projects').send({ name: `A ${Date.now()}` });
    const b = await general.client.post('/projects').send({ name: `B ${Date.now()}` });
    const borrow = await createIssuedBorrow(a.body.id, 1);

    expect((await im.client.delete(`/projects/${b.body.id}/items/${borrow.id}`)).status).toBe(404);

    // Still attached to A.
    const items = await itemsOf(a.body.id);
    expect(borrowIdsIn(items.body)).toContain(borrow.id);
  });

  it('404s for a project that does not exist', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await general.client.get(`/projects/${missing}`)).status).toBe(404);
    expect((await general.client.get(`/projects/${missing}/items`)).status).toBe(404);
  });

  describe('project creation moved off /borrowing (task 2.1 behaviour, new route)', () => {
    it('warns on a duplicate name but lets the user proceed deliberately', async () => {
      const name = `Falcon ${Date.now()}`;
      const first = await general.client.post('/projects').send({ name });
      expect(first.status).toBe(201);

      // Case-insensitive: "falcon" is the same project to a human.
      const warned = await general.client.post('/projects').send({ name: name.toLowerCase() });
      expect(warned.status).toBe(409);
      expect(warned.body.code).toBe(ErrorCode.DUPLICATE_PROJECT_NAME);

      const forced = await general.client
        .post('/projects')
        .send({ name: name.toLowerCase(), allowDuplicateName: true });
      expect(forced.status).toBe(201);
    });
  });
});
