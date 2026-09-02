import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type RequisitionFunding } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createDepartment, createUser, login, resetData, seedSubthresholdApprover , futureDeadline} from './factories';

/**
 * Regression coverage for the append-only funding_snapshots history used by the detail page.
 * The tests deliberately inspect both the raw rows and the two HTTP contracts: detail is
 * additive, while the funding summary remains the live aggregate shape.
 */
describe('funding snapshots', () => {
  let ctx: TestApp;
  let im: { id: string; client: HttpClient };
  let requester: { id: string; client: HttpClient };
  let approver: { id: string; client: HttpClient };
  let departmentId: string;

  beforeAll(async () => {
      // Revising the sanctioned amount is off in production for this release. These tests are
      // about what happens *once* a figure has been revised, so the app is built with it on —
      // that is what the CONFIG override on createTestApp exists for.
    ctx = await createTestApp({ money: { allowApprovedAmountRevision: true } });
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

  it('writes one zero-money snapshot when a requisition is submitted', async () => {
    const created = await createRequisition(4178);
    const submitted = await requester.client.post(`/requisitions/${created.id}/submit`).send();
    expect(submitted.status).toBe(200);

    const rows = await snapshotRows(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'IM_REVIEW',
      requested_amount: '4178.00',
      approved_amount: '4178.00',
      transportation: '0.00',
      funded: '0.00',
      spent: '0.00',
      returned_to_accounts: '0.00',
      unspent: '0.00',
    });
  });

  it('captures a revised approved amount while requested amount stays frozen', async () => {
    const created = await createRequisition(4178);
    const submitted = (await requester.client.post(`/requisitions/${created.id}/submit`).send()).body;
    const imApprovalId = submitted.approvals.find(
      (approval: { stage: string }) => approval.stage === 'INVENTORY_MANAGER',
    ).id;
    const afterIm = (
      await im.client.post(`/requisitions/approvals/${imApprovalId}/decision`).send({ approve: true })
    ).body;
    const approverApprovalId = afterIm.approvals.find(
      (approval: { stage: string }) => approval.stage === 'APPROVER',
    ).id;

    const final = await approver.client
      .post(`/requisitions/approvals/${approverApprovalId}/decision`)
      .send({ approve: true, approvedAmount: 3000 });
    expect(final.status).toBe(200);

    const rows = await snapshotRows(created.id);
    expect(rows.map((row) => row.status)).toEqual(['IM_REVIEW', 'AWAITING_APPROVAL', 'APPROVED']);
    const approved = rows.find((row) => row.status === 'APPROVED');
    expect(approved).toMatchObject({
      requested_amount: '4178.00',
      approved_amount: '3000.00',
      funded: '0.00',
      spent: '0.00',
      unspent: '0.00',
    });
  });

  it('records forward funds stages and keeps multiple PURCHASED rows append-only', async () => {
    const requisition = await requisitionOnBom(5000);

    const sent = await im.client.post(`/requisitions/${requisition.id}/send-to-accounts`).send();
    expect(sent.status).toBe(200);
    await im.client.post(`/requisitions/${requisition.id}/fund-receipts`).send({
      amount: 5000,
      receivedAt: new Date().toISOString(),
    });

    const firstPurchase = await im.client.post(`/requisitions/${requisition.id}/purchases`).send({
      vendor: 'First vendor',
      purchasedAt: new Date().toISOString(),
      lines: [{ requisitionItemId: requisition.itemId, quantity: 1, unitCost: 1000 }],
    });
    expect(firstPurchase.status).toBe(201);
    const secondPurchase = await im.client.post(`/requisitions/${requisition.id}/purchases`).send({
      vendor: 'Second vendor',
      purchasedAt: new Date().toISOString(),
      lines: [{ requisitionItemId: requisition.itemId, quantity: 1, unitCost: 500 }],
    });
    expect(secondPurchase.status).toBe(201);

    const purchaseRows = await snapshotRows(requisition.id);
    expect(purchaseRows.filter((row) => row.status === 'PURCHASED')).toHaveLength(2);
    expect(purchaseRows.map((row) => row.status)).toEqual([
      'IM_REVIEW',
      'AWAITING_APPROVAL',
      'APPROVED',
      'BOM_GENERATED',
      'SENT_TO_ACCOUNTS',
      'FUNDS_RECEIVED',
      'PURCHASED',
      'PURCHASED',
    ]);

    const detail = await requester.client.get(`/requisitions/${requisition.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.fundingSnapshots).toHaveLength(7);
    const purchasedSnapshot = detail.body.fundingSnapshots.find(
      (snapshot: { status: string }) => snapshot.status === 'PURCHASED',
    );
    expect(purchasedSnapshot).toMatchObject({
      status: 'PURCHASED',
      funded: 5000,
      spent: 1500,
      requestedAmount: 5000,
      approvedAmount: 5000,
    });
  });

  it('preserves the funding endpoint response shape without snapshot history', async () => {
    const requisition = await requisitionOnBom(5000);
    await im.client.post(`/requisitions/${requisition.id}/send-to-accounts`).send();
    const response = await im.client.get(`/requisitions/${requisition.id}/funding`);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual([
      // Added 2026-09-02: the client is told whether instalments are allowed, so the dialog
      // does not offer an amount field the API would refuse.
      'allowsPartialFunding',
      'approvedAmount',
      'funded',
      'isFullyFunded',
      'netFunded',
      'outstanding',
      'purchases',
      'receipts',
      'requestedAmount',
      'requisitionId',
      'returned',
      'returns',
      'spent',
      'spentInclTransportation',
      'transportation',
      'unspent',
    ]);
    expect(response.body).not.toHaveProperty('fundingSnapshots');
  });

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const user = await createUser(ctx.db, { roles });
    const client = httpClient(ctx.app);
    const session = await login(client, user.email);
    return { id: user.id, client: client.as(session.accessToken) };
  }

  async function createRequisition(amount: number): Promise<{ id: string; itemId: string }> {
    const response = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Funding snapshot test',
      items: [{ itemName: 'Widget', quantity: 1, estimatedUnitPrice: amount, productId: null, note: null }],
    });
    expect(response.status).toBe(201);
    return { id: response.body.id as string, itemId: '' };
  }

  async function requisitionOnBom(amount: number): Promise<{ id: string; itemId: string }> {
    const created = await createRequisition(amount);
    const submitted = (await requester.client.post(`/requisitions/${created.id}/submit`).send()).body;
    const imApprovalId = submitted.approvals.find(
      (approval: { stage: string }) => approval.stage === 'INVENTORY_MANAGER',
    ).id;
    const afterIm = (
      await im.client.post(`/requisitions/approvals/${imApprovalId}/decision`).send({ approve: true })
    ).body;
    const approverApprovalId = afterIm.approvals.find(
      (approval: { stage: string }) => approval.stage === 'APPROVER',
    ).id;
    await approver.client
      .post(`/requisitions/approvals/${approverApprovalId}/decision`)
      .send({ approve: true });

    const detail = (await requester.client.get(`/requisitions/${created.id}`)).body;
    const itemId = detail.items[0].id as string;
    const bom = await im.client.post('/boms').send({
      requisitionIds: [created.id],
      lines: [{ requisitionItemId: itemId, unitCost: amount, vendor: 'Snapshot vendor' }],
    });
    expect(bom.status).toBe(201);
    return { id: created.id, itemId };
  }

  async function snapshotRows(requisitionId: string) {
    return ctx.db
      .selectFrom('funding_snapshots')
      .where('requisition_id', '=', requisitionId)
      .selectAll()
      .orderBy('snapshotted_at')
      .execute();
  }
});
