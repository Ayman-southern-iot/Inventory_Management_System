import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role, type RequisitionFunding } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createDepartment, createUser, login, resetData, seedSubthresholdApprover , futureDeadline} from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';

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
  let fixture: StockFixture;

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
    fixture = await createStockFixture(ctx.db);
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
    expect(tooMuch.body.code).toBe(ErrorCode.FUNDING_EXCEEDS_APPROVED);
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

  /**
   * QA round 1, item 5d. A fat-fingered year puts the money in a month that has not happened,
   * and nothing downstream re-checks it. Asserted on the message and not just the status: the
   * SPA renders `VALIDATION_FAILED` field issues verbatim, so a generic "Invalid input" here
   * would be what the IM actually reads.
   */
  it('refuses an event date in the future, and says which date and why', async () => {
    const req = await requisitionOnBom(5000);
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const futureReceipt = await im.client
      .post(`/requisitions/${req.id}/fund-receipts`)
      .send({ amount: 5000, receivedAt: tomorrow });
    expect(futureReceipt.status).toBe(400);
    expect(futureReceipt.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(JSON.stringify(futureReceipt.body)).toContain(
      'The date funds were received cannot be in the future',
    );

    const purchasable = await readyToPurchase(5000);
    const futurePurchase = await im.client.post(`/requisitions/${purchasable.id}/purchases`).send({
      vendor: 'Techshop BD',
      purchasedAt: tomorrow,
      lines: [{ requisitionItemId: purchasable.itemId, quantity: 1, unitCost: 4800 }],
    });
    expect(futurePurchase.status).toBe(400);
    expect(JSON.stringify(futurePurchase.body)).toContain(
      'The purchase date cannot be in the future',
    );
  });

  it('still accepts a backdated event date — these record when it happened, not when it was typed', async () => {
    const req = await readyToPurchase(5000);
    const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const purchased = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Techshop BD',
      purchasedAt: lastMonth,
      lines: [{ requisitionItemId: req.itemId, quantity: 1, unitCost: 4800 }],
    });
    expect(purchased.status).toBe(201);
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

  /* --------------------------------------------- invoices and verification */

  it('refuses to verify while a purchase has no invoice', async () => {
    const req = await purchased(5000, 4000);

    const early = await im.client.post(`/requisitions/${req.id}/verify-purchase`).send({});
    expect(early.status).toBe(409);
    expect(early.body.code).toBe(ErrorCode.INVOICE_MISSING);
    expect(early.body.message).toContain('invoice');
    expect(await statusOf(req.id)).toBe('PURCHASED');
  });

  it('attaches an invoice and then verifies', async () => {
    const req = await purchased(5000, 4000);
    const purchaseId = (await fundingOf(req.id)).purchases[0]!.id;

    const uploaded = await im.client
      .post(`/requisitions/${req.id}/purchases/${purchaseId}/invoice`)
      .attach('file', Buffer.from('%PDF-1.4 invoice'), 'invoice.pdf');
    expect(uploaded.status).toBe(200);
    expect((uploaded.body as RequisitionFunding).purchases[0]!.hasInvoice).toBe(true);

    const verified = await im.client.post(`/requisitions/${req.id}/verify-purchase`).send({});
    expect(verified.status).toBe(200);
    expect(await statusOf(req.id)).toBe('PURCHASE_VERIFIED');
  });

  /**
   * Transportation is folded into `requested_amount` at submit time and never reaches a
   * `purchases` row (it isn't a stock movement), so the verify-purchase dialog must treat it
   * as spent-for-the-purpose-of-the-unspent-figure. Without the fold, the IM is told to hand
   * `transportation_cost` back to Accounts, which is wrong — they already spent it.
   */
  it('folds transportation_cost into the unspent figure at verify-purchase', async () => {
    const req = await requisitionWithTransportation(5000, 100, 'Hiring a van to the warehouse');
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();
    // Fund 5000 net — the IM has the requisition amount (5000 spent) covered.
    await im.client
      .post(`/requisitions/${req.id}/fund-receipts`)
      .send({ amount: 5000, receivedAt: new Date().toISOString() });
    const bought = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Techshop BD',
      invoiceNo: 'INV-1',
      purchasedAt: new Date().toISOString(),
      lines: [{ requisitionItemId: req.itemId, quantity: 1, unitCost: 5000 }],
    });
    expect(bought.status).toBe(201);
    const purchaseId = (await fundingOf(req.id)).purchases[0]!.id;
    await im.client
      .post(`/requisitions/${req.id}/purchases/${purchaseId}/invoice`)
      .attach('file', Buffer.from('%PDF-1.4 invoice'), 'invoice.pdf');

    const funding = await fundingOf(req.id);
    expect(funding.spent).toBe(5000);
    expect(funding.transportation).toBe(100);
    expect(funding.spentInclTransportation).toBe(5100);
    // 5000 funded − 5000 purchased − 100 transportation = 100 returned to zero unspent.
    // The IM already paid the 100 for the van; the fold keeps it from showing as unspent.
    expect(funding.unspent).toBe(0);

    const verified = await im.client.post(`/requisitions/${req.id}/verify-purchase`).send({});
    expect(verified.status).toBe(200);
    expect(await statusOf(req.id)).toBe('PURCHASE_VERIFIED');
  });

  /**
   * An IM who clicked the wrong button at verify-purchase needs a way back. The new
   * `unverify-purchase` endpoint flips the status back to PURCHASED so the IM can re-record.
   * Refuses when any money has already been returned — the reverse of a refund is a new
   * refund, not a status flip.
   */
  it('allows IM to unverify a purchase and re-verify it', async () => {
    const req = await verifiable(5000, 4000);
    // Verify first — `verifiable` only attaches the invoice.
    const verifyFirst = await im.client.post(`/requisitions/${req.id}/verify-purchase`).send({});
    expect(verifyFirst.status).toBe(200);
    expect(await statusOf(req.id)).toBe('PURCHASE_VERIFIED');

    const unverified = await im.client
      .post(`/requisitions/${req.id}/unverify-purchase`)
      .send({ reason: 'Recorded the wrong returned amount' });
    expect(unverified.status).toBe(200);
    expect(await statusOf(req.id)).toBe('PURCHASED');

    // Re-verify with a different return — the previous attempt's PURCHASE_VERIFIED event and
    // audit row are still there, but the status is fresh and a new event is appended.
    const reVerified = await im.client.post(`/requisitions/${req.id}/verify-purchase`).send({
      returnedAmount: 500,
      returnNote: 'Vendor discount',
    });
    expect(reVerified.status).toBe(200);
    expect(await statusOf(req.id)).toBe('PURCHASE_VERIFIED');
  });

  it('refuses to unverify when the purchase already has returned funds', async () => {
    // Verify WITH a returned amount so `fund_returns` has a row to refuse on.
    const req = await verifiable(5000, 4000);
    const verified = await im.client.post(`/requisitions/${req.id}/verify-purchase`).send({
      returnedAmount: 500,
      returnNote: 'Vendor over-quoted',
    });
    expect(verified.status).toBe(200);

    const refused = await im.client
      .post(`/requisitions/${req.id}/unverify-purchase`)
      .send({ reason: 'Trying to undo a refund' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe(ErrorCode.CANNOT_UNVERIFY_WITH_RETURNS);
    expect(await statusOf(req.id)).toBe('PURCHASE_VERIFIED');
  });

  it('rejects a file that is not really a document', async () => {
    const req = await purchased(5000, 4000);
    const purchaseId = (await fundingOf(req.id)).purchases[0]!.id;

    // Named .pdf, but the magic bytes say otherwise.
    const disguised = await im.client
      .post(`/requisitions/${req.id}/purchases/${purchaseId}/invoice`)
      .attach('file', Buffer.from('<svg onload=alert(1)>'), 'invoice.pdf');

    expect(disguised.status).toBe(400);
  });

  it('cannot attach an invoice to another requisition’s purchase', async () => {
    const mine = await purchased(5000, 4000);
    const theirs = await purchased(5000, 4000);
    const theirPurchaseId = (await fundingOf(theirs.id)).purchases[0]!.id;

    const crossed = await im.client
      .post(`/requisitions/${mine.id}/purchases/${theirPurchaseId}/invoice`)
      .attach('file', Buffer.from('%PDF-1.4 invoice'), 'invoice.pdf');

    expect(crossed.status).toBe(404);
  });

  /* ------------------------------------------------------- money returned */

  it('returns the unspent balance to Accounts with its note', async () => {
    // 5000 released, 4000 spent — 1000 can go back.
    const req = await verifiable(5000, 4000);

    const verified = await im.client.post(`/requisitions/${req.id}/verify-purchase`).send({
      returnedAmount: 1000,
      returnNote: 'Vendor discount on the sensors',
    });
    expect(verified.status).toBe(200);

    const funding = verified.body as RequisitionFunding;
    expect(funding.returned).toBe(1000);
    expect(funding.netFunded).toBe(4000);
    expect(funding.unspent).toBe(0);
    expect(funding.returns).toHaveLength(1);
    expect(funding.returns[0]!.note).toBe('Vendor discount on the sensors');
    // Receipts are untouched: "released" and "came back" stay separate figures.
    expect(funding.funded).toBe(5000);
  });

  it('refuses a return with no stated reason', async () => {
    const req = await verifiable(5000, 4000);

    const noNote = await im.client
      .post(`/requisitions/${req.id}/verify-purchase`)
      .send({ returnedAmount: 1000 });

    expect(noNote.status).toBe(400);
    expect(await statusOf(req.id)).toBe('PURCHASED');
  });

  it('refuses to return more than is unspent', async () => {
    const req = await verifiable(5000, 4000);

    const tooMuch = await im.client
      .post(`/requisitions/${req.id}/verify-purchase`)
      .send({ returnedAmount: 1500, returnNote: 'Wishful thinking' });

    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.code).toBe(ErrorCode.RETURN_EXCEEDS_UNSPENT);
    // Nothing partially applied: no return row, and the status has not moved.
    expect((await fundingOf(req.id)).returns).toHaveLength(0);
    expect(await statusOf(req.id)).toBe('PURCHASED');
  });

  /* --------------------------------------------------- invoice visibility */

  it('lets the requester and the approver read the invoice, but nobody else', async () => {
    const req = await verifiable(5000, 4000);
    const purchaseId = (await fundingOf(req.id)).purchases[0]!.id;
    const path = `/requisitions/${req.id}/purchases/${purchaseId}/invoice`;

    expect((await im.client.get(path)).status).toBe(200);
    expect((await requester.client.get(path)).status).toBe(200);
    expect((await approver.client.get(path)).status).toBe(200);

    // An uninvolved colleague sees vendor pricing they have no business with.
    const bystander = await signIn([Role.GENERAL]);
    expect((await bystander.client.get(path)).status).toBe(403);
  });

  /**
   * The funding summary carries the same commercially sensitive detail as the invoice — vendor
   * names, invoice numbers, purchase totals — so it needs the same set of readers. It shipped
   * with no guard at all, and `GET /stock/ledger` is readable by everyone and returns the
   * requisition ids that make the ids guessable-free. Found in the 6.6 security review.
   */
  it('restricts the funding summary to the same people as the invoice', async () => {
    const req = await verifiable(5000, 4000);
    const path = `/requisitions/${req.id}/funding`;

    expect((await im.client.get(path)).status).toBe(200);
    expect((await requester.client.get(path)).status).toBe(200);
    expect((await approver.client.get(path)).status).toBe(200);

    const bystander = await signIn([Role.GENERAL]);
    const denied = await bystander.client.get(path);
    expect(denied.status).toBe(403);
    // And nothing about the purchase leaked in the refusal body.
    expect(JSON.stringify(denied.body)).not.toContain('Techshop');
  });

  /* --------------------------------------------------- receiving to stock */

  it('receives a verified purchase into stock, creating the catalogue product', async () => {
    const req = await verified(5000, 4000);
    const funding = await fundingOf(req.id);
    const line = funding.purchases[0]!.lines[0]!;
    // The requisition line was free text, so it has no product yet.
    expect(line.productId).toBeNull();

    const stocked = await im.client.post(`/requisitions/${req.id}/receive-to-stock`).send({
      lines: [
        {
          purchaseLineId: line.id,
          compartmentId: fixture.compartmentA,
          quantity: 1,
          newProduct: {
            productCode: `RCV-${Date.now() % 100000}`,
            name: 'Widget',
            categoryId: fixture.categoryId,
            unit: 'pcs',
          },
        },
      ],
    });
    expect(stocked.status).toBe(200);
    expect(await statusOf(req.id)).toBe('STOCKED');

    const after = (stocked.body as RequisitionFunding).purchases[0]!.lines[0]!;
    expect(after.receivedQuantity).toBe(1);
    expect(after.outstandingQuantity).toBe(0);
    // The free-text line is now a real catalogue product, and the item points at it.
    expect(after.productId).not.toBeNull();

    // The stock actually moved, and the ledger row traces back to the requisition.
    const ledger = await ctx.db
      .selectFrom('stock_ledger')
      .where('ref_type', '=', 'REQUISITION')
      .where('ref_id', '=', req.id)
      .selectAll()
      .execute();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.movement_type).toBe('RECEIPT');
    expect(ledger[0]!.quantity).toBe(1);

    const placement = await ctx.db
      .selectFrom('stock_placements')
      .where('product_id', '=', after.productId!)
      .selectAll()
      .executeTakeFirst();
    expect(placement?.quantity).toBe(1);
  });

  it('stays PURCHASE_VERIFIED while any line is only part-received', async () => {
    const req = await verified(5000, 4000, 3);
    const line = (await fundingOf(req.id)).purchases[0]!.lines[0]!;

    const partial = await im.client.post(`/requisitions/${req.id}/receive-to-stock`).send({
      lines: [
        {
          purchaseLineId: line.id,
          compartmentId: fixture.compartmentA,
          quantity: 2,
          newProduct: {
            productCode: `PART-${Date.now() % 100000}`,
            name: 'Widget',
            categoryId: fixture.categoryId,
            unit: 'pcs',
          },
        },
      ],
    });
    expect(partial.status).toBe(200);

    const funding = partial.body as RequisitionFunding;
    expect(funding.purchases[0]!.lines[0]!.receivedQuantity).toBe(2);
    expect(funding.purchases[0]!.lines[0]!.outstandingQuantity).toBe(1);
    // A part-delivery must not flip the tracker to complete.
    expect(await statusOf(req.id)).toBe('PURCHASE_VERIFIED');

    // The rest arrives; now it is stocked. No newProduct needed — the item is catalogued.
    const rest = await im.client.post(`/requisitions/${req.id}/receive-to-stock`).send({
      lines: [{ purchaseLineId: line.id, compartmentId: fixture.compartmentA, quantity: 1 }],
    });
    expect(rest.status).toBe(200);
    expect(await statusOf(req.id)).toBe('STOCKED');
  });

  it('refuses to receive more than was purchased', async () => {
    const req = await verified(5000, 4000);
    const line = (await fundingOf(req.id)).purchases[0]!.lines[0]!;

    const tooMany = await im.client.post(`/requisitions/${req.id}/receive-to-stock`).send({
      lines: [
        {
          purchaseLineId: line.id,
          compartmentId: fixture.compartmentA,
          quantity: 2,
          newProduct: {
            productCode: `OVER-${Date.now() % 100000}`,
            name: 'Widget',
            categoryId: fixture.categoryId,
            unit: 'pcs',
          },
        },
      ],
    });

    expect(tooMany.status).toBe(409);
    // Nothing moved: the whole operation is one transaction.
    const ledger = await ctx.db
      .selectFrom('stock_ledger')
      .where('ref_id', '=', req.id)
      .selectAll()
      .execute();
    expect(ledger).toHaveLength(0);
    expect(await statusOf(req.id)).toBe('PURCHASE_VERIFIED');
  });

  it('refuses a free-text line with no product details', async () => {
    const req = await verified(5000, 4000);
    const line = (await fundingOf(req.id)).purchases[0]!.lines[0]!;

    const noProduct = await im.client.post(`/requisitions/${req.id}/receive-to-stock`).send({
      lines: [{ purchaseLineId: line.id, compartmentId: fixture.compartmentA, quantity: 1 }],
    });

    expect(noProduct.status).toBe(400);
    // The per-field reason lives in `details`; the top-level message is the generic envelope.
    expect(JSON.stringify(noProduct.body.details)).toContain('catalogue');
  });

  it('rolls the whole delivery back when one line fails', async () => {
    // Two lines; the second asks for more than was bought, so neither may land.
    const req = await verifiedTwoLines();
    const lines = (await fundingOf(req.id)).purchases[0]!.lines;
    expect(lines).toHaveLength(2);

    const attempt = await im.client.post(`/requisitions/${req.id}/receive-to-stock`).send({
      lines: [
        {
          purchaseLineId: lines[0]!.id,
          compartmentId: fixture.compartmentA,
          quantity: 1,
          newProduct: {
            productCode: `TX1-${Date.now() % 100000}`,
            name: 'First',
            categoryId: fixture.categoryId,
            unit: 'pcs',
          },
        },
        {
          purchaseLineId: lines[1]!.id,
          compartmentId: fixture.compartmentA,
          quantity: 99,
          newProduct: {
            productCode: `TX2-${Date.now() % 100000}`,
            name: 'Second',
            categoryId: fixture.categoryId,
            unit: 'pcs',
          },
        },
      ],
    });

    expect(attempt.status).toBe(409);
    expect(attempt.body.code).toBe(ErrorCode.RECEIVE_EXCEEDS_PURCHASED);
    // The first line's stock receipt and its new product must both be gone. This is the whole
    // reason StockService.receive takes the caller's transaction.
    const ledger = await ctx.db
      .selectFrom('stock_ledger')
      .where('ref_id', '=', req.id)
      .selectAll()
      .execute();
    expect(ledger).toHaveLength(0);
    const strayProduct = await ctx.db
      .selectFrom('products')
      .where('name', '=', 'First')
      .selectAll()
      .executeTakeFirst();
    expect(strayProduct).toBeUndefined();
  });

  /* --------------------------------------------------------- borrow to user */

  it('issues a verified purchase straight to a user, with a real ledger trail', async () => {
    const req = await verified(5000, 4000);
    const line = (await fundingOf(req.id)).purchases[0]!.lines[0]!;
    const borrower = await signIn([Role.GENERAL]);

    const issued = await im.client.post(`/requisitions/${req.id}/borrow-to-user`).send({
      borrowerId: borrower.id,
      expectedReturnDate: '2026-12-31',
      isReturnable: true,
      purpose: 'Field kit',
      lines: [
        {
          purchaseLineId: line.id,
          compartmentId: fixture.compartmentA,
          quantity: 1,
          newProduct: {
            productCode: `BRW-${Date.now() % 100000}`,
            name: 'Widget',
            categoryId: fixture.categoryId,
            unit: 'pcs',
          },
        },
      ],
    });
    expect(issued.status).toBe(200);
    expect(await statusOf(req.id)).toBe('STOCKED');

    // The borrow exists, belongs to the borrower, and is already issued.
    const borrow = await ctx.db
      .selectFrom('borrow_requests')
      .where('requester_id', '=', borrower.id)
      .selectAll()
      .executeTakeFirst();
    expect(borrow).toBeDefined();
    expect(borrow!.status).toBe('ISSUED');
    expect(borrow!.issued_at).not.toBeNull();
    expect(borrow!.quantity).toBe(1);

    // The stock genuinely moved through the shelf: a RECEIPT from the requisition and an ISSUE
    // against the borrow. Nothing shortcut straight to "issued".
    const ledger = await ctx.db
      .selectFrom('stock_ledger')
      .selectAll()
      .orderBy('created_at')
      .execute();
    const receipt = ledger.find((r) => r.ref_type === 'REQUISITION' && r.ref_id === req.id);
    const issue = ledger.find((r) => r.ref_type === 'BORROW' && r.movement_type === 'ISSUE');
    expect(receipt?.movement_type).toBe('RECEIPT');
    expect(issue?.quantity).toBe(1);

    // And no reservation is left stranded — the placement is gone because it hit zero.
    const placements = await ctx.db.selectFrom('stock_placements').selectAll().execute();
    const stranded = placements.filter((p) => p.reserved_qty > 0);
    expect(stranded).toHaveLength(0);
  });

  it('notifies the borrower, who never asked for it', async () => {
    const req = await verified(5000, 4000);
    const line = (await fundingOf(req.id)).purchases[0]!.lines[0]!;
    const borrower = await signIn([Role.GENERAL]);

    await im.client.post(`/requisitions/${req.id}/borrow-to-user`).send({
      borrowerId: borrower.id,
      lines: [
        {
          purchaseLineId: line.id,
          compartmentId: fixture.compartmentA,
          quantity: 1,
          newProduct: {
            productCode: `NOT-${Date.now() % 100000}`,
            name: 'Widget',
            categoryId: fixture.categoryId,
            unit: 'pcs',
          },
        },
      ],
    });

    const notifications = await borrower.client.get('/notifications');
    const types = notifications.body.items.map((n: { type: string }) => n.type);
    expect(types).toContain('borrowing.issued_to_you');
  });

  it('refuses to issue to a deactivated user', async () => {
    const req = await verified(5000, 4000);
    const line = (await fundingOf(req.id)).purchases[0]!.lines[0]!;
    const borrower = await signIn([Role.GENERAL]);
    await ctx.db
      .updateTable('users')
      .set({ is_active: false })
      .where('id', '=', borrower.id)
      .execute();

    const attempt = await im.client.post(`/requisitions/${req.id}/borrow-to-user`).send({
      borrowerId: borrower.id,
      lines: [
        {
          purchaseLineId: line.id,
          compartmentId: fixture.compartmentA,
          quantity: 1,
          newProduct: {
            productCode: `DEA-${Date.now() % 100000}`,
            name: 'Widget',
            categoryId: fixture.categoryId,
            unit: 'pcs',
          },
        },
      ],
    });

    expect(attempt.status).toBe(400);
    // Nothing moved *for this requisition* — the shared stock fixture has its own ledger rows.
    const ledger = await ctx.db
      .selectFrom('stock_ledger')
      .where('ref_id', '=', req.id)
      .selectAll()
      .execute();
    expect(ledger).toHaveLength(0);
  });

  it('cannot issue the same line twice', async () => {
    const req = await verified(5000, 4000);
    const line = (await fundingOf(req.id)).purchases[0]!.lines[0]!;
    const borrower = await signIn([Role.GENERAL]);

    const body = {
      borrowerId: borrower.id,
      lines: [
        {
          purchaseLineId: line.id,
          compartmentId: fixture.compartmentA,
          quantity: 1,
          newProduct: {
            productCode: `TWICE-${Date.now() % 100000}`,
            name: 'Widget',
            categoryId: fixture.categoryId,
            unit: 'pcs',
          },
        },
      ],
    };

    expect((await im.client.post(`/requisitions/${req.id}/borrow-to-user`).send(body)).status).toBe(200);
    // The line is fully accounted for now, so a second issue has nothing left to give.
    const again = await im.client.post(`/requisitions/${req.id}/borrow-to-user`).send(body);
    expect(again.status).toBe(409);
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
      approvalDeadline: futureDeadline(),
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

  /**
   * Same as `requisitionOnBom` but the requisition carries a `transportation_cost`. The cost
   * flows into `requested_amount` at submit and survives the approval chain; the verify-purchase
   * flow then folds it into the `unspent` figure so the IM isn't asked to hand it back.
   */
  async function requisitionWithTransportation(
    amount: number,
    transportation: number,
    transportationDescription: string,
  ): Promise<{ id: string; itemId: string }> {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Funds lifecycle test',
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: amount, productId: null, note: null },
      ],
      transportationCost: transportation,
      transportationDescription,
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

  /** ...and on to PURCHASED, spending `spend` of the `funded` amount. */
  async function purchased(funded: number, spend: number): Promise<{ id: string; itemId: string }> {
    const req = await readyToPurchase(funded);
    const bought = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Techshop BD',
      invoiceNo: 'INV-1',
      purchasedAt: new Date().toISOString(),
      lines: [{ requisitionItemId: req.itemId, quantity: 1, unitCost: spend }],
    });
    expect(bought.status).toBe(201);
    return req;
  }

  /** ...and with the invoice attached, so `verify-purchase` is reachable. */
  async function verifiable(funded: number, spend: number): Promise<{ id: string; itemId: string }> {
    const req = await purchased(funded, spend);
    const purchaseId = (await fundingOf(req.id)).purchases[0]!.id;
    const uploaded = await im.client
      .post(`/requisitions/${req.id}/purchases/${purchaseId}/invoice`)
      .attach('file', Buffer.from('%PDF-1.4 invoice'), 'invoice.pdf');
    expect(uploaded.status).toBe(200);
    return req;
  }

  /** ...and verified, which is where receiving into stock becomes legal. */
  async function verified(
    funded: number,
    spend: number,
    quantity = 1,
  ): Promise<{ id: string; itemId: string }> {
    const req = await requisitionOnBom(funded);
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();
    await im.client
      .post(`/requisitions/${req.id}/fund-receipts`)
      .send({ amount: funded, receivedAt: new Date().toISOString() });
    const bought = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Techshop BD',
      purchasedAt: new Date().toISOString(),
      lines: [
        { requisitionItemId: req.itemId, quantity, unitCost: round2(spend / quantity) },
      ],
    });
    expect(bought.status).toBe(201);

    const purchaseId = (await fundingOf(req.id)).purchases[0]!.id;
    await im.client
      .post(`/requisitions/${req.id}/purchases/${purchaseId}/invoice`)
      .attach('file', Buffer.from('%PDF-1.4 invoice'), 'invoice.pdf');
    const ok = await im.client.post(`/requisitions/${req.id}/verify-purchase`).send({});
    expect(ok.status).toBe(200);
    return req;
  }

  /** A verified purchase with two lines, for the all-or-nothing rollback test. */
  async function verifiedTwoLines(): Promise<{ id: string }> {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Two-line delivery',
      items: [
        { itemName: 'First', quantity: 1, estimatedUnitPrice: 1000, productId: null, note: null },
        { itemName: 'Second', quantity: 1, estimatedUnitPrice: 1000, productId: null, note: null },
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
    await approver.client
      .post(`/requisitions/approvals/${approverApprovalId}/decision`)
      .send({ approve: true });

    const detail = (await requester.client.get(`/requisitions/${id}`)).body;
    const itemIds = detail.items.map((item: { id: string }) => item.id) as string[];

    await im.client.post('/boms').send({
      requisitionIds: [id],
      lines: itemIds.map((itemId) => ({ requisitionItemId: itemId, unitCost: 1000, vendor: 'V' })),
    });
    await im.client.post(`/requisitions/${id}/send-to-accounts`).send();
    await im.client
      .post(`/requisitions/${id}/fund-receipts`)
      .send({ amount: 2000, receivedAt: new Date().toISOString() });
    await im.client.post(`/requisitions/${id}/purchases`).send({
      vendor: 'Techshop BD',
      purchasedAt: new Date().toISOString(),
      lines: itemIds.map((itemId) => ({ requisitionItemId: itemId, quantity: 1, unitCost: 1000 })),
    });
    const purchaseId = (await fundingOf(id)).purchases[0]!.id;
    await im.client
      .post(`/requisitions/${id}/purchases/${purchaseId}/invoice`)
      .attach('file', Buffer.from('%PDF-1.4 invoice'), 'invoice.pdf');
    await im.client.post(`/requisitions/${id}/verify-purchase`).send({});
    return { id };
  }

  function round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
});
