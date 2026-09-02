import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role, type RequisitionFunding } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import {
  createDepartment,
  createUser,
  login,
  resetData,
  seedSubthresholdApprover,
  futureDeadline,
} from './factories';

/**
 * Instalments are switched off for this release (Ayman, 2026-09-02).
 *
 * Its own file, and deliberately **without** a config override: this is the one suite that has to
 * run under exactly what production ships, because what it asserts is that the flag is off and
 * that the API says so.
 *
 * These two lived in `funds.int-spec.ts` until that file gained an override building its app with
 * instalments *on* — it is about what happens once a requisition holds several receipts, a state
 * an upward revision of the approved amount still reaches. Both tests then started getting 201
 * where they expect 409: the flag they assert is off was on around them. Two suites wanting
 * opposite configs is what separate files are for.
 */
describe('partial funding, while it is switched off', () => {
  let ctx: TestApp;
  let im: { id: string; client: HttpClient };
  let requester: { id: string; client: HttpClient };
  let approver: { id: string; client: HttpClient };
  let departmentId: string;

  beforeAll(async () => {
    // No overrides. The production config is the subject.
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

  /** A requisition carried as far as a BOM, which is where the money chain starts. */
  async function requisitionOnBom(amount: number): Promise<{ id: string; itemId: string }> {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Partial funding fixture',
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
   * This previously asserted the opposite — that a 2,000 receipt against a 5,000 approval was
   * accepted, reported `FUNDS_PARTIAL`, and could be topped up later. That behaviour is not
   * broken; it is deferred, because the half that matters (returning the balance, and reconciling
   * a part-funded requisition across three surfaces) was never finished.
   */
  it('refuses an instalment', async () => {
    const req = await requisitionOnBom(5000);
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();

    const short = await im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
      amount: 2000,
      receivedAt: new Date().toISOString(),
    });

    expect(short.status).toBe(409);
    expect(short.body.code).toBe(ErrorCode.PARTIAL_FUNDING_DISABLED);
    // The refusal names the only acceptable figure, so the IM is not left guessing.
    expect(short.body.details).toMatchObject({ outstanding: 5000, attempted: 2000 });
    // Nothing written: a refused receipt must not leave a partial trace.
    expect(await statusOf(req.id)).toBe('SENT_TO_ACCOUNTS');
  });

  it('takes the whole outstanding balance in one payment', async () => {
    const req = await requisitionOnBom(5000);
    await im.client.post(`/requisitions/${req.id}/send-to-accounts`).send();

    const paid = await im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
      amount: 5000,
      receivedAt: new Date().toISOString(),
    });

    expect(paid.status).toBe(201);
    const funding = paid.body as RequisitionFunding;
    expect(funding.funded).toBe(5000);
    expect(funding.outstanding).toBe(0);
    expect(funding.isFullyFunded).toBe(true);
    // The client is told the policy, so the dialog does not offer a field the API would refuse.
    expect(funding.allowsPartialFunding).toBe(false);
    expect(await statusOf(req.id)).toBe('FUNDS_RECEIVED');
  });
});
