import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type RequisitionFunding } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createDepartment, createUser, login, resetData, seedSubthresholdApprover } from './factories';

/**
 * Phase 05 task 5.4 — the money half of the lifecycle.
 *
 * The rules this file defends are the ones that would quietly corrupt the books rather than
 * crash: a step applied out of order, funding that exceeds what was approved, a total that
 * disagrees with the receipts behind it, and two IMs recording at the same instant.
 */
describe('funds and purchasing', () => {
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

  /* ------------------------------------------------------- the happy path */

  it('walks BOM_GENERATED → SENT_TO_ACCOUNTS → FUNDS_RECEIVED → PURCHASED', async () => {
    const req = await requisitionOnBom(5000);

    const sent = await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();
    expect(sent.status).toBe(200);
    expect(await statusOf(req.id)).toBe('SENT_TO_ACCOUNTS');

    const funded = await im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
      amount: 5000,
      receivedAt: new Date().toISOString(),
      reference: 'CHQ-001',
      note: null,
    });
    expect(funded.status).toBe(201);
    expect((funded.body as RequisitionFunding).funded).toBe(5000);
    expect((funded.body as RequisitionFunding).outstanding).toBe(0);
    expect((funded.body as RequisitionFunding).isFullyFunded).toBe(true);
    expect(await statusOf(req.id)).toBe('FUNDS_RECEIVED');

    const purchased = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Techshop BD',
      invoiceNo: 'INV-77',
      purchasedAt: new Date().toISOString(),
      note: null,
      lines: [{ requisitionItemId: req.itemId, quantity: 1, unitCost: 4800 }],
    });
    expect(purchased.status).toBe(201);
    const funding = purchased.body as RequisitionFunding;
    expect(funding.spent).toBe(4800);
    expect(funding.purchases).toHaveLength(1);
    expect(funding.purchases[0]!.lines[0]!.itemName).toBeTruthy();
    expect(await statusOf(req.id)).toBe('PURCHASED');
  });

  /* ------------------------------------------------------ partial funding */

  it('reports partial funding honestly rather than as complete', async () => {
    const req = await requisitionOnBom(5000);
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();

    const first = await im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
      amount: 2000,
      receivedAt: new Date().toISOString(),
    });
    expect(first.status).toBe(201);

    const partial = first.body as RequisitionFunding;
    expect(partial.funded).toBe(2000);
    expect(partial.outstanding).toBe(3000);
    expect(partial.isFullyFunded).toBe(false);
    expect(await statusOf(req.id)).toBe('FUNDS_PARTIAL');

    const second = await im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
      amount: 3000,
      receivedAt: new Date().toISOString(),
    });
    expect((second.body as RequisitionFunding).outstanding).toBe(0);
    expect(await statusOf(req.id)).toBe('FUNDS_RECEIVED');
    // Both instalments are kept — the total is derived, so the history stays legible.
    expect((second.body as RequisitionFunding).receipts).toHaveLength(2);
  });

  it('refuses funding beyond the approved amount instead of clamping it', async () => {
    const req = await requisitionOnBom(5000);
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();

    const tooMuch = await im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
      amount: 5001,
      receivedAt: new Date().toISOString(),
    });

    expect(tooMuch.status).toBe(409);
    // Nothing was written: a refused receipt must not leave a partial trace.
    expect((await fundingOf(req.id)).funded).toBe(0);
    expect(await statusOf(req.id)).toBe('SENT_TO_ACCOUNTS');
  });

  /* ------------------------------------------------------- the transitions */

  it('refuses each step taken out of order, naming the current state', async () => {
    const req = await requisitionOnBom(5000);

    // Funding before it has gone to Accounts.
    const early = await im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
      amount: 100,
      receivedAt: new Date().toISOString(),
    });
    expect(early.status).toBe(409);
    expect(early.body.message).toContain('BOM_GENERATED');

    // Purchasing before any money arrived.
    const noMoney = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Techshop BD',
      purchasedAt: new Date().toISOString(),
      lines: [{ requisitionItemId: req.itemId, quantity: 1, unitCost: 10 }],
    });
    expect(noMoney.status).toBe(409);

    // Sending to Accounts twice.
    expect((await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send()).status).toBe(200);
    const twice = await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();
    expect(twice.status).toBe(409);
    expect(twice.body.message).toContain('SENT_TO_ACCOUNTS');
  });

  /* ------------------------------------------------------------ integrity */

  it('refuses a purchase line belonging to another requisition', async () => {
    const mine = await requisitionOnBom(5000);
    const theirs = await requisitionOnBom(5000);

    await im.client.post(`/requisitions/${mine.id}/send-to-accounts`).send();
    await im.client
      .post(`/requisitions/${mine.id}/fund-receipts`)
      .send({ amount: 5000, receivedAt: new Date().toISOString() });

    const crossed = await im.client.post(`/requisitions/${mine.id}/purchases`).send({
      vendor: 'Techshop BD',
      purchasedAt: new Date().toISOString(),
      // Somebody else's item id.
      lines: [{ requisitionItemId: theirs.itemId, quantity: 1, unitCost: 100 }],
    });

    expect(crossed.status).toBe(400);
    expect((await fundingOf(mine.id)).purchases).toHaveLength(0);
  });

  it('rejects an over-BOM quantity with no stated reason', async () => {
    const req = await readyToPurchase(5000);

    const noReason = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Techshop BD',
      purchasedAt: new Date().toISOString(),
      lines: [
        { requisitionItemId: req.itemId, quantity: 2, unitCost: 100, overBomQuantity: true },
      ],
    });
    expect(noReason.status).toBe(400);

    const withReason = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Techshop BD',
      purchasedAt: new Date().toISOString(),
      lines: [
        {
          requisitionItemId: req.itemId,
          quantity: 2,
          unitCost: 100,
          overBomQuantity: true,
          overBomNote: 'Vendor only sells in pairs',
        },
      ],
    });
    expect(withReason.status).toBe(201);
  });

  it('keeps money exact to two decimals', async () => {
    const req = await requisitionOnBom(5000);
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();

    // Three decimals is a rounding bug waiting to happen against numeric(14,2).
    const tooPrecise = await im.client
      .post(`/requisitions/${req.id}/fund-receipts`)
      .send({ amount: 100.005, receivedAt: new Date().toISOString() });
    expect(tooPrecise.status).toBe(400);

    for (const amount of [1000.55, 2000.45]) {
      const ok = await im.client
        .post(`/requisitions/${req.id}/fund-receipts`)
        .send({ amount, receivedAt: new Date().toISOString() });
      expect(ok.status).toBe(201);
    }
    // 1000.55 + 2000.45 is exactly 3001.00 — summed in pg, so no float drift.
    expect((await fundingOf(req.id)).funded).toBe(3001);
  });

  /* ---------------------------------------------------------- concurrency */

  it('does not let two simultaneous receipts push funding past the approved amount', async () => {
    const req = await requisitionOnBom(5000);
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();

    // Both would fit alone; together they exceed 5000. The row lock has to serialise them.
    const body = { amount: 3000, receivedAt: new Date().toISOString() };
    const [a, b] = await Promise.all([
      im.client.post(`/requisitions/${req.id}/fund-receipts`).send(body),
      im.client.post(`/requisitions/${req.id}/fund-receipts`).send(body),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect((await fundingOf(req.id)).funded).toBe(3000);
  });

  /* -------------------------------------------------------- authorization */

  it('lets only the IM or an Admin move the money steps', async () => {
    const req = await requisitionOnBom(5000);

    expect((await requester.client.post(`/requisitions/${req.id}/send-to-accounts`).send()).status).toBe(403);
    expect(
      (
        await approver.client
          .post(`/requisitions/${req.id}/fund-receipts`)
          .send({ amount: 10, receivedAt: new Date().toISOString() })
      ).status,
    ).toBe(403);

    // The requester may still *read* where their own money has got to.
    expect((await requester.client.get(`/requisitions/${req.id}/funding`)).status).toBe(200);
  });

  /* ----------------------------------------------------------- the record */

  it('writes a tracker event and an audit row for every step', async () => {
    const req = await readyToPurchase(5000);
    await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Techshop BD',
      purchasedAt: new Date().toISOString(),
      lines: [{ requisitionItemId: req.itemId, quantity: 1, unitCost: 100 }],
    });

    const events = await ctx.db
      .selectFrom('requisition_events')
      .where('requisition_id', '=', req.id)
      .select('event_type')
      .execute();
    const types = events.map((row) => row.event_type);
    expect(types).toContain('SENT_TO_ACCOUNTS');
    expect(types).toContain('FUNDS_RECEIVED');
    expect(types).toContain('PURCHASED');

    const audits = await ctx.db
      .selectFrom('audit_log')
      .where('entity_id', '=', req.id)
      .select('action')
      .execute();
    const actions = audits.map((row) => row.action);
    expect(actions).toContain('requisition.sent_to_accounts');
    expect(actions).toContain('requisition.funds_received');
    expect(actions).toContain('requisition.purchased');
  });

  it('notifies the requester when funding completes, but not on each instalment', async () => {
    const req = await requisitionOnBom(5000);
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();

    await im.client
      .post(`/requisitions/${req.id}/fund-receipts`)
      .send({ amount: 2000, receivedAt: new Date().toISOString() });
    const afterPartial = await requester.client.get('/notifications');
    const partialTypes = afterPartial.body.items.map((n: { type: string }) => n.type);
    expect(partialTypes).not.toContain('requisition.funds_received');

    await im.client
      .post(`/requisitions/${req.id}/fund-receipts`)
      .send({ amount: 3000, receivedAt: new Date().toISOString() });
    const afterFull = await requester.client.get('/notifications');
    const fullTypes = afterFull.body.items.map((n: { type: string }) => n.type);
    expect(fullTypes).toContain('requisition.funds_received');
  });

  /* ----------------------------------------------------------- helpers */

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const user = await createUser(ctx.db, { roles });
    const client = httpClient(ctx.app);
    const session = await login(client, user.email);
    return { id: user.id, client: client.as(session.accessToken) };
  }

  async function statusOf(requisitionId: string): Promise<string> {
    const row = await ctx.db
      .selectFrom('requisitions')
      .where('id', '=', requisitionId)
      .select('status')
      .executeTakeFirstOrThrow();
    return row.status;
  }

  async function fundingOf(requisitionId: string): Promise<RequisitionFunding> {
    const response = await im.client.get(`/requisitions/${requisitionId}/funding`);
    expect(response.status).toBe(200);
    return response.body as RequisitionFunding;
  }

  /** Drives a requisition all the way to BOM_GENERATED, which is where this module takes over. */
  async function requisitionOnBom(amount: number): Promise<{ id: string; itemId: string }> {
    const created = await requester.client.post('/requisitions').send({
      departmentId,
      urgency: 'NORMAL',
      reason: 'Funds lifecycle test',
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: amount, productId: null, note: null },
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
    await approver.client
      .post(`/requisitions/approvals/${approverApprovalId}/decision`)
      .send({ approve: true });

    const detail = (await requester.client.get(`/requisitions/${id}`)).body;
    const itemId = detail.items[0].id as string;

    const bom = await im.client.post('/boms').send({
      requisitionIds: [id],
      lines: [{ requisitionItemId: itemId, unitCost: amount, vendor: 'Techshop BD' }],
    });
    expect(bom.status).toBe(201);

    return { id, itemId };
  }

  /** ...and on to FUNDS_RECEIVED, for tests whose subject is the purchase step. */
  async function readyToPurchase(amount: number): Promise<{ id: string; itemId: string }> {
    const req = await requisitionOnBom(amount);
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();
    await im.client
      .post(`/requisitions/${req.id}/fund-receipts`)
      .send({ amount, receivedAt: new Date().toISOString() });
    return req;
  }
});
