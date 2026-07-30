import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type ExpenseReport } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createDepartment, createUser, login, resetData, seedSubthresholdApprover } from './factories';

/**
 * Phase 05 task 5.8 — the expense report.
 *
 * The failure this file is built around is not a crash. It is a report that looks plausible and
 * is wrong: joining a requisition to three one-to-many money tables at once multiplies the rows
 * and inflates every figure by the size of the other two. So the tests assert the numbers against
 * hand-known fixtures, and assert that the totals equal the sum of the rows.
 */
describe('expense report', () => {
  let ctx: TestApp;
  let im: { id: string; client: HttpClient };
  let requester: { id: string; client: HttpClient };
  let approver: { id: string; client: HttpClient };
  let departmentId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    im = await signIn([Role.GENERAL, Role.INVENTORY_MANAGER]);
    requester = await signIn([Role.GENERAL]);
    approver = await signIn([Role.GENERAL, Role.APPROVER]);
    departmentId = (await createDepartment(ctx.db)).id;
    await seedSubthresholdApprover(ctx, approver.id);
  });

  it('reports the six figures, and they reconcile against the rows', async () => {
    // 10,000 requested, approved at 8,000, funded 8,000, spent 6,500, 1,500 returned.
    await fullyProcessed({ requested: 10_000, approved: 8_000, spend: 6_500, giveBack: 1_500 });

    const report = await fetchReport();
    expect(report.buckets).toHaveLength(1);

    const bucket = report.buckets[0]!;
    expect(bucket.requisitionCount).toBe(1);
    expect(bucket.requested).toBe(10_000);
    expect(bucket.approved).toBe(8_000);
    expect(bucket.funded).toBe(8_000);
    expect(bucket.spent).toBe(6_500);
    expect(bucket.returned).toBe(1_500);
    // What the organisation is actually out of pocket.
    expect(bucket.netFunded).toBe(6_500);

    // The totals are the sum of the rows, not a second query that could disagree with them.
    expect(report.totals.requested).toBe(bucket.requested);
    expect(report.totals.netFunded).toBe(bucket.netFunded);
  });

  /**
   * The fan-out guard. Two receipts, two purchases and a return on ONE requisition: a naive join
   * would multiply them together and report four times the money.
   */
  it('does not inflate figures when a requisition has several receipts and purchases', async () => {
    const req = await verifiable({ requested: 10_000, approved: 10_000 });

    // Two instalments totalling 10,000.
    await recordReceipt(req.id, 4_000);
    await recordReceipt(req.id, 6_000);
    // Two purchases totalling 7,000.
    await recordPurchase(req.id, req.itemId, 3_000);
    await recordPurchase(req.id, req.itemId, 4_000);
    await attachInvoices(req.id);
    await im.client
      .post(`/requisitions/${req.id}/verify-purchase`)
      .send({ returnedAmount: 1_000, returnNote: 'Under budget' });

    const bucket = (await fetchReport()).buckets[0]!;
    expect(bucket.requisitionCount).toBe(1);
    // Each figure counted once, not multiplied by the row counts of the other tables.
    expect(bucket.funded).toBe(10_000);
    expect(bucket.spent).toBe(7_000);
    expect(bucket.returned).toBe(1_000);
    expect(bucket.netFunded).toBe(9_000);
  });

  it('sums several requisitions into one bucket', async () => {
    await fullyProcessed({ requested: 5_000, approved: 5_000, spend: 4_000, giveBack: 0 });
    await fullyProcessed({ requested: 3_000, approved: 3_000, spend: 3_000, giveBack: 0 });

    const bucket = (await fetchReport()).buckets[0]!;
    expect(bucket.requisitionCount).toBe(2);
    expect(bucket.requested).toBe(8_000);
    expect(bucket.spent).toBe(7_000);
  });

  it('groups by department', async () => {
    await fullyProcessed({ requested: 5_000, approved: 5_000, spend: 4_000, giveBack: 0 });

    const response = await im.client.get(`/reports/expenses?groupBy=department&departmentId=${departmentId}`);
    expect(response.status).toBe(200);
    const report = response.body as ExpenseReport;

    expect(report.groupBy).toBe('department');
    expect(report.buckets).toHaveLength(1);
    // Labelled with the department's name, not its id.
    expect(report.buckets[0]!.label).not.toMatch(/^[0-9a-f-]{36}$/);
    expect(report.buckets[0]!.spent).toBe(4_000);
  });

  it('honours the date range, inclusive of the closing day', async () => {
    await fullyProcessed({ requested: 5_000, approved: 5_000, spend: 4_000, giveBack: 0 });

    // "Today" in the *reporting* zone, not UTC. At +06 a Dhaka morning is still the previous
    // UTC day, so `toISOString().slice(0,10)` would ask for the wrong date and find nothing —
    // which is the exact confusion this feature exists to remove.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
    const inRange = await im.client.get(`/reports/expenses?departmentId=${departmentId}&from=${today}&to=${today}`);
    // Everything happened today, so a single-day range that starts and ends today must find it.
    expect((inRange.body as ExpenseReport).totals.requisitionCount).toBe(1);

    const past = await im.client.get(`/reports/expenses?departmentId=${departmentId}&from=2020-01-01&to=2020-12-31`);
    expect((past.body as ExpenseReport).totals.requisitionCount).toBe(0);
    expect((past.body as ExpenseReport).buckets).toHaveLength(0);
  });

  it('rejects a range that ends before it starts', async () => {
    const backwards = await im.client.get('/reports/expenses?from=2026-07-31&to=2026-07-01');
    expect(backwards.status).toBe(400);
  });

  it('counts only submitted requisitions', async () => {
    // A draft has no submitted_at, so it cannot belong to any month.
    await requester.client.post('/requisitions').send({
      departmentId,
      urgency: 'NORMAL',
      reason: 'Never submitted',
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: 9_000, productId: null, note: null },
      ],
    });

    expect((await fetchReport()).totals.requisitionCount).toBe(0);
  });

  it('is visible to approvers, IMs and admin, but not to a plain user', async () => {
    expect((await im.client.get('/reports/expenses')).status).toBe(200);
    expect((await approver.client.get('/reports/expenses')).status).toBe(200);

    const admin = await signIn([Role.GENERAL, Role.ADMIN]);
    expect((await admin.client.get('/reports/expenses')).status).toBe(200);

    // A requester has no business browsing every department's spend.
    expect((await requester.client.get('/reports/expenses')).status).toBe(403);
  });

  /* ----------------------------------------------------------- helpers */

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const user = await createUser(ctx.db, { roles });
    const client = httpClient(ctx.app);
    const session = await login(client, user.email);
    return { id: user.id, client: client.as(session.accessToken) };
  }

  /**
   * Scoped to this test's own department.
   *
   * `resetData` deliberately leaves requisitions in place — `requisition_events` is append-only,
   * so they cannot be deleted — which means the test database accumulates them across specs.
   * Filtering by the department each test creates is what makes the figures deterministic.
   */
  async function fetchReport(): Promise<ExpenseReport> {
    const response = await im.client.get(`/reports/expenses?departmentId=${departmentId}`);
    expect(response.status).toBe(200);
    return response.body as ExpenseReport;
  }

  const recordReceipt = (id: string, amount: number) =>
    im.client
      .post(`/requisitions/${id}/fund-receipts`)
      .send({ amount, receivedAt: new Date().toISOString() });

  const recordPurchase = (id: string, itemId: string, amount: number) =>
    im.client.post(`/requisitions/${id}/purchases`).send({
      vendor: 'Techshop BD',
      purchasedAt: new Date().toISOString(),
      lines: [{ requisitionItemId: itemId, quantity: 1, unitCost: amount }],
    });

  async function attachInvoices(id: string): Promise<void> {
    const funding = (await im.client.get(`/requisitions/${id}/funding`)).body;
    for (const purchase of funding.purchases as Array<{ id: string }>) {
      await im.client
        .post(`/requisitions/${id}/purchases/${purchase.id}/invoice`)
        .attach('file', Buffer.from('%PDF-1.4 invoice'), 'invoice.pdf');
    }
  }

  /** A requisition taken to FUNDS_RECEIVED, ready for purchases. */
  async function verifiable(input: {
    requested: number;
    approved: number;
  }): Promise<{ id: string; itemId: string }> {
    const created = await requester.client.post('/requisitions').send({
      departmentId,
      urgency: 'NORMAL',
      reason: 'Expense report fixture',
      items: [
        {
          itemName: 'Widget',
          quantity: 1,
          estimatedUnitPrice: input.requested,
          productId: null,
          note: null,
        },
      ],
    });
    const id = created.body.id as string;

    const submitted = (await requester.client.post(`/requisitions/${id}/submit`).send()).body;
    const imApprovalId = submitted.approvals.find(
      (a: { stage: string }) => a.stage === 'INVENTORY_MANAGER',
    ).id;
    const afterIm = (
      await im.client.post(`/requisitions/approvals/${imApprovalId}/decision`).send({ approve: true })
    ).body;
    const approverApprovalId = afterIm.approvals.find(
      (a: { stage: string }) => a.stage === 'APPROVER',
    ).id;
    await approver.client.post(`/requisitions/approvals/${approverApprovalId}/decision`).send({
      approve: true,
      // Revising down is what makes requested and approved differ in the report.
      ...(input.approved === input.requested ? {} : { approvedAmount: input.approved }),
    });

    const detail = (await requester.client.get(`/requisitions/${id}`)).body;
    const itemId = detail.items[0].id as string;

    await im.client.post('/boms').send({
      requisitionIds: [id],
      lines: [{ requisitionItemId: itemId, unitCost: input.approved, vendor: 'Techshop BD' }],
    });
    await im.client.post(`/requisitions/${id}/send-to-accounts`).send();

    return { id, itemId };
  }

  /** ...and all the way through funding, purchase, invoice, verification and any return. */
  async function fullyProcessed(input: {
    requested: number;
    approved: number;
    spend: number;
    giveBack: number;
  }): Promise<{ id: string; itemId: string }> {
    const req = await verifiable(input);
    await recordReceipt(req.id, input.approved);
    await recordPurchase(req.id, req.itemId, input.spend);
    await attachInvoices(req.id);
    await im.client.post(`/requisitions/${req.id}/verify-purchase`).send(
      input.giveBack > 0
        ? { returnedAmount: input.giveBack, returnNote: 'Came in under budget' }
        : {},
    );
    return req;
  }
});
