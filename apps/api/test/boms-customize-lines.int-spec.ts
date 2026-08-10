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
 * IM-side customisation of the BOM lines at generate-time.
 *
 * On multi-item approved requisitions where the approved amount came in below what the
 * requester asked for, the IM can:
 *
 *   - shrink a line quantity (down to 1, never above the source — that's a 409)
 *   - drop a line entirely (`removed: true` on the wire)
 *
 * The source `requisition_items.quantity` is never modified — the override lives only on the
 * `bom_lines` row for this document. This is a deliberate offline-coordination model; see
 * the plan file `snug-whistling-abelson.md` D1.
 *
 * The four cases below are the ones the plan calls for. The single-item bounce path is
 * exercised in `requisitions-send-back.int-spec.ts`; here we are testing the multi-item
 * path only.
 */
describe('BOMs — IM-side customisation of lines', () => {
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
   * Drive a fresh multi-item requisition from DRAFT to APPROVED. Items use the supplied unit
   * price; we override the approved amount via the IM's stage so we can simulate the
   * under-funded multi-item case the IM customisation flow exists for.
   *
   * The IM stage accepts an `approvedAmount` that gets stamped onto the requisition — used
   * here to set the headline figure so the maths in the assertions is readable.
   */
  const approveMultiItem = async (
    items: Array<{
      itemName: string;
      quantity: number;
      estimatedUnitPrice: number;
    }>,
    approvedAmount: number,
  ) => {
    const created = await requester.client.post('/requisitions').send({
      departmentId,
      urgency: 'NORMAL',
      reason: 'Test requisition',
      items: items.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        estimatedUnitPrice: item.estimatedUnitPrice,
        productId: null,
        note: null,
      })),
    });
    expect(created.status).toBe(201);

    const submitted = (
      await requester.client.post(`/requisitions/${created.body.id}/submit`).send()
    ).body;
    const imApprovalId = submitted.approvals.find(
      (a: { stage: string; slot: number }) => a.stage === 'INVENTORY_MANAGER',
    ).id;

    // The IM stage can set approvedAmount directly — it stamps the headline figure.
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
      items: Array<{ id: string; itemName: string; quantity: number; estimatedUnitPrice: number }>;
      approvedAmount: number;
    };
  };

  it('honours a per-line quantity override that shrinks the line below the source', async () => {
    // 4 items at 1000 each = 4000 requested. Approve at 3500 so the IM must shrink to fit.
    const req = await approveMultiItem(
      [
        { itemName: 'Widget A', quantity: 10, estimatedUnitPrice: 100 },
        { itemName: 'Widget B', quantity: 5, estimatedUnitPrice: 200 },
        { itemName: 'Widget C', quantity: 4, estimatedUnitPrice: 250 },
        { itemName: 'Widget D', quantity: 3, estimatedUnitPrice: 333 },
      ],
      3500,
    );

    // Shrink line A from 10 → 5, change unit cost on line B to 150, leave C and D alone.
    const lines = req.items.map((item) => {
      if (item.itemName === 'Widget A') {
        return { requisitionItemId: item.id, unitCost: 100, vendor: 'Acme', quantity: 5 };
      }
      if (item.itemName === 'Widget B') {
        return { requisitionItemId: item.id, unitCost: 150, vendor: 'Acme', quantity: 5 };
      }
      return { requisitionItemId: item.id, unitCost: 250, vendor: 'Acme' };
    });

    const response = await im.client.post('/boms').send({
      requisitionIds: [req.id],
      lines,
    });

    expect(response.status).toBe(201);
    // 5*100 + 5*150 + 4*250 + 3*250 = 500 + 750 + 1000 + 750 = 3000
    // (All non-targeted lines also get unitCost=250 in the override, including D.)
    expect(response.body.subtotal).toBe(3000);
    expect(response.body.lines).toHaveLength(4);
    // Line A is the one whose qty was overridden — verify it carried the override, not the source.
    const lineA = response.body.lines.find(
      (l: { itemName: string }) => l.itemName === 'Widget A',
    );
    expect(lineA.quantity).toBe(5);
    // Source was untouched.
    const detail = (await requester.client.get(`/requisitions/${req.id}`)).body;
    const sourceA = detail.items.find((i: { itemName: string }) => i.itemName === 'Widget A');
    expect(sourceA.quantity).toBe(10);
  });

  it('drops a line entirely when the IM marks it removed', async () => {
    const req = await approveMultiItem(
      [
        { itemName: 'Widget A', quantity: 5, estimatedUnitPrice: 100 },
        { itemName: 'Widget B', quantity: 5, estimatedUnitPrice: 200 },
        { itemName: 'Widget C', quantity: 5, estimatedUnitPrice: 300 },
      ],
      3000,
    );

    const lines = req.items.map((item) => {
      if (item.itemName === 'Widget B') {
        // Explicitly mark as removed — drop from the BOM entirely.
        return { requisitionItemId: item.id, unitCost: 200, vendor: 'Acme', removed: true };
      }
      return { requisitionItemId: item.id, unitCost: 100, vendor: 'Acme' };
    });

    const response = await im.client.post('/boms').send({
      requisitionIds: [req.id],
      lines,
    });

    expect(response.status).toBe(201);
    // Only the two un-removed lines made it onto the BOM. Both carry the IM's final
    // unitCost=100, so subtotal = 5*100 + 5*100 = 1000.
    expect(response.body.lines).toHaveLength(2);
    expect(response.body.subtotal).toBe(1000);
    const names = response.body.lines.map((l: { itemName: string }) => l.itemName).sort();
    expect(names).toEqual(['Widget A', 'Widget C']);
  });

  it('returns 409 when a quantity override exceeds the source requisition item', async () => {
    const req = await approveMultiItem(
      [
        { itemName: 'Widget A', quantity: 2, estimatedUnitPrice: 100 },
        { itemName: 'Widget B', quantity: 5, estimatedUnitPrice: 100 },
      ],
      700,
    );

    // The IM tries to put 99 of Widget A on the BOM. Source only sanctions 2 — 409.
    const lines = req.items.map((item) =>
      item.itemName === 'Widget A'
        ? { requisitionItemId: item.id, unitCost: 100, vendor: 'Acme', quantity: 99 }
        : { requisitionItemId: item.id, unitCost: 100, vendor: 'Acme' },
    );

    const response = await im.client.post('/boms').send({
      requisitionIds: [req.id],
      lines,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(ErrorCode.BOM_QUANTITY_EXCEEDS_SOURCE);
    // The error payload names the offending line so the form can highlight it.
    expect(response.body.details).toMatchObject({
      itemName: 'Widget A',
      requested: 99,
      max: 2,
    });
  });

  it('returns 409 when every line is removed', async () => {
    const req = await approveMultiItem(
      [
        { itemName: 'Widget A', quantity: 5, estimatedUnitPrice: 100 },
        { itemName: 'Widget B', quantity: 5, estimatedUnitPrice: 200 },
      ],
      1500,
    );

    // Both lines removed — there is no BOM to generate. Use send-back-for-revision instead.
    const lines = req.items.map((item) => ({
      requisitionItemId: item.id,
      unitCost: 100,
      vendor: 'Acme',
      removed: true,
    }));

    const response = await im.client.post('/boms').send({
      requisitionIds: [req.id],
      lines,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(ErrorCode.ALL_BOM_LINES_REMOVED);

    // And the source requisition did not flip status — it is still APPROVED.
    const detail = (await requester.client.get(`/requisitions/${req.id}`)).body;
    expect(detail.status).toBe(RequisitionStatus.APPROVED);
  });
});
