import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  ErrorCode,
  RequisitionEventType,
  RequisitionStatus,
  Role,
} from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData, seedSubthresholdApprover , futureDeadline} from './factories';

interface Actor {
  id: string;
  client: HttpClient;
}

/**
 * Single-item + over-budget send-back-for-revision branch.
 *
 * On a single-item requisition where the approved amount came in below the requested
 * one, the IM cannot shrink the BOM lines (there is only one). The IM bounces the
 * requisition back to the requester for budget revision. The status flips to DRAFT;
 * the requester re-submits and the chain replays.
 *
 * Cases:
 *   1. Happy path: 1-item + over-budget → 200, status DRAFT, requiresRevisionTag true
 *   2. Refuses on a non-APPROVED requisition
 *   3. Refuses on a multi-item requisition (the BOM-customise path is the legitimate one)
 *   4. After send-back, requester re-submits → status AWAITING_APPROVAL, fresh approvers,
 *      revisedAfterSendBack true
 */
describe('Requisitions — send back for revision', () => {
  let ctx: TestApp;
  let requester: Actor;
  let im: Actor;
  let approver1: Actor;
  let approver2: Actor;
  let departmentId: string;

  const actorFor = async (roles: Role[]): Promise<Actor> => {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return { id: user.id, client: http.as(session.accessToken) };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);

    requester = await actorFor([Role.GENERAL]);
    im = await actorFor([Role.GENERAL, Role.INVENTORY_MANAGER]);
    approver1 = await actorFor([Role.GENERAL, Role.APPROVER]);
    approver2 = await actorFor([Role.GENERAL, Role.APPROVER]);

    const department = await ctx.db
      .insertInto('departments')
      .values({ name: `Dept ${Date.now()}-${Math.random()}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    departmentId = department.id;

    await ctx.db
      .insertInto('approver_slots')
      .values([
        { department_id: null, slot_no: 1, user_id: approver1.id },
        { department_id: null, slot_no: 2, user_id: approver2.id },
      ])
      .execute();

    await seedSubthresholdApprover(ctx, approver1.id);
  });

  /**
   * Drive a single-item requisition to APPROVED at the supplied `approvedAmount`. The IM stage
   * stamps `approvedAmount` directly; the original chain then plays out.
   */
  const approveSingleItem = async (
    requestedAmount: number,
    approvedAmount: number,
  ) => {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Test requisition',
      items: [
        {
          itemName: 'Single widget',
          quantity: 1,
          estimatedUnitPrice: requestedAmount,
          productId: null,
          note: null,
        },
      ],
    });
    expect(created.status).toBe(201);

    const submitted = (
      await requester.client.post(`/requisitions/${created.body.id}/submit`).send()
    ).body;
    const imApprovalId = submitted.approvals.find(
      (a: { stage: string }) => a.stage === 'INVENTORY_MANAGER',
    ).id;
    const afterIm = await im.client
      .post(`/requisitions/approvals/${imApprovalId}/decision`)
      .send({ approve: true, approvedAmount });

    const approverCount = submitted.requiredApproverCount as number;
    expect([1, 2]).toContain(approverCount);

    for (let slot = 1; slot <= approverCount; slot += 1) {
      const approvalId = afterIm.body.approvals.find(
        (a: { stage: string; slot: number }) => a.stage === 'APPROVER' && a.slot === slot,
      )?.id;
      expect(approvalId).toBeDefined();
      await approver1.client
        .post(`/requisitions/approvals/${approvalId}/decision`)
        .send({ approve: true });
    }

    return (await requester.client.get(`/requisitions/${created.body.id}`)).body as {
      id: string;
      requisitionNo: string;
      approvedAmount: number;
    };
  };

  /** Drive a multi-item requisition to APPROVED. */
  const approveMultiItem = async (items: Array<{ quantity: number; unitPrice: number }>) => {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Multi-item test',
      items: items.map((item, i) => ({
        itemName: `Item ${i + 1}`,
        quantity: item.quantity,
        estimatedUnitPrice: item.unitPrice,
        productId: null,
        note: null,
      })),
    });
    expect(created.status).toBe(201);

    const submitted = (
      await requester.client.post(`/requisitions/${created.body.id}/submit`).send()
    ).body;
    const imApprovalId = submitted.approvals.find(
      (a: { stage: string }) => a.stage === 'INVENTORY_MANAGER',
    ).id;
    const afterIm = await im.client
      .post(`/requisitions/approvals/${imApprovalId}/decision`)
      .send({ approve: true });

    const approverCount = submitted.requiredApproverCount as number;
    expect([1, 2]).toContain(approverCount);

    for (let slot = 1; slot <= approverCount; slot += 1) {
      const approvalId = afterIm.body.approvals.find(
        (a: { stage: string; slot: number }) => a.stage === 'APPROVER' && a.slot === slot,
      )?.id;
      expect(approvalId).toBeDefined();
      // Each slot is assigned to a different approver. The slot N actor decides via
      // the client whose user owns that slot — using the wrong one would 403.
      const actor = slot === 1 ? approver1 : approver2;
      await actor.client
        .post(`/requisitions/approvals/${approvalId}/decision`)
        .send({ approve: true });
    }

    return created.body.id as string;
  };

  it('bounces a single-item over-budget requisition back to the requester (happy path)', async () => {
    // Requested 12,500 for one item. Approved at 10,000. The IM cannot shrink a 1-item
    // BOM, so the send-back path is the legitimate route.
    const req = await approveSingleItem(12_500, 10_000);

    const response = await im.client
      .post(`/requisitions/${req.id}/send-back-for-revision`)
      .send({ reason: 'Approved amount is too low — please revise the budget' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(RequisitionStatus.DRAFT);
    // The pill flags come from the events log; on a DRAFT that has just been sent back,
    // the most recent event is SEND_BACK_FOR_REVISION and no SUBMITTED has followed.
    expect(response.body.requiresRevisionTag).toBe(true);
    expect(response.body.revisedAfterSendBack).toBe(false);
    // The IM's approved amount is cleared so the requester sees a blank field again.
    expect(response.body.approvedAmount).toBeNull();

    // The event log carries the send-back record for the audit trail.
    const events = response.body.events.map((e: { eventType: string }) => e.eventType);
    expect(events).toContain(RequisitionEventType.SEND_BACK_FOR_REVISION);
  });

  it('refuses a requisition that is not in APPROVED', async () => {
    // Take a requisition only to IM_REVIEW, leaving the chain half-open.
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: 5_000, productId: null, note: null },
      ],
    });
    await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

    const response = await im.client
      .post(`/requisitions/${created.body.id}/send-back-for-revision`)
      .send({ reason: 'Try the wrong path' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(ErrorCode.CANNOT_SEND_BACK_FOR_REVISION);
    expect(response.body.details).toMatchObject({ reason: 'not_approved' });
  });

  it('refuses a multi-item requisition — the BOM-customise path is the legitimate one', async () => {
    const requisitionId = await approveMultiItem([
      { quantity: 1, unitPrice: 8_000 },
      { quantity: 1, unitPrice: 7_000 },
    ]);

    const response = await im.client
      .post(`/requisitions/${requisitionId}/send-back-for-revision`)
      .send({ reason: 'Multi-item should not bounce' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(ErrorCode.CANNOT_SEND_BACK_FOR_REVISION);
    expect(response.body.details).toMatchObject({ reason: 'multi_item' });

    // The requisition is still APPROVED — the refusal did not partially apply.
    const detail = (await requester.client.get(`/requisitions/${requisitionId}`)).body;
    expect(detail.status).toBe(RequisitionStatus.APPROVED);
  });

  it('after send-back, the requester re-submits and the chain replays with the revised tag', async () => {
    const req = await approveSingleItem(12_500, 10_000);

    await im.client
      .post(`/requisitions/${req.id}/send-back-for-revision`)
      .send({ reason: 'Budget needs revision' });

    // Now the requester can edit the draft and re-submit. The previous approvals were
    // removed when the send-back flipped status to DRAFT (the events log preserves the
    // history), and `submit` will insert a fresh chain.
    const resubmitResponse = await requester.client
      .post(`/requisitions/${req.id}/submit`)
      .send();
    const resubmitted = resubmitResponse.body;
    expect(resubmitted.status).toBe(RequisitionStatus.IM_REVIEW);

    const detail = (await requester.client.get(`/requisitions/${req.id}`)).body;
    // The "for revise" tag is gone — the requester has acted on the bounce.
    expect(detail.requiresRevisionTag).toBe(false);
    // The "revised" tag is on — a SUBMITTED has landed after the SEND_BACK.
    expect(detail.revisedAfterSendBack).toBe(true);
    // The fresh chain has its own approval rows; the old APPROVED rows remain in the
    // list as audit history. The new chain is what the IM picks up.
    const pendingApprovals = detail.approvals.filter(
      (a: { action: string }) => a.action === 'PENDING',
    );
    expect(pendingApprovals.length).toBeGreaterThan(0);
  });
});
