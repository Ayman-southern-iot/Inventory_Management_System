import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type ExpenseReport } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createDepartment, createUser, login, resetData, seedSubthresholdApprover , futureDeadline} from './factories';

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
    expect(bucket.netCash).toBe(6_500);

    // The totals are the sum of the rows, not a second query that could disagree with them.
    expect(report.totals.requested).toBe(bucket.requested);
    expect(report.totals.netCash).toBe(bucket.netCash);
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
    expect(bucket.netCash).toBe(9_000);
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

  /**
   * Department is optional (D-006) and REQ-000003 was submitted without one, so the department
   * breakdown has to account for money nobody assigned. The page's own subtitle promises
   * "Figures always reconcile", and a row silently missing from the breakdown is how that
   * promise breaks — quietly, in the view most likely to reach a budget conversation.
   *
   * Asserted as a delta plus an invariant rather than absolute figures: `resetData` leaves
   * requisitions behind on purpose (`requisition_events` is append-only), so the unscoped
   * report legitimately carries other specs' rows. The delta is mine; the reconciliation is
   * everyone's.
   */
  it('keeps a requisition with no department in the breakdown, and the buckets still reconcile', async () => {
    const sumOf = (report: ExpenseReport, field: 'approved' | 'requested') =>
      report.buckets.reduce((total, bucket) => total + bucket[field], 0);
    const noDepartmentBucket = (report: ExpenseReport) =>
      report.buckets.find((bucket) => bucket.label === 'No department');

    const before = await departmentReport();
    const approvedBefore = noDepartmentBucket(before)?.approved ?? 0;

    await approvedWithoutDepartment(3_000);

    const after = await departmentReport();
    const bucket = noDepartmentBucket(after);

    // It is in the breakdown at all — labelled, not dropped and not keyed by a bare null.
    expect(bucket).toBeDefined();
    expect(bucket!.approved - approvedBefore).toBe(3_000);

    // The promise the page makes, on the grouping most likely to be read as an allocation.
    expect(sumOf(after, 'approved')).toBe(after.totals.approved);
    expect(sumOf(after, 'requested')).toBe(after.totals.requested);
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
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Never submitted',
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: 9_000, productId: null, note: null },
      ],
    });

    expect((await fetchReport()).totals.requisitionCount).toBe(0);
  });

  /**
   * D-020. `approved_amount` is written at submit (it seeds the BOM with a figure to print) and
   * only send-back nulls it, so a rejected or still-undecided requisition carried a full
   * "approved" figure into a report Accounts reads as spendable money. Requested legitimately
   * covers everything submitted; Approved must not. Ruling 2026-08-23: *currently* approved.
   */
  it('counts only a standing approval as Approved, while Requested still covers everything submitted', async () => {
    await rejectedAtIm({ requested: 5_000 });
    await awaitingDecision({ requested: 3_000 });
    await verifiable({ requested: 10_000, approved: 8_000 });

    const report = await fetchReport();

    expect(report.totals.requisitionCount).toBe(3);
    expect(report.totals.requested).toBe(18_000);
    expect(report.totals.approved).toBe(8_000);
  });

  it('is visible to approvers, IMs and admin, but not to a plain user', async () => {
    expect((await im.client.get('/reports/expenses')).status).toBe(200);
    expect((await approver.client.get('/reports/expenses')).status).toBe(200);

    const admin = await signIn([Role.GENERAL, Role.ADMIN]);
    expect((await admin.client.get('/reports/expenses')).status).toBe(200);

    // A requester has no business browsing every department's spend.
    expect((await requester.client.get('/reports/expenses')).status).toBe(403);
  });

  describe('export', () => {
    /** Parses the small subset of CSV we emit — fields never contain a comma or quote, so a
     *  bare split is enough. Money figures come back as numbers in the second column onwards. */
    function parseCsv(body: string): string[][] {
      return body
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => line.split(','));
    }

    it('exports CSV whose totals match the JSON endpoint', async () => {
      await fullyProcessed({ requested: 10_000, approved: 8_000, spend: 6_500, giveBack: 1_500 });

      const json = await fetchReport();
      const csvResponse = await im.client
        .get(`/reports/expenses/export.csv?departmentId=${departmentId}`)
        // `buffer(true)` makes supertest give us the raw bytes instead of parsing the body as JSON
        // — we need a string for the parser, not an object graph.
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks).toString('utf-8')));
        });
      expect(csvResponse.status).toBe(200);
      expect(csvResponse.headers['content-type']).toMatch(/^text\/csv/);
      expect(csvResponse.headers['content-disposition']).toMatch(/^attachment; filename=/);

      const rows = parseCsv(csvResponse.body as string);
      // header + 1 data row + totals
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual([
        'Bucket',
        'Requisitions',
        'Requested',
        'Approved',
        'Funded',
        'Spent',
        'Returned',
        'Net cash',
      ]);
      // The data row agrees with the JSON bucket (last column is `netCash`).
      expect(Number(rows[1]![1])).toBe(json.buckets[0]!.requisitionCount);
      expect(Number(rows[1]![5])).toBeCloseTo(json.buckets[0]!.spent, 2);
      expect(Number(rows[1]![7])).toBeCloseTo(json.buckets[0]!.netCash, 2);
      // Totals row == bucket row here because there is only one bucket, and equals the JSON totals.
      expect(Number(rows[2]![5])).toBeCloseTo(json.totals.spent, 2);
      expect(Number(rows[2]![7])).toBeCloseTo(json.totals.netCash, 2);
    });

    it('CSV export honours the date filter', async () => {
      await fullyProcessed({ requested: 5_000, approved: 5_000, spend: 4_000, giveBack: 0 });

      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(tomorrow);

      const raw = (signer: HttpClient, qs: string) =>
        signer
          .get(`/reports/expenses/export.csv?${qs}`)
          .buffer(true)
          .parse((res, callback) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => callback(null, Buffer.concat(chunks).toString('utf-8')));
          });

      // A range well outside the fixture window must come back empty.
      const empty = await raw(im.client, `departmentId=${departmentId}&from=2020-01-01&to=2020-12-31`);
      const emptyRows = parseCsv(empty.body as string);
      // header + totals row only, no data rows.
      expect(emptyRows).toHaveLength(2);
      expect(emptyRows[1]![0]).toBe('Total');

      // Today's range includes the fixture.
      const inRange = await raw(im.client, `departmentId=${departmentId}&from=${today}&to=${tomorrowStr}`);
      expect(parseCsv(inRange.body as string)).toHaveLength(3);
    });

    it('exports PDF with the right content type and PDF magic bytes', async () => {
      await fullyProcessed({ requested: 5_000, approved: 5_000, spend: 4_000, giveBack: 0 });

      const response = await im.client.get(
        `/reports/expenses/export.pdf?departmentId=${departmentId}`,
      );
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename=/);
      // supertest parses binary bodies as Buffer when `body` is requested without an override.
      const body = response.body as Buffer;
      expect(body.length).toBeGreaterThan(100);
      expect(body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('denies CSV/PDF export to a plain user', async () => {
      const csv = await requester.client.get('/reports/expenses/export.csv');
      const pdf = await requester.client.get('/reports/expenses/export.pdf');
      expect(csv.status).toBe(403);
      expect(pdf.status).toBe(403);
    });
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

  /** Unscoped, because a department-less requisition cannot be reached by ?departmentId=. */
  async function departmentReport(): Promise<ExpenseReport> {
    const response = await im.client.get('/reports/expenses?groupBy=department');
    expect(response.status).toBe(200);
    return response.body as ExpenseReport;
  }

  /**
   * Taken to APPROVED — a standing approval — carrying no department.
   *
   * D-006 (Ayman's ruling, 2026-08-26) made department mandatory at submit, so this state can no
   * longer be created through the API. It has not stopped existing: every requisition submitted
   * before the rule can still have a null department, and the report must keep labelling those
   * rather than dropping them or keying a bucket on a bare null. So the row is submitted with a
   * department and then cleared, which is precisely what a legacy row looks like.
   *
   * The assertions in the test are untouched. Only the way the state is reached has changed,
   * because the old way is now a 409.
   */
  async function approvedWithoutDepartment(requested: number): Promise<string> {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'No department on purpose (D-006)',
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: requested, productId: null, note: null },
      ],
    });
    expect(created.status).toBe(201);
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
    const decided = await approver.client
      .post(`/requisitions/approvals/${approverApprovalId}/decision`)
      .send({ approve: true });
    expect(decided.status).toBe(200);

    // Now make it the legacy row this helper is named for.
    await ctx.db
      .updateTable('requisitions')
      .set({ department_id: null })
      .where('id', '=', id)
      .execute();

    return id;
  }

  /** Submitted and nothing more — the IM has not looked at it yet. */
  async function awaitingDecision(input: { requested: number }): Promise<string> {
    const id = await draft(input.requested, 'Awaiting a decision');
    await requester.client.post(`/requisitions/${id}/submit`).send();
    return id;
  }

  /** Submitted and killed at the IM stage — requirements §4: either rejection kills the request. */
  async function rejectedAtIm(input: { requested: number }): Promise<string> {
    const id = await draft(input.requested, 'Rejected fixture');
    const submitted = (await requester.client.post(`/requisitions/${id}/submit`).send()).body;
    const imApprovalId = submitted.approvals.find(
      (a: { stage: string }) => a.stage === 'INVENTORY_MANAGER',
    ).id;
    const decided = await im.client
      .post(`/requisitions/approvals/${imApprovalId}/decision`)
      .send({ approve: false, note: 'we already have these' });
    expect(decided.status).toBe(200);
    return id;
  }

  async function draft(requested: number, reason: string): Promise<string> {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason,
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: requested, productId: null, note: null },
      ],
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  /** A requisition taken to FUNDS_RECEIVED, ready for purchases. */
  async function verifiable(input: {
    requested: number;
    approved: number;
  }): Promise<{ id: string; itemId: string }> {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
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
