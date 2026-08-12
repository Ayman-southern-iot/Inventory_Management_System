import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createDepartment, createUser, login, resetData, seedSubthresholdApprover } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';

/**
 * Issue 5 (operator, 2026-08-12): `recordPurchase` was writing the wire quantity straight
 * to `purchase_lines.quantity` and `bom_line_id = null`, ignoring the IM's BOM override.
 *
 * Concretely: a requisition asks for 50 units, the IM shrinks the BOM line to 30 (e.g.
 * they sourced a cheaper alternative), and the wire submits `quantity: 50` (the
 * requisition quantity still echoed in the dialog). The old behaviour wrote 50 to the
 * purchase line and 50 to inventory on receive. The new behaviour treats the BOM as a
 * ceiling — the server records the BOM quantity, sets `bom_line_id`, and flags
 * `over_bom_quantity` if the wire exceeded the BOM (because the IM did it knowingly).
 */
describe('recordPurchase — BOM quantity override', () => {
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

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const user = await createUser(ctx.db, { roles });
    const client = httpClient(ctx.app);
    const session = await login(client, user.email);
    return { id: user.id, client: client.as(session.accessToken) };
  }

  /**
   * Approve a requisition whose original quantity is 50 but whose BOM is shrunk to 30.
   * Returns the requisition id and item id so the test can drive `recordPurchase` with
   * whatever wire payload it wants.
   */
  async function requisitionWithShrunkBom(
    originalQuantity: number,
    bomQuantity: number,
    unitCost: number,
  ): Promise<{ id: string; itemId: string }> {
    const created = await requester.client.post('/requisitions').send({
      departmentId,
      urgency: 'NORMAL',
      reason: 'BOM-quantity override test',
      items: [
        {
          itemName: 'Steel bar 12mm',
          quantity: originalQuantity,
          estimatedUnitPrice: unitCost,
          productId: null,
          note: null,
        },
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

    // Generate a BOM with the IM's quantity override (shrunk) — the wire would normally
    // use the requisition's quantity, but the customiser lets the IM shrink it.
    const bom = await im.client.post('/boms').send({
      requisitionIds: [id],
      lines: [
        {
          requisitionItemId: itemId,
          quantity: bomQuantity,
          unitCost,
          vendor: 'Acme Steel',
        },
      ],
    });
    expect(bom.status).toBe(201);

    return { id, itemId };
  }

  async function driveToFundsReceived(id: string, amount: number): Promise<void> {
    await im.client.post(`/requisitions/${id}/send-to-accounts`).send();
    const funded = await im.client.post(`/requisitions/${id}/fund-receipts`).send({
      amount,
      receivedAt: new Date().toISOString(),
      reference: 'CHQ-001',
      note: null,
    });
    expect(funded.status).toBe(201);
  }

  it('cap wire quantity to the BOM ceiling when the wire exceeds the BOM', async () => {
    const req = await requisitionWithShrunkBom(50, 30, 250);
    await driveToFundsReceived(req.id, 50 * 250);

    // Wire submits 50 (the original quantity echoed in the dialog). The server should
    // record 30 because that is the BOM quantity. The IM's intent flows this way:
    // the dialog reads BOM quantity, but if a legacy client still submits 50, the
    // persisted row still reflects what was actually bought (30).
    const purchased = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Acme Steel',
      invoiceNo: 'INV-001',
      purchasedAt: new Date().toISOString(),
      note: null,
      lines: [
        {
          requisitionItemId: req.itemId,
          quantity: 50,
          unitCost: 250,
          overBomQuantity: false,
          overBomNote: null,
        },
      ],
    });
    expect(purchased.status).toBe(201);

    // Read the persisted row directly — the funding view does not expose `bom_line_id`,
    // so we hit the DB to assert the override actually landed.
    const rows = await ctx.db
      .selectFrom('purchase_lines as pl')
      .innerJoin('purchases as p', 'p.id', 'pl.purchase_id')
      .select(['pl.quantity', 'pl.bom_line_id', 'pl.over_bom_quantity'])
      .where('p.requisition_id', '=', req.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe(30);
    expect(rows[0]!.bom_line_id).not.toBeNull();
    expect(rows[0]!.over_bom_quantity).toBe(true);
  });

  it('honours a partial purchase (wire below BOM) — wire wins because it is the actual buy', async () => {
    const req = await requisitionWithShrunkBom(50, 30, 250);
    await driveToFundsReceived(req.id, 50 * 250);

    const purchased = await im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'Acme Steel',
      invoiceNo: 'INV-002',
      purchasedAt: new Date().toISOString(),
      note: null,
      lines: [
        {
          requisitionItemId: req.itemId,
          quantity: 20,
          unitCost: 250,
          overBomQuantity: false,
          overBomNote: null,
        },
      ],
    });
    expect(purchased.status).toBe(201);

    const rows = await ctx.db
      .selectFrom('purchase_lines as pl')
      .innerJoin('purchases as p', 'p.id', 'pl.purchase_id')
      .select(['pl.quantity', 'pl.bom_line_id', 'pl.over_bom_quantity'])
      .where('p.requisition_id', '=', req.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe(20);
    expect(rows[0]!.bom_line_id).not.toBeNull();
    expect(rows[0]!.over_bom_quantity).toBe(false);
  });

  it('returns an empty map from getLiveBomForRequisition when no live BOM exists', async () => {
    // The "no live BOM" fallback only triggers for legacy pre-BOM requisitions — a
    // requisition that reaches the funds flow always has one. The end-to-end fallback
    // path is therefore unreachable through the funds API. Test the repository method
    // directly to lock in the contract `recordPurchase` relies on: an empty map means
    // "wire quantity wins".
    const { FundsRepository } = await import('../src/modules/funds/funds.repository');
    const repo = new FundsRepository(ctx.db);

    // Build a requisition but never generate a BOM.
    const created = await requester.client.post('/requisitions').send({
      departmentId,
      urgency: 'NORMAL',
      reason: 'No-BOM repo contract',
      items: [
        {
          itemName: 'Widget',
          quantity: 10,
          estimatedUnitPrice: 100,
          productId: null,
          note: null,
        },
      ],
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const map = await repo.getLiveBomForRequisition(id);
    expect(map.size).toBe(0);
  });
});
