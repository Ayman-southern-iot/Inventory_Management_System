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
import { createUser, login, resetData, seedSubthresholdApprover } from './factories';

interface Actor {
  id: string;
  client: HttpClient;
}

/**
 * BOM generation, frozen approval snapshot, over-budget bounce, voiding.
 *
 * The five invariants from the 4.2 plan, each pinned by an individual `it`:
 *
 *   1. snapshot is genuinely frozen (a user rename does not change it)
 *   2. one live BOM per requisition (the unique index surfaces as 409)
 *   3. voiding a BOM frees the requisition (the trigger flips is_void)
 *   4. over-budget bounces to AWAITING_APPROVAL with `decided_at` cleared
 *   5. a line that does not belong to a source requisition is a 400
 *
 * Plus role gates: only INVENTORY_MANAGER / ADMIN can generate or void.
 */
describe('BOMs', () => {
  let ctx: TestApp;
  let requester: Actor;
  let im: Actor;
  let approver1: Actor;
  let approver2: Actor;
  let admin: Actor;
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
    admin = await actorFor([Role.GENERAL, Role.ADMIN]);

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
   * Drive a fresh, single-line requisition from DRAFT to APPROVED.
   * Quantity is 1, so `amount` is both the line total and `approved_amount` —
   * keeps the bounce/within-tolerance arithmetic the tests assert against readable.
   */
  const approveRequisition = async (amount: number, lineName = 'Widget') => {
    const created = await requester.client.post('/requisitions').send({
      departmentId,
      urgency: 'NORMAL',
      reason: 'Test requisition',
      items: [
        {
          itemName: lineName,
          quantity: 1,
          estimatedUnitPrice: amount,
          productId: null,
          note: 'For the BOM test',
        },
      ],
    });
    expect(created.status).toBe(201);

    const submitted = (
      await requester.client.post(`/requisitions/${created.body.id}/submit`).send()
    ).body;
    const imApprovalId = submitted.approvals.find(
      (a: { stage: string; slot: number }) => a.stage === 'INVENTORY_MANAGER',
    ).id;
    const afterIm = (
      await im.client.post(`/requisitions/approvals/${imApprovalId}/decision`).send({ approve: true })
    ).body;

    // The approver count is a setting-driven policy frozen at submit (OQ-01). Below
    // the threshold there is one approver slot; at or above, two. Use whichever the
    // requisition actually has rather than assuming.
    const approverCount = submitted.requiredApproverCount as number;
    expect([1, 2]).toContain(approverCount);

    for (let slot = 1; slot <= approverCount; slot += 1) {
      const approvalId = afterIm.approvals.find(
        (a: { stage: string; slot: number }) => a.stage === 'APPROVER' && a.slot === slot,
      )?.id;
      expect(approvalId).toBeDefined();
      await approver1.client
        .post(`/requisitions/approvals/${approvalId}/decision`)
        .send({ approve: true });
    }

    return (
      await requester.client.get(`/requisitions/${created.body.id}`)
    ).body as {
      id: string;
      items: Array<{ id: string; itemName: string; quantity: number; estimatedUnitPrice: number }>;
      approvedAmount: number;
      approvals: Array<{
        id: string;
        stage: string;
        slot: number;
        assignedUserName: string;
        assignedUserDesignation: string;
        action: string;
      }>;
    };
  };

  /** Build a generate-payload that covers every line in the requisition. */
  const generatePayload = (
    requisitionId: string,
    items: Array<{ id: string }>,
    overrides: { unitCost?: number; vendor?: string | null } = {},
  ) => ({
    requisitionIds: [requisitionId],
    lines: items.map((item) => ({
      requisitionItemId: item.id,
      unitCost: overrides.unitCost ?? 250,
      vendor: overrides.vendor ?? 'Acme',
    })),
  });

  describe('permissions', () => {
    it('refuses anyone who is not the IM or an Admin (POST /boms)', async () => {
      const req = await approveRequisition(5000);
      const payload = generatePayload(req.id, req.items);

      const denied = await requester.client.post('/boms').send(payload);
      expect(denied.status).toBe(403);
    });

    it('refuses anyone who is not the IM or an Admin (POST /boms/:id/void)', async () => {
      const req = await approveRequisition(5000);
      const payload = generatePayload(req.id, req.items);
      const created = await im.client.post('/boms').send(payload);

      const denied = await requester.client
        .post(`/boms/${created.body.id}/void`)
        .send({ reason: 'No, I should not be allowed' });
      expect(denied.status).toBe(403);
    });

    /**
     * The read endpoints carried no guard at all. A BOM exposes vendor names, unit costs and
     * the approver footprint for every department, and `pdf-url` mints the credential for the
     * letterhead PDF — so a General user could read the lot. The web app already hid the
     * routes, which is what made it easy to miss that nothing enforced it.
     */
    it('refuses a General user on the read endpoints', async () => {
      const req = await approveRequisition(5000);
      const created = await im.client.post('/boms').send(generatePayload(req.id, req.items));
      const bomId = created.body.id as string;

      expect((await requester.client.get('/boms')).status).toBe(403);
      expect((await requester.client.get(`/boms/${bomId}`)).status).toBe(403);
      expect((await requester.client.get(`/boms/${bomId}/pdf-url`)).status).toBe(403);
    });
  });

  describe('generation', () => {
    it('creates a BOM from a single approved requisition', async () => {
      const req = await approveRequisition(5000);
      const payload = generatePayload(req.id, req.items);

      const response = await im.client.post('/boms').send(payload);

      expect(response.status).toBe(201);
      expect(response.body.bomNo).toMatch(/^BOM-\d{6}$/);
      expect(response.body.subtotal).toBe(250); // 1 unit * 250
      expect(response.body.isVoid).toBe(false);
      expect(response.body.overBudgetBounced).toBe(false);
      expect(response.body.requisitionNos).toHaveLength(1);
      expect(response.body.lines).toHaveLength(1);

      // The requisition's status advances (freeze-for-history: the decision itself never changes).
      const detail = (
        await requester.client.get(`/requisitions/${req.id}`)
      ).body;
      expect(detail.status).toBe(RequisitionStatus.BOM_GENERATED);
      const events = detail.events.map((e: { eventType: string }) => e.eventType);
      expect(events).toContain(RequisitionEventType.BOM_GENERATED);
    });

    it('rejects a line whose requisition_item_id is not in any source requisition', async () => {
      const req = await approveRequisition(5000);
      const fakeItemId = '00000000-0000-0000-0000-000000000000';
      const payload = {
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: fakeItemId, unitCost: 1, vendor: null }],
      };

      const response = await im.client.post('/boms').send(payload);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('returns 409 when any source requisition is not APPROVED', async () => {
      // Take a requisition only to IM_REVIEW, leaving the approver chain open.
      const created = await requester.client.post('/requisitions').send({
        departmentId,
        urgency: 'NORMAL',
        items: [
          { itemName: 'Widget', quantity: 1, estimatedUnitPrice: 5000, productId: null, note: null },
        ],
      });
      await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

      const response = await im.client.post('/boms').send({
        requisitionIds: [created.body.id],
        lines: [{ requisitionItemId: created.body.items[0].id, unitCost: 100, vendor: null }],
      });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCode.BOM_REQUISITION_NOT_APPROVED);
    });
  });

  describe('the one-live-BOM invariant', () => {
    it('refuses to put the same requisition on a second live BOM (409)', async () => {
      const req = await approveRequisition(5000);
      const payload = generatePayload(req.id, req.items);

      const first = await im.client.post('/boms').send(payload);
      expect(first.status).toBe(201);

      const second = await im.client.post('/boms').send(payload);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe(ErrorCode.BOM_ALREADY_ON_LIVE_BOM);
    });
  });

  describe('the approval snapshot is genuinely frozen', () => {
    it('survives a rename of an approver (invariant 1)', async () => {
      const req = await approveRequisition(5000);
      const generated = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body;

      const snapshotBefore = generated.sources[0].footprints.map(
        (f: { name: string; designation: string }) => ({ name: f.name, designation: f.designation }),
      );
      const imFootprintBefore = snapshotBefore.find(
        (f: { name: string }) => f.name.startsWith('Test'),
      );
      expect(imFootprintBefore).toBeDefined();

      // Mutate the names + designations of every approver attached to the requisition.
      // The snapshot must still read the originals — that is what makes it frozen.
      await ctx.db
        .updateTable('users')
        .set({
          full_name: 'Renamed ' + Math.random().toString(36).slice(2, 6),
          designation: 'Renamed Designation',
        })
        .where('id', 'in', [im.id, approver1.id, approver2.id])
        .execute();

      const detail = (await im.client.get(`/boms/${generated.id}`)).body;
      const snapshotAfter = detail.sources[0].footprints.map(
        (f: { name: string; designation: string }) => ({ name: f.name, designation: f.designation }),
      );
      expect(snapshotAfter).toEqual(snapshotBefore);
    });
  });

  describe('voiding', () => {
    it('returns sources to APPROVED so they can be re-batched (invariant 3)', async () => {
      const req = await approveRequisition(5000);
      const generated = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body;

      const voided = await im.client
        .post(`/boms/${generated.id}/void`)
        .send({ reason: 'Duplicate BOM' });

      expect(voided.status).toBe(200);
      expect(voided.body.isVoid).toBe(true);
      expect(voided.body.voidReason).toBe('Duplicate BOM');

      const detail = (
        await requester.client.get(`/requisitions/${req.id}`)
      ).body;
      expect(detail.status).toBe(RequisitionStatus.APPROVED);
      const events = detail.events.map((e: { eventType: string }) => e.eventType);
      expect(events).toContain(RequisitionEventType.BOM_VOIDED);
    });

    it('a voided BOM no longer blocks the candidate query (partial index flips)', async () => {
      const req = await approveRequisition(5000);
      const generated = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body;
      await im.client.post(`/boms/${generated.id}/void`).send({ reason: 'Reset' });

      const candidates = (await im.client.get('/boms/candidates')).body;
      const ids = candidates.map((c: { requisitionId: string }) => c.requisitionId);
      expect(ids).toContain(req.id);
    });

    it('refuses to void twice (409)', async () => {
      const req = await approveRequisition(5000);
      const generated = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body;
      await im.client.post(`/boms/${generated.id}/void`).send({ reason: 'First void' });

      const second = await im.client
        .post(`/boms/${generated.id}/void`)
        .send({ reason: 'Already void' });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe(ErrorCode.BOM_ALREADY_VOID);
    });

    it('Admin can void too', async () => {
      const req = await approveRequisition(5000);
      const generated = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body;

      const voided = await admin.client
        .post(`/boms/${generated.id}/void`)
        .send({ reason: 'Admin cleanup' });

      expect(voided.status).toBe(200);
      expect(voided.body.isVoid).toBe(true);
    });
  });

  describe('over-budget tolerance (OQ-05)', () => {
    it('bounces: subtotal above tolerance flips sources back to AWAITING_APPROVAL (invariant 4)', async () => {
      // Approved total per requisition is 5000; tolerance is 10% → ceiling 5500.
      // Subtotal = 6000 (1 unit at 6000), so we bounce.
      const req = await approveRequisition(5000, 'Bouncer');

      const response = await im.client
        .post('/boms')
        .send(generatePayload(req.id, req.items, { unitCost: 6000 }));
      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCode.BOM_OVER_BUDGET);

      // Source went back to AWAITING_APPROVAL with decided_at cleared.
      const detail = (await requester.client.get(`/requisitions/${req.id}`)).body;
      expect(detail.status).toBe(RequisitionStatus.AWAITING_APPROVAL);
      expect(detail.decidedAt).toBeNull();
      const events = detail.events.map((e: { eventType: string }) => e.eventType);
      expect(events).toContain(RequisitionEventType.BOM_BOUNCED);

      // The BOM row still exists and is marked bounced.
      const bomRows = await ctx.db
        .selectFrom('boms')
        .where('over_budget_bounced', '=', true)
        .execute();
      expect(bomRows.length).toBeGreaterThan(0);
    });

    it('within tolerance: subtotal at-or-under the ceiling is honoured normally', async () => {
      // Approved total 5000, tolerance 10% → ceiling 5500. Subtotal 5000 (one line at 5000) is
      // under the ceiling, so the BOM is generated normally.
      const req = await approveRequisition(5000, 'WithinTolerance');
      const response = await im.client
        .post('/boms')
        .send(generatePayload(req.id, req.items, { unitCost: 5000 }));
      expect(response.status).toBe(201);
      expect(response.body.overBudgetBounced).toBe(false);
      const detail = (await requester.client.get(`/requisitions/${req.id}`)).body;
      expect(detail.status).toBe(RequisitionStatus.BOM_GENERATED);
    });
  });

  describe('batch generation (one BOM, multiple sources)', () => {
    it('merges lines from multiple requisitions, each inheriting its source line', async () => {
      const a = await approveRequisition(1000, 'ItemA');
      const b = await approveRequisition(2000, 'ItemB');

      const lines = [
        ...a.items.map((item) => ({
          requisitionItemId: item.id,
          unitCost: 100,
          vendor: 'Vendor-A',
        })),
        ...b.items.map((item) => ({
          requisitionItemId: item.id,
          unitCost: 200,
          vendor: 'Vendor-B',
        })),
      ];

      const created = await im.client
        .post('/boms')
        .send({ requisitionIds: [a.id, b.id], lines });

      expect(created.status).toBe(201);
      expect(created.body.requisitionNos).toHaveLength(2);
      expect(created.body.lines).toHaveLength(2);
      expect(created.body.subtotal).toBe(300); // 100 from a + 200 from b
      // The vendor the IM typed for each requisition is preserved per line.
      expect(created.body.lines.map((l: { vendor: string }) => l.vendor).sort()).toEqual([
        'Vendor-A',
        'Vendor-B',
      ]);

      // Both sources advanced to BOM_GENERATED.
      const statusA = (await requester.client.get(`/requisitions/${a.id}`)).body.status;
      const statusB = (await requester.client.get(`/requisitions/${b.id}`)).body.status;
      expect(statusA).toBe(RequisitionStatus.BOM_GENERATED);
      expect(statusB).toBe(RequisitionStatus.BOM_GENERATED);
    });
  });

  describe('listing and detail', () => {
    it('lists BOMs and includes the source requisition numbers', async () => {
      const req = await approveRequisition(5000);
      await im.client.post('/boms').send(generatePayload(req.id, req.items));

      const list = await im.client.get('/boms?limit=10');
      expect(list.status).toBe(200);
      expect(list.body.items.length).toBeGreaterThan(0);
      expect(list.body.items[0].requisitionNos.length).toBe(1);
      expect(list.body.items[0].hasPdf).toBe(false);
    });

    it('detail includes lines, sources, and the frozen footprints block', async () => {
      const req = await approveRequisition(5000);
      const created = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body;

      expect(created.lines).toHaveLength(1);
      expect(created.sources).toHaveLength(1);
      expect(created.sources[0].requisitionNo).toMatch(/^REQ-/);
      expect(created.sources[0].footprints.length).toBeGreaterThan(0);
      // The IM stage is the first footprint; approvers follow in slot order.
      const stages = created.sources[0].footprints.map((f: { stage: string }) => f.stage);
      expect(stages[0]).toBe('INVENTORY_MANAGER');
    });
  });
});
