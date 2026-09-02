import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type PersonalRecord } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import {
  createDepartment,
  createUser,
  futureDeadline,
  login,
  resetData,
  seedSubthresholdApprover,
} from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * `GET /dashboard/me` — one person's own record.
 *
 * Ayman, 2026-08-26: "in dashboard there should be each person's all records — how many
 * requisitions made, how many accepted, how many rejected, how many items borrowed, how many
 * returns, how many damaged or not working, how much amount he spent in total (based on only
 * spent money)."
 *
 * The two things worth defending:
 *
 *  - **It is one person's figures, never anyone else's.** There is no user parameter, so the test
 *    that matters is that two people signed in at once see two different sets of numbers.
 *  - **"Spent" means purchases**, matching the Expenses report exactly. Requested and approved are
 *    different figures and it would be very easy to report one of those instead — nobody would
 *    notice until somebody compared two screens.
 */
describe('a person’s own record', () => {
  let ctx: TestApp;
  let im: { id: string; client: HttpClient };
  let alice: { id: string; client: HttpClient };
  let bob: { id: string; client: HttpClient };
  let approver: { id: string; client: HttpClient };
  let departmentId: string;
  let fixture: StockFixture;
  let stock: StockService;

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    im = await signIn([Role.GENERAL, Role.INVENTORY_MANAGER]);
    alice = await signIn([Role.GENERAL]);
    bob = await signIn([Role.GENERAL]);
    approver = await signIn([Role.GENERAL, Role.APPROVER]);
    departmentId = (await createDepartment(ctx.db)).id;
    fixture = await createStockFixture(ctx.db);
    await seedSubthresholdApprover(ctx, approver.id);
    // Nothing can be borrowed off an empty shelf, and only StockService may put it there.
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 20 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  /* ------------------------------------------------------------ requisitions */

  it('starts empty for somebody who has done nothing', async () => {
    const record = await recordFor(alice);

    expect(record.requisitions.raised).toBe(0);
    expect(record.borrowing.borrowed).toBe(0);
    expect(record.spend.spent).toBe(0);
  });

  it('counts a draft as a draft, and not as raised', async () => {
    await createDraft(alice, 1000);
    const record = await recordFor(alice);

    // A draft has not been put to anybody, so it is not something they "raised".
    expect(record.requisitions.drafts).toBe(1);
    expect(record.requisitions.raised).toBe(0);
    expect(record.requisitions.inFlight).toBe(0);
  });

  it('counts a submitted requisition as raised and in flight until it is decided', async () => {
    await submitted(alice, 1000);
    const record = await recordFor(alice);

    expect(record.requisitions.raised).toBe(1);
    expect(record.requisitions.inFlight).toBe(1);
    expect(record.requisitions.approved).toBe(0);
    expect(record.requisitions.rejected).toBe(0);
  });

  it('moves it from in flight to approved once the chain completes', async () => {
    await approved(alice, 1000);
    const record = await recordFor(alice);

    expect(record.requisitions.approved).toBe(1);
    expect(record.requisitions.inFlight).toBe(0);
  });

  it('counts a rejection as rejected, not as approved', async () => {
    const id = await submitted(alice, 1000);
    await decideAsIm(id, false);
    const record = await recordFor(alice);

    expect(record.requisitions.rejected).toBe(1);
    expect(record.requisitions.approved).toBe(0);
    expect(record.requisitions.inFlight).toBe(0);
    // Still raised: they did ask.
    expect(record.requisitions.raised).toBe(1);
  });

  /* --------------------------------------------------------------- isolation */

  /**
   * The test the "own figures only" ruling rests on. There is no user parameter on the endpoint,
   * so the only way this can go wrong is the query forgetting its `requester_id` filter — which
   * would show everyone the whole company's record and nobody would necessarily notice.
   */
  it('shows each person only their own requisitions', async () => {
    await approved(alice, 1000);
    await approved(alice, 2000);
    await approved(bob, 3000);

    expect((await recordFor(alice)).requisitions.approved).toBe(2);
    expect((await recordFor(bob)).requisitions.approved).toBe(1);
  });

  /* ------------------------------------------------------------------- money */

  /**
   * "Based on only spent money", verbatim. Requested and approved sit beside it precisely so
   * nobody has to guess which of the three this is — and so a mix-up shows up here.
   */
  it('counts spend as what was purchased, not what was requested or approved', async () => {
    const req = await purchasedRequisition(alice, 5000, 4200);
    expect(req).toBeTruthy();

    const record = await recordFor(alice);
    expect(record.spend.spent).toBe(4200);
    expect(record.spend.approved).toBe(5000);
    expect(record.spend.requested).toBe(5000);
  });

  it('drops a voided purchase out of the spend figure', async () => {
    await purchasedRequisition(alice, 5000, 4200);
    expect((await recordFor(alice)).spend.spent).toBe(4200);

    const requisitionId = await onlyRequisitionOf(alice.id);
    const funding = (await im.client.get(`/requisitions/${requisitionId}/funding`)).body;
    await im.client
      .post(`/requisitions/${requisitionId}/purchases/${funding.purchases[0].id}/void`)
      .send({ reason: 'Wrong vendor' });

    expect((await recordFor(alice)).spend.spent).toBe(0);
  });

  it('does not credit one person with another person’s spend', async () => {
    await purchasedRequisition(alice, 5000, 4200);

    expect((await recordFor(bob)).spend.spent).toBe(0);
  });

  /* --------------------------------------------------------------- borrowing */

  it('counts an issued borrow, and what came back damaged', async () => {
    const borrowId = await issuedBorrow(alice, 5);

    const beforeReturn = await recordFor(alice);
    expect(beforeReturn.borrowing.borrowed).toBe(1);
    expect(beforeReturn.borrowing.stillOut).toBe(1);
    expect(beforeReturn.borrowing.returned).toBe(0);

    // Three of the five come back broken. The condition counts are *units*, so this must read 3
    // and not 1 — a per-request count would hide two of them.
    await im.client.post(`/borrowing/${borrowId}/returns`).send({
      quantity: 3,
      compartmentId: fixture.compartmentA,
      condition: 'DAMAGED',
    });

    const partial = await recordFor(alice);
    expect(partial.borrowing.damagedUnits).toBe(3);
    expect(partial.borrowing.stillOut).toBe(1);
    expect(partial.borrowing.returned).toBe(0);

    await im.client.post(`/borrowing/${borrowId}/returns`).send({
      quantity: 2,
      compartmentId: fixture.compartmentA,
      condition: 'GOOD',
    });

    const done = await recordFor(alice);
    expect(done.borrowing.returned).toBe(1);
    expect(done.borrowing.stillOut).toBe(0);
    expect(done.borrowing.damagedUnits).toBe(3);
  });

  it('separates the three bad conditions rather than lumping them together', async () => {
    const borrowId = await issuedBorrow(alice, 3);

    for (const [quantity, condition] of [
      [1, 'PARTIALLY_DAMAGED_USABLE'],
      [1, 'DAMAGED'],
      [1, 'NOT_WORKING'],
    ] as const) {
      const response = await im.client.post(`/borrowing/${borrowId}/returns`).send({
        quantity,
        compartmentId: fixture.compartmentA,
        condition,
      });
      expect(response.status).toBe(200);
    }

    const record = await recordFor(alice);
    expect(record.borrowing.partiallyDamagedUnits).toBe(1);
    expect(record.borrowing.damagedUnits).toBe(1);
    expect(record.borrowing.notWorkingUnits).toBe(1);
  });

  it('shows each person only their own borrowing', async () => {
    await issuedBorrow(alice, 2);

    expect((await recordFor(bob)).borrowing.borrowed).toBe(0);
  });

  /* ------------------------------------------------------------------ access */

  it('is available to a plain General user, with no extra role', async () => {
    const response = await alice.client.get('/dashboard/me');
    expect(response.status).toBe(200);
  });

  it('refuses an unauthenticated caller', async () => {
    const anonymous = httpClient(ctx.app);
    const response = await anonymous.get('/dashboard/me');
    expect(response.status).toBe(401);
  });

  /* --------------------------------------------------------------- helpers */

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const user = await createUser(ctx.db, { roles });
    const client = httpClient(ctx.app);
    const session = await login(client, user.email);
    return { id: user.id, client: client.as(session.accessToken) };
  }

  async function recordFor(who: { client: HttpClient }): Promise<PersonalRecord> {
    const response = await who.client.get('/dashboard/me');
    expect(response.status).toBe(200);
    return response.body as PersonalRecord;
  }

  async function onlyRequisitionOf(userId: string): Promise<string> {
    const row = await ctx.db
      .selectFrom('requisitions')
      .where('requester_id', '=', userId)
      .select('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function createDraft(who: { client: HttpClient }, amount: number): Promise<string> {
    const created = await who.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Dashboard test',
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: amount, productId: null, note: null },
      ],
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  async function submitted(who: { client: HttpClient }, amount: number): Promise<string> {
    const id = await createDraft(who, amount);
    const response = await who.client.post(`/requisitions/${id}/submit`).send();
    expect(response.status).toBe(200);
    return id;
  }

  async function decideAsIm(requisitionId: string, approve: boolean): Promise<void> {
    const detail = (await im.client.get(`/requisitions/${requisitionId}`)).body;
    const approval = detail.approvals.find(
      (a: { stage: string }) => a.stage === 'INVENTORY_MANAGER',
    );
    const response = await im.client
      .post(`/requisitions/approvals/${approval.id}/decision`)
      // A rejection has to say why; an approval need not. Sent unconditionally because the
      // note is harmless on an approval and this helper serves both.
      .send({ approve, note: approve ? null : 'Not needed — the dashboard fixture rejects.' });
    expect(response.status).toBe(200);
  }

  async function approved(who: { client: HttpClient }, amount: number): Promise<string> {
    const id = await submitted(who, amount);
    await decideAsIm(id, true);
    const afterIm = (await im.client.get(`/requisitions/${id}`)).body;
    const approverApproval = afterIm.approvals.find(
      (a: { stage: string }) => a.stage === 'APPROVER',
    );
    await approver.client
      .post(`/requisitions/approvals/${approverApproval.id}/decision`)
      .send({ approve: true });
    return id;
  }

  /** Approved, BOM'd, funded and bought — the state the spend figure reads from. */
  async function purchasedRequisition(
    who: { client: HttpClient },
    amount: number,
    purchaseTotal: number,
  ): Promise<string> {
    const id = await approved(who, amount);
    const detail = (await who.client.get(`/requisitions/${id}`)).body;
    const itemId = detail.items[0].id as string;

    const bom = await im.client.post('/boms').send({
      requisitionIds: [id],
      lines: [{ requisitionItemId: itemId, unitCost: amount, vendor: 'Techshop BD' }],
    });
    expect(bom.status).toBe(201);

    await im.client.post(`/requisitions/${id}/send-to-accounts`).send();
    await im.client
      .post(`/requisitions/${id}/fund-receipts`)
      .send({ amount, receivedAt: new Date().toISOString() });
    const purchase = await im.client.post(`/requisitions/${id}/purchases`).send({
      vendor: 'Techshop BD',
      invoiceNo: 'INV-1',
      purchasedAt: new Date().toISOString(),
      note: null,
      lines: [{ requisitionItemId: itemId, quantity: 1, unitCost: purchaseTotal }],
    });
    expect(purchase.status).toBe(201);
    return id;
  }

  /** A borrow request approved and issued, so the units are actually out. */
  async function issuedBorrow(who: { id: string; client: HttpClient }, quantity: number) {
    const created = await who.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity,
      projectId: null,
      isReturnable: true,
      expectedReturnDate: futureDeadline().slice(0, 10),
      // futureDeadline() is an ISO instant since migration 0027; this field is still a day.
      purpose: 'Dashboard test',
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // Approving *is* issuing — the units leave the shelf in the same call, so there is no
    // separate issue step to make.
    const decided = await im.client.post(`/borrowing/${id}/decision`).send({ approve: true });
    expect(decided.status).toBe(200);
    return id;
  }
});
