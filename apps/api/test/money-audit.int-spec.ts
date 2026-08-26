import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type PersonalRecord, type RequisitionFunding } from '@ims/shared';
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

/**
 * The arithmetic audit. Ayman, 2026-08-26, reporting it from the shop floor:
 *
 *   "I requested 1000. 500 is transportation and the rest for items. Five items estimated at 100
 *    each, so 5 x 100 = 500 plus 500 transportation = 1000. After verify purchase I record the
 *    unit cost as 50, so the money going back is 500 - 5x50 = 250, not 1000 - 250 = 750, because
 *    500 was already used on transportation."
 *
 * One requisition, walked end to end with those exact figures, asserting **every** number every
 * screen shows at every stage. Written as one long scenario rather than six small tests on
 * purpose: the failure mode being hunted is not "a function returns the wrong value", it is "two
 * screens disagree about the same money", and that only shows up when the same run is asked the
 * same question in several places.
 *
 * The identity that has to hold throughout, and the reason transportation is the trap:
 *
 *     requested   = itemsEstimate + transportation
 *     cashOut     = funded − returned
 *     cashOut     = purchases + transportation          (once everything has settled)
 *     unspent     = funded − purchases − transportation − returned
 *
 * Transportation never appears in `purchases` — it is not a stock movement, so there is no row
 * for it. Any figure that means "what did this cost" and reads only `purchases` is therefore
 * short by exactly the transportation, silently, and stays short forever.
 */
describe('the money adds up, end to end', () => {
  let ctx: TestApp;
  let im: { id: string; client: HttpClient };
  let requester: { id: string; client: HttpClient };
  let approver: { id: string; client: HttpClient };
  let departmentId: string;
  let fixture: StockFixture;

  /* Ayman's numbers, named once. */
  const UNIT_ESTIMATE = 100;
  const UNITS = 5;
  const TRANSPORT = 500;
  const ITEMS_ESTIMATE = UNIT_ESTIMATE * UNITS; // 500
  const REQUESTED = ITEMS_ESTIMATE + TRANSPORT; // 1000
  const UNIT_ACTUAL = 50;
  const ITEMS_ACTUAL = UNIT_ACTUAL * UNITS; // 250
  const EXPECTED_UNSPENT = REQUESTED - ITEMS_ACTUAL - TRANSPORT; // 250

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

  /* ------------------------------------------------------------ the walk */

  it('folds transportation into the requested amount at submit', async () => {
    const req = await raise(LINKED());

    const detail = (await requester.client.get(`/requisitions/${req.id}`)).body;
    expect(detail.requestedAmount).toBe(REQUESTED);
    expect(detail.transportationCost).toBe(TRANSPORT);
  });

  it('keeps transportation inside the approved amount', async () => {
    const req = await approvedRequisition();

    const detail = (await requester.client.get(`/requisitions/${req.id}`)).body;
    expect(detail.approvedAmount).toBe(REQUESTED);
  });

  /**
   * The reported bug, stated as an assertion. If `unspent` came out at 750 the IM would be told
   * to hand back money they had already spent on the van.
   */
  it('offers back only what is genuinely unspent, with transportation already gone', async () => {
    const req = await purchased();

    const funding = await fundingOf(req.id);
    expect(funding.funded).toBe(REQUESTED);
    expect(funding.spent).toBe(ITEMS_ACTUAL);
    expect(funding.transportation).toBe(TRANSPORT);
    expect(funding.unspent).toBe(EXPECTED_UNSPENT);
    // The figure that says "this is what the company is out of pocket for".
    expect(funding.spentInclTransportation).toBe(ITEMS_ACTUAL + TRANSPORT);
  });

  it('refuses a return larger than the unspent balance', async () => {
    const req = await purchased();
    await attachInvoice(req.id);

    const tooMuch = await im.client
      .post(`/requisitions/${req.id}/verify-purchase`)
      .send({ returnedAmount: EXPECTED_UNSPENT + 1, returnNote: 'Over by one' });

    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.details.unspent).toBe(EXPECTED_UNSPENT);
  });

  it('balances once the unspent money has gone back', async () => {
    const req = await verified();

    const funding = await fundingOf(req.id);
    expect(funding.returned).toBe(EXPECTED_UNSPENT);
    expect(funding.unspent).toBe(0);

    // The identity: cash out = what was bought + what the van cost.
    const cashOut = funding.funded - funding.returned;
    expect(cashOut).toBe(ITEMS_ACTUAL + TRANSPORT);
    expect(cashOut).toBe(funding.spentInclTransportation);
    expect(funding.netFunded).toBe(cashOut);
  });

  /* -------------------------------------------- the same money, elsewhere */

  /**
   * The cross-screen check, and the one that catches a silent under-report. The funding panel
   * knows about transportation; the question is whether the report and the dashboard do.
   */
  it('reports the same spend on the expenses report as on the requisition', async () => {
    const req = await verified();
    const funding = await fundingOf(req.id);

    // Scoped to this test's own department. `resetData` deliberately leaves requisitions in place
    // (their event log is append-only), so an unscoped report carries every earlier test's money.
    const report = (await im.client.get(`/reports/expenses?departmentId=${departmentId}`)).body;
    expect(report.totals.funded).toBe(funding.funded);
    expect(report.totals.returned).toBe(funding.returned);
    expect(report.totals.netCash).toBe(funding.funded - funding.returned);
    // Money actually gone: the purchases *and* the transportation.
    expect(report.totals.spent).toBe(ITEMS_ACTUAL + TRANSPORT);
  });

  it('reports the same spend on the requester’s dashboard', async () => {
    await verified();

    const record = (await requester.client.get('/dashboard/me')).body as PersonalRecord;
    expect(record.spend.requested).toBe(REQUESTED);
    expect(record.spend.approved).toBe(REQUESTED);
    expect(record.spend.spent).toBe(ITEMS_ACTUAL + TRANSPORT);
  });

  /* --------------------------------------------------- the same product */

  /**
   * Ayman's second question: "we have 5 ESP in meta A1, we buy 5 more. While adding to inventory
   * it should go under the same ESP, no matter the location. So total ESP will be 10."
   *
   * That works only if the second requisition's line is *linked to the catalogue product*. When it
   * is, receiving into a different compartment adds a second placement under one product and the
   * totals roll up. When it is not — free text nobody picked from the list — a second product is
   * created and the two never add up again.
   */
  it('adds a repeat purchase to the same product, across two compartments', async () => {
    const first = await stocked(fixture.compartmentA, UNITS);
    expect(first).toBeTruthy();

    const before = await productTotals();
    expect(before.totalQuantity).toBe(UNITS);

    // Second buy of the same catalogue product, shelved somewhere else entirely.
    await stocked(fixture.compartmentB, UNITS);

    const after = await productTotals();
    expect(after.totalQuantity).toBe(UNITS * 2);

    // One product, two shelves — not two products.
    // One product row, not two: the second buy attached to the same catalogue entry.
    const productRows = await ctx.db
      .selectFrom('products')
      .where('category_id', '=', fixture.categoryId)
      .select('id')
      .execute();
    expect(productRows).toHaveLength(1);

    const placements = await ctx.db
      .selectFrom('stock_placements')
      .where('product_id', '=', fixture.productId)
      .select(['compartment_id', 'quantity'])
      .execute();
    expect(placements).toHaveLength(2);
    expect(placements.reduce((sum, row) => sum + row.quantity, 0)).toBe(UNITS * 2);
  });

  /**
   * The other half of the same question: what happens when nobody picked the product.
   *
   * Free text has to stay possible (requirements §3 — something we do not stock yet must still be
   * requestable), so the ambiguity cannot be forbidden at the form. It is resolved at the moment
   * the goods are in the IM's hands: they say which product this actually is, the requisition
   * item is repointed at it, and the units land on the existing product rather than a new one
   * that happens to share its name.
   */
  it('lets the IM attach a free-text line to the product it actually is', async () => {
    await stocked(fixture.compartmentA, UNITS);

    // Someone types the name instead of picking it. Same board, no link.
    const req = await freeTextRequisition('ESP32');
    const funding = await fundingOf(req.id);
    const line = funding.purchases[0]!.lines[0]!;

    const response = await im.client.post(`/requisitions/${req.id}/receive-to-stock`).send({
      lines: [
        {
          purchaseLineId: line.id,
          compartmentId: fixture.compartmentB,
          quantity: UNITS,
          existingProductId: fixture.productId,
        },
      ],
      note: null,
    });
    expect(response.status).toBe(200);

    // Ten of one product across two shelves — not five of each of two products.
    const totals = await productTotals();
    expect(totals.totalQuantity).toBe(UNITS * 2);

    const productRows = await ctx.db
      .selectFrom('products')
      .where('category_id', '=', fixture.categoryId)
      .select('id')
      .execute();
    expect(productRows).toHaveLength(1);

    // The requisition item now points at the real product, so any later receipt on it needs no
    // decision at all.
    const item = await ctx.db
      .selectFrom('requisition_items')
      .where('requisition_id', '=', req.id)
      .select('product_id')
      .executeTakeFirstOrThrow();
    expect(item.product_id).toBe(fixture.productId);
  });

  it('still refuses a free-text line with neither an existing product nor a new one', async () => {
    const req = await freeTextRequisition('Something we have never bought');
    const funding = await fundingOf(req.id);
    const line = funding.purchases[0]!.lines[0]!;

    const response = await im.client.post(`/requisitions/${req.id}/receive-to-stock`).send({
      lines: [
        { purchaseLineId: line.id, compartmentId: fixture.compartmentA, quantity: UNITS },
      ],
      note: null,
    });

    // Refused by the service, not the schema — both are 400 here, so the message is what tells
    // them apart. It names the item, which is the only way the IM knows which line to fix.
    expect(response.status).toBe(400);
    expect(response.body.details.message).toContain('Something we have never bought');
  });

  it('refuses a line that names both an existing product and a new one', async () => {
    const req = await freeTextRequisition('Ambiguous');
    const funding = await fundingOf(req.id);
    const line = funding.purchases[0]!.lines[0]!;

    const response = await im.client.post(`/requisitions/${req.id}/receive-to-stock`).send({
      lines: [
        {
          purchaseLineId: line.id,
          compartmentId: fixture.compartmentA,
          quantity: UNITS,
          existingProductId: fixture.productId,
          newProduct: {
            productCode: 'NEW-1',
            name: 'Ambiguous',
            categoryId: fixture.categoryId,
            unit: 'pcs',
          },
        },
      ],
      note: null,
    });

    expect(response.status).toBe(400);
  });

  /* --------------------------------------------------------------- helpers */

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const user = await createUser(ctx.db, { roles });
    const client = httpClient(ctx.app);
    const session = await login(client, user.email);
    return { id: user.id, client: client.as(session.accessToken) };
  }

  async function fundingOf(requisitionId: string): Promise<RequisitionFunding> {
    const response = await im.client.get(`/requisitions/${requisitionId}/funding`);
    expect(response.status).toBe(200);
    return response.body as RequisitionFunding;
  }

  async function productTotals(): Promise<{ totalQuantity: number }> {
    const response = await im.client.get(`/products/${fixture.productId}`);
    expect(response.status).toBe(200);
    return response.body as { totalQuantity: number };
  }

  /**
   * The same walk to PURCHASE_VERIFIED, but with the item typed rather than picked — so the
   * requisition line carries a name and no `productId`.
   */
  async function freeTextRequisition(itemName: string): Promise<{ id: string; itemId: string }> {
    const req = await raise({ itemName, productId: null });
    await approve(req);
    await buy(req);
    await attachInvoice(req.id);
    const verify = await im.client.post(`/requisitions/${req.id}/verify-purchase`).send({
      returnedAmount: EXPECTED_UNSPENT,
      returnNote: 'Bought under estimate',
    });
    expect(verify.status).toBe(200);
    return req;
  }

  /**
   * A draft carrying both halves of the money: five items at 100, and a 500 van.
   *
   * `item` is passed explicitly by every caller rather than defaulted. A default here would read
   * from `fixture` at call time and quietly re-supply the catalogue link in the very test that
   * exists to check what happens without one — which is exactly how a green test can assert
   * nothing at all.
   */
  async function raise(item: {
    itemName: string;
    productId: string | null;
  }): Promise<{ id: string; itemId: string }> {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Money audit',
      transportationCost: TRANSPORT,
      transportationDescription: 'Van hire to the warehouse',
      items: [
        {
          itemName: item.itemName,
          quantity: UNITS,
          estimatedUnitPrice: UNIT_ESTIMATE,
          // Null here is the free-text case: nobody picked from the catalogue.
          productId: item.productId,
          note: null,
        },
      ],
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const submitted = await requester.client.post(`/requisitions/${id}/submit`).send();
    expect(submitted.status).toBe(200);

    const detail = (await requester.client.get(`/requisitions/${id}`)).body;
    return { id, itemId: detail.items[0].id as string };
  }

  /** The catalogue-linked default: the requester picked ESP32 from the list. */
  const LINKED = () => ({ itemName: 'ESP32', productId: fixture.productId });

  async function approvedRequisition(): Promise<{ id: string; itemId: string }> {
    const req = await raise(LINKED());
    await approve(req);
    return req;
  }

  async function approve(req: { id: string; itemId: string }): Promise<void> {
    const detail = (await im.client.get(`/requisitions/${req.id}`)).body;
    const imApproval = detail.approvals.find(
      (a: { stage: string }) => a.stage === 'INVENTORY_MANAGER',
    );
    const afterIm = (
      await im.client.post(`/requisitions/approvals/${imApproval.id}/decision`).send({ approve: true })
    ).body;
    const approverApproval = afterIm.approvals.find(
      (a: { stage: string }) => a.stage === 'APPROVER',
    );
    await approver.client
      .post(`/requisitions/approvals/${approverApproval.id}/decision`)
      .send({ approve: true });
  }

  /** Approved, BOM'd, sent, funded in full, and bought at the real price. */
  async function purchased(): Promise<{ id: string; itemId: string }> {
    const req = await approvedRequisition();
    await buy(req);
    return req;
  }

  async function buy(req: { id: string; itemId: string }): Promise<void> {
    const bom = await im.client.post('/boms').send({
      requisitionIds: [req.id],
      lines: [
        { requisitionItemId: req.itemId, unitCost: UNIT_ESTIMATE, vendor: 'Techshop BD' },
      ],
    });
    expect(bom.status).toBe(201);

    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();
    const funded = await im.client
      .post(`/requisitions/${req.id}/fund-receipts`)
      .send({ amount: REQUESTED, receivedAt: new Date().toISOString() });
    expect(funded.status).toBe(201);

    const purchase = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Techshop BD',
      invoiceNo: 'INV-AUDIT',
      purchasedAt: new Date().toISOString(),
      note: null,
      lines: [{ requisitionItemId: req.itemId, quantity: UNITS, unitCost: UNIT_ACTUAL }],
    });
    expect(purchase.status).toBe(201);
  }

  async function attachInvoice(requisitionId: string): Promise<void> {
    const funding = await fundingOf(requisitionId);
    const uploaded = await im.client
      .post(`/requisitions/${requisitionId}/purchases/${funding.purchases[0]!.id}/invoice`)
      .attach('file', Buffer.from('%PDF-1.4 invoice'), 'invoice.pdf');
    expect(uploaded.status).toBe(200);
  }

  /** Verified, with the genuinely unspent balance handed back. */
  async function verified(): Promise<{ id: string; itemId: string }> {
    const req = await purchased();
    await attachInvoice(req.id);

    const response = await im.client.post(`/requisitions/${req.id}/verify-purchase`).send({
      returnedAmount: EXPECTED_UNSPENT,
      returnNote: 'Bought under estimate',
    });
    expect(response.status).toBe(200);
    return req;
  }

  /** All the way onto a shelf, in the compartment given. */
  async function stocked(compartmentId: string, quantity: number): Promise<string> {
    const req = await verified();
    const funding = await fundingOf(req.id);
    const line = funding.purchases[0]!.lines[0]!;

    const response = await im.client.post(`/requisitions/${req.id}/receive-to-stock`).send({
      lines: [{ purchaseLineId: line.id, compartmentId, quantity }],
      note: null,
    });
    expect(response.status).toBe(200);
    return req.id;
  }
});
