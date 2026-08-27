import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Role,
  type BomDetail,
  type PersonalRecord,
  type RequisitionFunding,
} from '@ims/shared';
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
import { renderBomHtml } from '../src/modules/boms/bom-pdf.template';

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

  /**
   * The same minimal render context the other BOM PDF specs use. The letterhead is not what is
   * under audit here; the figures beneath it are.
   */
  const PDF_CONTEXT = {
    company: {
      name: 'Southern IoT',
      addressLines: ['House 26, Road 13, Sector 14', 'Uttara, Dhaka - 1230', 'Bangladesh'],
      logoUri: null,
    },
    signatureUris: {},
  };

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

  /* ------------------------------------------- the carriage on a reversal */

  /**
   * OQ-32. The reversals (`215b3cf`) landed before the transportation fix (`f7c7f72`) and the two
   * were never reconciled, so what a void does to the carriage was asserted nowhere — the report
   * and the dashboard happened to drop it because their `EXISTS` clause already said
   * `voided_at IS NULL`, and the funding panel happened to keep it because it reads the column
   * unconditionally. Two screens, two answers, neither of them decided.
   *
   * Decided (OQ-32): **transportation is spent money only while a live purchase stands.** It is
   * an estimate typed on the draft, not a recorded expense — there is no "carriage paid" row
   * anywhere — so the only thing that ever makes it real is being attributed to something bought.
   * Void the last purchase and nothing has been bought, so nothing has been carried, and the cash
   * the IM is holding is the whole grant again.
   */
  it('takes the carriage out of the funding panel with the purchase', async () => {
    const req = await purchased();

    const before = await fundingOf(req.id);
    expect(before.spent).toBe(ITEMS_ACTUAL);
    expect(before.transportation).toBe(TRANSPORT);
    expect(before.spentInclTransportation).toBe(ITEMS_ACTUAL + TRANSPORT);
    expect(before.unspent).toBe(EXPECTED_UNSPENT);

    await voidThePurchase(req.id);

    const after = await fundingOf(req.id);
    expect(after.spent).toBe(0);
    // Nothing bought, so nothing carried.
    expect(after.transportation).toBe(0);
    expect(after.spentInclTransportation).toBe(0);
    // The whole grant is back in the IM's hands and can be handed back in full.
    expect(after.unspent).toBe(REQUESTED);
  });

  it('takes the carriage out of the expenses report with the purchase', async () => {
    const req = await purchased();
    await voidThePurchase(req.id);

    const report = (await im.client.get(`/reports/expenses?departmentId=${departmentId}`)).body;
    expect(report.totals.funded).toBe(REQUESTED);
    expect(report.totals.purchased).toBe(0);
    expect(report.totals.transportation).toBe(0);
    expect(report.totals.spent).toBe(0);
    // Money is still out of the door — it is sitting with the IM, not spent.
    expect(report.totals.netCash).toBe(REQUESTED);
  });

  it('takes the carriage out of the requester’s dashboard with the purchase', async () => {
    const req = await purchased();
    await voidThePurchase(req.id);

    const record = (await requester.client.get('/dashboard/me')).body as PersonalRecord;
    expect(record.spend.requested).toBe(REQUESTED);
    expect(record.spend.purchased).toBe(0);
    expect(record.spend.transportation).toBe(0);
    expect(record.spend.spent).toBe(0);
  });

  /**
   * The same rule stated where it bites first: money has arrived and nothing has been bought yet.
   * The void case is only this case reached backwards, and a funding panel that charges the van
   * before anything has been carried tells the IM 500 of the 1,000 in their hand is already gone.
   */
  it('does not charge the van before anything has been bought', async () => {
    const req = await fundedOnly();

    const funding = await fundingOf(req.id);
    expect(funding.funded).toBe(REQUESTED);
    expect(funding.spent).toBe(0);
    expect(funding.transportation).toBe(0);
    expect(funding.unspent).toBe(REQUESTED);
  });

  /**
   * A split-vendor requisition keeps its carriage while any purchase still stands — the van was
   * hired once for a delivery that is still on the record. Voiding one of two purchases is not
   * "nothing was bought".
   */
  it('keeps the carriage while a second purchase still stands', async () => {
    const req = await fundedOnly();

    const first = await recordPurchase(req, 'Techshop BD', 2);
    await recordPurchase(req, 'Second vendor', 3);

    await voidPurchaseById(req.id, first);

    const funding = await fundingOf(req.id);
    expect(funding.spent).toBe(UNIT_ACTUAL * 3);
    expect(funding.transportation).toBe(TRANSPORT);
    expect(funding.spentInclTransportation).toBe(UNIT_ACTUAL * 3 + TRANSPORT);
  });

  /* ---------------------------------------------------- the same money, printed */

  /**
   * The last surface in this scenario that prints a money figure and had never been walked with
   * these numbers. `bom-transportation.int-spec.ts` proves the reconciliation on 1,000 + 200; this
   * proves it on the requisition the rest of the file audits, which is the one Ayman reads.
   *
   * The BOM is the buy list Accounts is handed, so it prints the **estimate**: five at 100 and a
   * 500 van, grand total 1,000, reconciling against the header's requested and approved. The 250
   * actually paid later belongs to the funding panel and the expenses report, not here.
   */
  it('prints items, carriage and a grand total that reconcile with the header', async () => {
    const req = await approvedRequisition();
    const bom = await bomFor(req);

    const html = renderBomHtml(bom, PDF_CONTEXT);

    // Anchored on each label, so a match cannot be satisfied by the header figure nearby.
    expect(html).toMatch(/Items subtotal[\s\S]{0,80}500\.00/);
    expect(html).toMatch(/<tr class="transportation">/);
    expect(html).toMatch(/Grand total[\s\S]{0,80}1,000\.00/);
    expect(html).toMatch(/Total Money Requested[\s\S]{0,120}1,000\.00/);
    expect(html).toMatch(/Approved Money[\s\S]{0,120}1,000\.00/);
    expect(html).toContain('Van hire to the warehouse');
  });

  /**
   * OQ-32 stops at the BOM, deliberately. The rule says transportation is *spent* only while a
   * live purchase stands — and the BOM prints what was asked for, not what was spent, so nothing
   * on it moves when the money does. A BOM re-rendered after the purchase is voided must still be
   * the document Accounts was given, or the paper trail stops matching the paperwork.
   */
  it('prints the same figures after the purchase is recorded and after it is voided', async () => {
    const req = await approvedRequisition();
    const created = await bomFor(req);
    const asIssued = renderBomHtml(created, PDF_CONTEXT);

    await fundFor(req);
    await recordPurchase(req, 'Techshop BD', UNITS);
    const afterPurchase = renderBomHtml(await bomDetail(created.id), PDF_CONTEXT);

    await voidThePurchase(req.id);
    const afterVoid = renderBomHtml(await bomDetail(created.id), PDF_CONTEXT);

    for (const html of [afterPurchase, afterVoid]) {
      expect(html).toMatch(/Items subtotal[\s\S]{0,80}500\.00/);
      expect(html).toMatch(/Grand total[\s\S]{0,80}1,000\.00/);
    }
    // The whole document, not just the totals: nothing the buy list says is a function of what
    // was later paid for it.
    expect(afterPurchase).toBe(asIssued);
    expect(afterVoid).toBe(asIssued);
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

  /**
   * Void the requisition's only live purchase. `funding.purchases` already excludes voided
   * rows (`listPurchases` filters on `voided_at IS NULL`), so one element here is the live one.
   */
  async function voidThePurchase(requisitionId: string): Promise<void> {
    const funding = await fundingOf(requisitionId);
    expect(funding.purchases).toHaveLength(1);
    await voidPurchaseById(requisitionId, funding.purchases[0]!.id);
  }

  async function voidPurchaseById(requisitionId: string, purchaseId: string): Promise<void> {
    const response = await im.client
      .post(`/requisitions/${requisitionId}/purchases/${purchaseId}/void`)
      .send({ reason: 'Recorded against the wrong vendor' });
    expect(response.status).toBe(200);
  }

  /** BOM'd, sent to Accounts and funded in full — but nothing bought yet. */
  async function fundedOnly(): Promise<{ id: string; itemId: string }> {
    const req = await approvedRequisition();
    await bomFor(req);
    await fundFor(req);
    return req;
  }

  /** The buy list Accounts is handed: the one item at its estimate. Returns what was created. */
  async function bomFor(req: { id: string; itemId: string }): Promise<BomDetail> {
    const created = await im.client.post('/boms').send({
      requisitionIds: [req.id],
      lines: [{ requisitionItemId: req.itemId, unitCost: UNIT_ESTIMATE, vendor: 'Techshop BD' }],
    });
    expect(created.status).toBe(201);
    return created.body as BomDetail;
  }

  /** Re-read a BOM the way a re-render would, rather than reusing the creation response. */
  async function bomDetail(bomId: string): Promise<BomDetail> {
    const response = await im.client.get(`/boms/${bomId}`);
    expect(response.status).toBe(200);
    return response.body as BomDetail;
  }

  /** On the Accounts queue and funded in full. The BOM is `bomFor`, called separately. */
  async function fundFor(req: { id: string; itemId: string }): Promise<void> {
    // Asserted, not fired and forgotten: this call refuses a requisition with no live BOM, and
    // an unchecked failure here surfaces as a 409 on the *next* call for no visible reason.
    const sent = await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();
    expect(sent.status).toBe(200);
    const funded = await im.client
      .post(`/requisitions/${req.id}/fund-receipts`)
      .send({ amount: REQUESTED, receivedAt: new Date().toISOString() });
    expect(funded.status).toBe(201);
  }

  /**
   * One purchase of `units` at the real unit cost, from the vendor named. Found by vendor
   * rather than by position: two purchases recorded in the same millisecond order arbitrarily
   * under `ORDER BY purchased_at`, and voiding the wrong one would still pass.
   */
  async function recordPurchase(
    req: { id: string; itemId: string },
    vendor: string,
    units: number,
  ): Promise<string> {
    const purchase = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor,
      invoiceNo: `INV-${vendor}`,
      purchasedAt: new Date().toISOString(),
      note: null,
      lines: [{ requisitionItemId: req.itemId, quantity: units, unitCost: UNIT_ACTUAL }],
    });
    expect(purchase.status).toBe(201);
    const funding = purchase.body as RequisitionFunding;
    const mine = funding.purchases.find((row) => row.vendor === vendor);
    expect(mine).toBeTruthy();
    return mine!.id;
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
    await bomFor(req);
    await fundFor(req);
    await recordPurchase(req, 'Techshop BD', UNITS);
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
