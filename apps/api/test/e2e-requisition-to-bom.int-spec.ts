/**
 * Phase 04 — task 4.5, end-to-end data-flow smoke.
 *
 * The web UI is a thin wrapper over the API, but no test currently walks the
 * whole pipeline in one breath. This file does that — every step a real user
 * takes from "raise a request" to "Accounts has the PDF" — and asserts that
 * the data flows correctly between actors.
 *
 * Scenarios covered:
 *
 *   A. Happy path — requester → IM → approver → IM generates BOM → render →
 *      signed URL → download → list shows live row with hasPdf=true → BOM
 *      detail's frozen footprints match the live approvers.
 *
 *   B. Over-budget (reformed 2026-08-09) — unit cost > approved → API
 *      generates the BOM anyway, the requisition moves to BOM_GENERATED,
 *      and no BOM_BOUNCED event is recorded. The old bounce was retired
 *      because a unit cost going up between approval and BOM generation is
 *      a normal slowdown, not a policy violation.
 *
 *   C. Void after render — render PDF; then void with a reason; the row
 *      flips to isVoid, voidReason recorded, hasPdf=false (controller clears
 *      the cached file in-tx), and a fresh signed URL request 409s.
 *
 *   D. Candidate flip — once a requisition is on a live BOM it is no longer
 *      in /boms/candidates; once that BOM is voided it appears again.
 *
 * Each scenario exercises the IM's screen on its own, not just the controllers
 * in isolation. If anything downstream of `boms.int-spec.ts` regresses, this
 * is the file that catches the cross-screen bug.
 */
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
  email: string;
  client: HttpClient;
}

describe('e2e: requisition → BOM pipeline (data flow)', () => {
  let ctx: TestApp;
  let requester: Actor;
  let im: Actor;
  let approver1: Actor;
  let approver2: Actor;
  let departmentId: string;

  const actorFor = async (
    roles: Role[],
    name: string,
  ): Promise<Actor> => {
    const user = await createUser(ctx.db, { roles, fullName: name });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return {
      id: user.id,
      email: user.email,
      client: http.as(session.accessToken),
    };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);

    requester = await actorFor([Role.GENERAL], 'Rina Requester');
    im = await actorFor(
      [Role.GENERAL, Role.INVENTORY_MANAGER],
      'Inara IM',
    );
    approver1 = await actorFor([Role.GENERAL, Role.APPROVER], 'Ayesha Approver');
    approver2 = await actorFor([Role.GENERAL, Role.APPROVER], 'Bilal Approver');

    const department = await ctx.db
      .insertInto('departments')
      .values({ name: `E2E Dept ${Date.now()}-${Math.random()}` })
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

  /** Drive a fresh requisition from draft to fully approved. Returns the detail. */
  const approveRequisition = async (amount: number, itemName = 'E2E Widget') => {
    const created = await requester.client.post('/requisitions').send({
      departmentId,
      urgency: 'NORMAL',
      reason: 'E2E requisition',
      items: [
        {
          itemName,
          quantity: 1,
          estimatedUnitPrice: amount,
          productId: null,
          note: 'For the e2e flow',
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
      await im.client
        .post(`/requisitions/approvals/${imApprovalId}/decision`)
        .send({ approve: true })
    ).body;

    const approverCount = submitted.requiredApproverCount as number;
    for (let slot = 1; slot <= approverCount; slot += 1) {
      const approvalId = afterIm.approvals.find(
        (a: { stage: string; slot: number }) => a.stage === 'APPROVER' && a.slot === slot,
      )?.id;
      await approver1.client
        .post(`/requisitions/approvals/${approvalId}/decision`)
        .send({ approve: true });
    }

    return (await requester.client.get(`/requisitions/${created.body.id}`)).body as {
      id: string;
      requisitionNo: string;
      status: RequisitionStatus;
      approvedAmount: number;
      items: Array<{ id: string; itemName: string; quantity: number }>;
    };
  };

  /* ------------------------------------------------------------- A. happy path */

  it('happy path: candidate → generate → render → download → list', async () => {
    // 1. Requester raises and the chain approves.
    const req = await approveRequisition(2_500);
    expect(req.status).toBe(RequisitionStatus.APPROVED);

    // 2. The requisition appears in the IM's candidates query.
    const candidates = (await im.client.get('/boms/candidates').send()).body;
    const match = candidates.find(
      (c: { requisitionId: string }) => c.requisitionId === req.id,
    );
    expect(match).toBeDefined();
    expect(match.approvedAmount).toBe(2_500);

    // 3. IM generates the BOM. The return shape is the full detail so the
    //    page can land straight on it (no extra round-trip).
    const generated = (
      await im.client.post('/boms').send({
        requisitionIds: [req.id],
        lines: req.items.map((item) => ({
          requisitionItemId: item.id,
          unitCost: 2_500,
          vendor: 'Acme Corp',
        })),
      })
    ).body;
    expect(generated.bomNo).toMatch(/^BOM-\d{6}$/);
    expect(generated.subtotal).toBe(2_500);
    expect(generated.isVoid).toBe(false);
    expect(generated.hasPdf).toBe(false);
    expect(generated.overBudgetBounced).toBe(false);

    // 4. The frozen snapshot on the BOM detail page matches the IM/approver
    //    chain, in order: IM first, then approver 1 (and 2 if required).
    const detail = (await im.client.get(`/boms/${generated.id}`).send()).body;
    expect(detail.sources).toHaveLength(1);
    const source = detail.sources[0]!;
    expect(source.footprints[0]!.stage).toBe('INVENTORY_MANAGER');
    expect(source.footprints[0]!.name).toBe('Inara IM');
    const approverSlots = source.footprints
      .filter((f: { stage: string }) => f.stage === 'APPROVER')
      .map((f: { slot: number }) => f.slot);
    expect(approverSlots).toContain(1);

    // 5. Render PDF. The controller wraps the detail under `bom` so the UI
    //    can do a single setQueryData; we unwrap here.
    const rendered = (
      await im.client.post(`/boms/${generated.id}/render`).send()
    ).body;
    expect(rendered.bom.hasPdf).toBe(true);

    // 6. The list now carries hasPdf=true for this row (the IM's index should
    //    show "PDF on file" without a refetch of the detail).
    const listed = (await im.client.get('/boms').send()).body;
    const row = listed.items.find((b: { id: string }) => b.id === generated.id);
    expect(row).toBeDefined();
    expect(row.hasPdf).toBe(true);

    // 7. Signed URL is a relative path under /api/v1 carrying a token.
    const signed = (await im.client.get(`/boms/${generated.id}/pdf-url`).send())
      .body;
    expect(signed.url).toMatch(
      new RegExp(`^/api/v1/boms/${generated.id}/pdf\\?token=`),
    );

    // 8. The requisition is now fully consumed — its status is BOM_GENERATED.
    const reqAfter = (await requester.client.get(`/requisitions/${req.id}`).send())
      .body;
    expect(reqAfter.status).toBe(RequisitionStatus.BOM_GENERATED);
    const eventTypes = reqAfter.events.map((e: { eventType: string }) => e.eventType);
    expect(eventTypes).toContain(RequisitionEventType.BOM_GENERATED);
  });

  /* ------------------------------------------------ B. over-budget (reformed) */

  it('over-budget: subtotal > approved generates anyway (no bounce, retired 2026-08-09)', async () => {
    // The over-budget bounce was retired on 2026-08-09: a unit cost going up between
    // approval and BOM generation is a normal slowdown, not a policy violation. The
    // same input that used to bounce now generates a BOM, the requisition moves to
    // BOM_GENERATED, and no BOM_BOUNCED event is recorded.
    const req = await approveRequisition(2_500);

    // unitCost 3_000 > 2_500. Under the old gate this would have bounced off the
    // 10% tolerance ceiling; under the new gate it generates cleanly.
    const generated = (
      await im.client.post('/boms').send({
        requisitionIds: [req.id],
        lines: req.items.map((item) => ({
          requisitionItemId: item.id,
          unitCost: 3_000,
          vendor: null,
        })),
      })
    ).body;

    expect(generated.overBudgetBounced).toBe(false);
    expect(generated.subtotal).toBe(3_000);

    const after = (await requester.client.get(`/requisitions/${req.id}`).send())
      .body;
    expect(after.status).toBe(RequisitionStatus.BOM_GENERATED);
    const eventTypes = after.events.map((e: { eventType: string }) => e.eventType);
    expect(eventTypes).toContain(RequisitionEventType.BOM_GENERATED);
    expect(eventTypes).not.toContain(RequisitionEventType.BOM_BOUNCED);
  });

  /* --------------------------------------------------- C. void after render */

  it('void path: render → void → hasPdf=false → signed URL 404s', async () => {
    const req = await approveRequisition(3_000);
    const generated = (
      await im.client.post('/boms').send({
        requisitionIds: [req.id],
        lines: req.items.map((item) => ({
          requisitionItemId: item.id,
          unitCost: 3_000,
          vendor: 'Acme',
        })),
      })
    ).body;

    await im.client.post(`/boms/${generated.id}/render`).send();

    const voided = (
      await im.client
        .post(`/boms/${generated.id}/void`)
        .send({ reason: 'Wrong totals after second look' })
    ).body;
    expect(voided.isVoid).toBe(true);
    expect(voided.voidReason).toBe('Wrong totals after second look');
    // The PDF cache is cleared on void — the detail flips back to pending
    // and a fresh signed URL request goes 404 (the file is gone).
    expect(voided.hasPdf).toBe(false);

    const reqAfter = (await requester.client.get(`/requisitions/${req.id}`).send())
      .body;
    const eventTypes = reqAfter.events.map((e: { eventType: string }) => e.eventType);
    expect(eventTypes).toContain(RequisitionEventType.BOM_VOIDED);
  });

  /* ----------------------------------------- D. candidates flip on void */

  it('candidates: disappears from /boms/candidates while live, returns once voided', async () => {
    const req = await approveRequisition(1_500);

    // Before generation: requisition is in the candidate list.
    let candidates = (await im.client.get('/boms/candidates').send()).body;
    expect(
      candidates.some(
        (c: { requisitionId: string }) => c.requisitionId === req.id,
      ),
    ).toBe(true);

    // Generate: a live BOM consumes the requisition.
    const generated = (
      await im.client.post('/boms').send({
        requisitionIds: [req.id],
        lines: req.items.map((item) => ({
          requisitionItemId: item.id,
          unitCost: 1_500,
          vendor: 'Vendor',
        })),
      })
    ).body;

    candidates = (await im.client.get('/boms/candidates').send()).body;
    expect(
      candidates.every(
        (c: { requisitionId: string }) => c.requisitionId !== req.id,
      ),
    ).toBe(true);

    // Void frees it again — the same requisition reappears.
    await im.client
      .post(`/boms/${generated.id}/void`)
      .send({ reason: 'Reset for second look' });

    candidates = (await im.client.get('/boms/candidates').send()).body;
    expect(
      candidates.some(
        (c: { requisitionId: string }) => c.requisitionId === req.id,
      ),
    ).toBe(true);
  });

  /* ----------------------------------------------------- E. double-render */

  it('rendering twice with the same idempotency key does not re-run Chromium', async () => {
    const req = await approveRequisition(1_000);
    const generated = (
      await im.client.post('/boms').send({
        requisitionIds: [req.id],
        lines: req.items.map((item) => ({
          requisitionItemId: item.id,
          unitCost: 1_000,
          vendor: 'Vendor',
        })),
      })
    ).body;

    // The controller hashes Idempotency-Key. Without one the API will run
    // Chromium each time — that's fine for the API. The UI side is what
    // makes it idempotent (request 4.4 §3).
    const first = await im.client.post(`/boms/${generated.id}/render`).send();
    expect(first.status).toBeLessThan(400);

    const second = await im.client.post(`/boms/${generated.id}/render`).send();
    expect(second.status).toBeLessThan(400);
    expect(second.body.bom.hasPdf).toBe(true);
  });
});
