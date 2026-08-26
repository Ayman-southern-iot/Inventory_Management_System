import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role, type RequisitionFunding } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import {
  createDepartment,
  createUser,
  futureDeadline,
  login,
  resetData,
  seedSubthresholdApprover,
} from './factories';

/**
 * Phase 08 — the way back.
 *
 * Ayman's ruling, 2026-08-26: every stage between approval and add-to-inventory is reversible,
 * because an IM who clicks one stage too far currently has nowhere to go. Add-to-inventory itself
 * is not, and neither is anything after it: stock has moved by then.
 *
 * What this file defends is not "the button works". It is the two ways a reversal corrupts the
 * books rather than crashing:
 *
 *  - **Money that was undone still counts somewhere.** `fund_receipts` and `purchases` are read
 *    from ten places (migration 0028's comment lists them). Missing one does not fail — it
 *    silently sums a receipt that was taken back, and the expense report is wrong forever.
 *  - **The status is guessed rather than re-derived.** `FUNDS_PARTIAL` versus `FUNDS_RECEIVED` is
 *    a function of `SUM(receipts)` against the approved amount. A reversal that remembers a
 *    "previous status" instead of recomputing gets a three-instalment requisition wrong.
 */
describe('stepping back through the money stages', () => {
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

  /* ------------------------------------------------ undo send-to-accounts */

  describe('taking a requisition back off the Accounts queue', () => {
    it('returns it to BOM_GENERATED so the IM can correct what they sent', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      expect(await statusOf(req.id)).toBe('SENT_TO_ACCOUNTS');

      const undone = await im.client
        .post(`/requisitions/${req.id}/undo-send-to-accounts`)
        .send({ reason: 'Wrong BOM attached' });

      expect(undone.status).toBe(200);
      expect(await statusOf(req.id)).toBe('BOM_GENERATED');
    });

    it('can be sent again afterwards, which is the point of going back', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      await im.client
        .post(`/requisitions/${req.id}/undo-send-to-accounts`)
        .send({ reason: 'Wrong BOM attached' });

      const resent = await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();
      expect(resent.status).toBe(200);
      expect(await statusOf(req.id)).toBe('SENT_TO_ACCOUNTS');
    });

    /**
     * The line this refuses to cross. Once Accounts has released money, the requisition is not
     * "waiting to be sent" any more, and a receipt hanging off one that claims it was never sent
     * describes a state that never existed rather than an earlier one.
     */
    it('refuses once Accounts has released money against it', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      await recordReceipt(req.id, 2000);

      const undone = await im.client
        .post(`/requisitions/${req.id}/undo-send-to-accounts`)
        .send({ reason: 'Changed my mind' });

      expect(undone.status).toBe(409);
      expect(undone.body.code).toBe(ErrorCode.CANNOT_UNDO_SEND_WITH_RECEIPTS);
      expect(undone.body.details.funded).toBe(2000);
      expect(await statusOf(req.id)).toBe('FUNDS_PARTIAL');
    });

    it('refuses from a stage that was never "sent"', async () => {
      const req = await requisitionOnBom(5000);

      const undone = await im.client
        .post(`/requisitions/${req.id}/undo-send-to-accounts`)
        .send({ reason: 'Nothing to undo' });

      expect(undone.status).toBe(409);
      expect(undone.body.code).toBe(ErrorCode.REQUISITION_INVALID_TRANSITION);
    });

    it('will not accept a blank reason', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);

      const undone = await im.client
        .post(`/requisitions/${req.id}/undo-send-to-accounts`)
        .send({ reason: '   ' });

      expect(undone.status).toBe(400);
      expect(await statusOf(req.id)).toBe('SENT_TO_ACCOUNTS');
    });
  });

  /* --------------------------------------------------------- void receipt */

  describe('voiding one fund receipt', () => {
    it('drops the funded total and returns to SENT_TO_ACCOUNTS when it was the only one', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      const funding = await recordReceipt(req.id, 5000);
      expect(funding.funded).toBe(5000);
      expect(await statusOf(req.id)).toBe('FUNDS_RECEIVED');

      const receiptId = funding.receipts[0]!.id;
      const voided = await im.client
        .post(`/requisitions/${req.id}/fund-receipts/${receiptId}/void`)
        .send({ reason: 'Accounts reversed the transfer' });

      expect(voided.status).toBe(200);
      expect((voided.body as RequisitionFunding).funded).toBe(0);
      expect((voided.body as RequisitionFunding).receipts).toHaveLength(0);
      expect(await statusOf(req.id)).toBe('SENT_TO_ACCOUNTS');
    });

    /**
     * The reason the status is re-derived rather than remembered. Two instalments minus one is
     * still partially funded — a reversal that flipped to "the previous status" would send this
     * requisition back to SENT_TO_ACCOUNTS while 2,000 of real money sat on it.
     */
    it('stays FUNDS_PARTIAL when another instalment is still standing', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      await recordReceipt(req.id, 2000);
      const second = await recordReceipt(req.id, 3000);
      expect(await statusOf(req.id)).toBe('FUNDS_RECEIVED');

      const secondId = second.receipts.find((r) => r.amount === 3000)!.id;
      const voided = await im.client
        .post(`/requisitions/${req.id}/fund-receipts/${secondId}/void`)
        .send({ reason: 'Duplicate entry' });

      expect(voided.status).toBe(200);
      expect((voided.body as RequisitionFunding).funded).toBe(2000);
      expect((voided.body as RequisitionFunding).receipts).toHaveLength(1);
      expect(await statusOf(req.id)).toBe('FUNDS_PARTIAL');
    });

    /**
     * One entry per press, repeatable (ruling 2026-08-26). Pressing Back twice must undo two
     * instalments, not wipe the stage on the first press.
     */
    it('undoes exactly one entry per call', async () => {
      const req = await requisitionOnBom(6000);
      await sendToAccounts(req.id);
      await recordReceipt(req.id, 2000);
      await recordReceipt(req.id, 2000);
      const third = await recordReceipt(req.id, 2000);
      expect(third.receipts).toHaveLength(3);

      const first = await im.client
        .post(`/requisitions/${req.id}/fund-receipts/${third.receipts[0]!.id}/void`)
        .send({ reason: 'One' });
      expect((first.body as RequisitionFunding).receipts).toHaveLength(2);

      const second = await im.client
        .post(`/requisitions/${req.id}/fund-receipts/${third.receipts[1]!.id}/void`)
        .send({ reason: 'Two' });
      expect((second.body as RequisitionFunding).receipts).toHaveLength(1);
      expect((second.body as RequisitionFunding).funded).toBe(2000);
    });

    /** Undo in the order things happened, or a purchase is left funded by nothing. */
    it('refuses while a purchase still stands on the money', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      const funding = await recordReceipt(req.id, 5000);
      await recordPurchase(req.id, req.itemId, 4800);

      const voided = await im.client
        .post(`/requisitions/${req.id}/fund-receipts/${funding.receipts[0]!.id}/void`)
        .send({ reason: 'Too late' });

      expect(voided.status).toBe(409);
      expect(voided.body.code).toBe(ErrorCode.CANNOT_VOID_RECEIPT_WITH_PURCHASES);
      expect(await statusOf(req.id)).toBe('PURCHASED');
    });

    /**
     * Idempotent by the `voided_at IS NULL` predicate on the write, not by a separate check. A
     * second void must not overwrite the first one's actor and reason.
     */
    it('refuses to void the same receipt twice', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      await recordReceipt(req.id, 2000);
      // Two receipts, so voiding one leaves the requisition on FUNDS_PARTIAL and the second
      // attempt reaches the "already voided" check rather than being turned away earlier by the
      // status guard. That guard is real, but it is not what this test is about.
      const funding = await recordReceipt(req.id, 2000);
      const receiptId = funding.receipts[0]!.id;

      await im.client
        .post(`/requisitions/${req.id}/fund-receipts/${receiptId}/void`)
        .send({ reason: 'First' });
      const again = await im.client
        .post(`/requisitions/${req.id}/fund-receipts/${receiptId}/void`)
        .send({ reason: 'Second' });

      expect(again.status).toBe(404);
      expect(again.body.code).toBe(ErrorCode.MONEY_ROW_NOT_FOUND);

      const row = await ctx.db
        .selectFrom('fund_receipts')
        .where('id', '=', receiptId)
        .select(['void_reason'])
        .executeTakeFirstOrThrow();
      expect(row.void_reason).toBe('First');
    });

    /**
     * The ownership check is in the same WHERE as the write, so a receipt id from another
     * requisition cannot be voided by someone authorised on this one.
     */
    it('will not void a receipt belonging to a different requisition', async () => {
      const mine = await requisitionOnBom(5000);
      await sendToAccounts(mine.id);
      await recordReceipt(mine.id, 5000);

      const theirs = await requisitionOnBom(5000);
      await sendToAccounts(theirs.id);
      const theirFunding = await recordReceipt(theirs.id, 5000);

      const voided = await im.client
        .post(`/requisitions/${mine.id}/fund-receipts/${theirFunding.receipts[0]!.id}/void`)
        .send({ reason: 'Wrong requisition' });

      expect(voided.status).toBe(404);
      expect((await fundingOf(theirs.id)).funded).toBe(5000);
    });
  });

  /* -------------------------------------------------------- void purchase */

  describe('voiding one purchase', () => {
    it('returns the requisition to the funded stage when it was the only purchase', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      await recordReceipt(req.id, 5000);
      const purchased = await recordPurchase(req.id, req.itemId, 4800);
      expect(purchased.spent).toBe(4800);

      const voided = await im.client
        .post(`/requisitions/${req.id}/purchases/${purchased.purchases[0]!.id}/void`)
        .send({ reason: 'Wrong vendor' });

      expect(voided.status).toBe(200);
      expect((voided.body as RequisitionFunding).spent).toBe(0);
      expect((voided.body as RequisitionFunding).purchases).toHaveLength(0);
      expect(await statusOf(req.id)).toBe('FUNDS_RECEIVED');
    });

    /** A split-vendor requisition is still purchased while any purchase stands. */
    it('stays PURCHASED while another vendor is still recorded', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      await recordReceipt(req.id, 5000);
      await recordPurchase(req.id, req.itemId, 2000, 'Vendor A');
      const second = await recordPurchase(req.id, req.itemId, 1500, 'Vendor B');

      const vendorB = second.purchases.find((p) => p.vendor === 'Vendor B')!;
      const voided = await im.client
        .post(`/requisitions/${req.id}/purchases/${vendorB.id}/void`)
        .send({ reason: 'Vendor B cancelled' });

      expect(voided.status).toBe(200);
      expect((voided.body as RequisitionFunding).spent).toBe(2000);
      expect((voided.body as RequisitionFunding).purchases).toHaveLength(1);
      expect(await statusOf(req.id)).toBe('PURCHASED');
    });

    it('can be re-recorded afterwards', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      await recordReceipt(req.id, 5000);
      const purchased = await recordPurchase(req.id, req.itemId, 4800);

      await im.client
        .post(`/requisitions/${req.id}/purchases/${purchased.purchases[0]!.id}/void`)
        .send({ reason: 'Wrong figure' });
      const again = await recordPurchase(req.id, req.itemId, 4200);

      expect(again.spent).toBe(4200);
      expect(await statusOf(req.id)).toBe('PURCHASED');
    });

    it('refuses from PURCHASE_VERIFIED, which has its own way back', async () => {
      const req = await requisitionOnBom(5000);
      await sendToAccounts(req.id);
      await recordReceipt(req.id, 5000);
      const purchased = await recordPurchase(req.id, req.itemId, 5000);
      // Verification refuses without the paperwork (`INVOICE_MISSING`), so the invoice goes on
      // first — this test is about the reversal, not about that rule.
      await im.client
        .post(`/requisitions/${req.id}/purchases/${purchased.purchases[0]!.id}/invoice`)
        .attach('file', Buffer.from('%PDF-1.4 invoice'), 'invoice.pdf');
      const verified = await im.client
        .post(`/requisitions/${req.id}/verify-purchase`)
        .send({ returnedAmount: 0, returnNote: null });
      expect(verified.status).toBe(200);

      const voided = await im.client
        .post(`/requisitions/${req.id}/purchases/${purchased.purchases[0]!.id}/void`)
        .send({ reason: 'Too late' });

      expect(voided.status).toBe(409);
      expect(voided.body.code).toBe(ErrorCode.REQUISITION_INVALID_TRANSITION);
    });
  });

  /* ---------------------------------------------- the money actually moves */

  /**
   * The test the whole `voided_at` design exists for. A voided receipt must vanish from every
   * derived figure, not just from the list it was rendered in — because a read site that forgot
   * the filter does not throw, it quietly reports money that was taken back.
   */
  it('removes voided money from the funding summary and the expense report alike', async () => {
    const req = await requisitionOnBom(5000);
    await sendToAccounts(req.id);
    const funding = await recordReceipt(req.id, 5000);

    const before = await expenseTotals();

    await im.client
      .post(`/requisitions/${req.id}/fund-receipts/${funding.receipts[0]!.id}/void`)
      .send({ reason: 'Accounts reversed it' });

    expect((await fundingOf(req.id)).funded).toBe(0);
    const after = await expenseTotals();
    expect(before.funded - after.funded).toBe(5000);
  });

  it('removes a voided purchase from spent in both places', async () => {
    const req = await requisitionOnBom(5000);
    await sendToAccounts(req.id);
    await recordReceipt(req.id, 5000);
    const purchased = await recordPurchase(req.id, req.itemId, 4800);
    const before = await expenseTotals();

    await im.client
      .post(`/requisitions/${req.id}/purchases/${purchased.purchases[0]!.id}/void`)
      .send({ reason: 'Wrong vendor' });

    expect((await fundingOf(req.id)).spent).toBe(0);
    expect(before.spent - (await expenseTotals()).spent).toBe(4800);
  });

  /**
   * The row is kept, and kept attributable. "Someone recorded 5,000 and then took it back" is
   * exactly what an auditor asks about, and a deleted row cannot answer it.
   */
  it('keeps the voided row, with who did it and why', async () => {
    const req = await requisitionOnBom(5000);
    await sendToAccounts(req.id);
    const funding = await recordReceipt(req.id, 5000);
    const receiptId = funding.receipts[0]!.id;

    await im.client
      .post(`/requisitions/${req.id}/fund-receipts/${receiptId}/void`)
      .send({ reason: 'Accounts reversed the transfer' });

    const row = await ctx.db
      .selectFrom('fund_receipts')
      .where('id', '=', receiptId)
      .select(['amount', 'voided_at', 'voided_by', 'void_reason'])
      .executeTakeFirstOrThrow();

    expect(Number(row.amount)).toBe(5000);
    expect(row.voided_at).not.toBeNull();
    expect(row.voided_by).toBe(im.id);
    expect(row.void_reason).toBe('Accounts reversed the transfer');
  });

  /* ------------------------------------------------------------ who may */

  it('refuses a reversal from someone who is not an Inventory Manager', async () => {
    const req = await requisitionOnBom(5000);
    await sendToAccounts(req.id);

    const undone = await requester.client
      .post(`/requisitions/${req.id}/undo-send-to-accounts`)
      .send({ reason: 'Not mine to undo' });

    expect(undone.status).toBe(403);
    expect(await statusOf(req.id)).toBe('SENT_TO_ACCOUNTS');
  });

  /* --------------------------------------------------------------- helpers */

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

  /**
   * The expenses report's own totals — the second place money is summed, from its own SQL rather
   * than through `FundsRepository`. It buckets by month/department/project rather than listing
   * requisitions, so the totals are what to assert on — as a **delta**, never an absolute.
   * `resetData` deliberately leaves requisitions in place (their event log is append-only), so
   * money from earlier tests in this file is still in the report, and an absolute figure would be
   * wrong the moment a test is added above.
   */
  async function expenseTotals(): Promise<{ funded: number; spent: number }> {
    const response = await im.client.get('/reports/expenses');
    expect(response.status).toBe(200);
    const totals = response.body.totals as { funded: number; spent: number };
    return { funded: totals.funded, spent: totals.spent };
  }

  async function sendToAccounts(requisitionId: string): Promise<void> {
    const sent = await im.client.post(`/requisitions/${requisitionId}/send-to-accounts`).send();
    expect(sent.status).toBe(200);
  }

  async function recordReceipt(
    requisitionId: string,
    amount: number,
  ): Promise<RequisitionFunding> {
    const response = await im.client.post(`/requisitions/${requisitionId}/fund-receipts`).send({
      amount,
      receivedAt: new Date().toISOString(),
      reference: null,
      note: null,
    });
    expect(response.status).toBe(201);
    return response.body as RequisitionFunding;
  }

  async function recordPurchase(
    requisitionId: string,
    itemId: string,
    unitCost: number,
    vendor = 'Techshop BD',
  ): Promise<RequisitionFunding> {
    const response = await im.client.post(`/requisitions/${requisitionId}/purchases`).send({
      vendor,
      invoiceNo: 'INV-1',
      purchasedAt: new Date().toISOString(),
      note: null,
      lines: [{ requisitionItemId: itemId, quantity: 1, unitCost }],
    });
    expect(response.status).toBe(201);
    return response.body as RequisitionFunding;
  }

  /** Drives a requisition all the way to BOM_GENERATED, which is where the money half starts. */
  async function requisitionOnBom(amount: number): Promise<{ id: string; itemId: string }> {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Reversal test',
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
});
