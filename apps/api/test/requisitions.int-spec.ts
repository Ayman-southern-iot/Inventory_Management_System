import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ApprovalAction,
  ApprovalStage,
  ErrorCode,
  RequisitionEventType,
  RequisitionStatus,
  Role,
  SettingKey,
} from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { SettingsService } from '../src/modules/settings/settings.service';

interface Actor {
  id: string;
  client: HttpClient;
}

/**
 * The approval chain. Every rule here comes from domain-context.md:
 *   - the IM acts first ("confirmed, we don't have this")
 *   - approvers then act in parallel, in no fixed order
 *   - **any single rejection kills the whole request** — it does not need both
 *   - an approver may withdraw until the BOM is generated
 *   - the approver count is frozen at submit and never recomputed
 */
describe('requisitions and approvals', () => {
  let ctx: TestApp;
  let settings: SettingsService;
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
    settings = ctx.app.get(SettingsService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    settings.clearCache();

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

    // Company-wide default slots (OQ-02: a department may override these).
    await ctx.db
      .insertInto('approver_slots')
      .values([
        { department_id: null, slot_no: 1, user_id: approver1.id },
        { department_id: null, slot_no: 2, user_id: approver2.id },
      ])
      .execute();

    // Phase 05: a single admin-designated approver handles every sub-threshold requisition.
    // Tests for the "not configured" path override this to null.
    await settings.set(SettingKey.SUBTHRESHOLD_APPROVER_USER_ID, approver1.id, {
      actorId: im.id,
      actorName: null,
      actorEmail: null,
      actorRoles: [],
      requestMethod: 'TEST',
      requestPath: 'test://requisitions.int-spec/beforeEach',
      requestIp: null,
      userAgent: 'requisitions.int-spec.ts',
    });
  });

  /** Creates a draft whose total is exactly `amount`. */
  const draft = async (amount: number, overrides: Record<string, unknown> = {}) =>
    requester.client.post('/requisitions').send({
      departmentId,
      urgency: 'NORMAL',
      reason: 'Test requisition',
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: amount, productId: null, note: null },
      ],
      ...overrides,
    });

  const approvalOf = (detail: { approvals: Array<Record<string, unknown>> }, stage: string, slot = 1) =>
    detail.approvals.find((a) => a.stage === stage && a.slot === slot) as {
      id: string;
      action: string;
      assignedUserId: string;
    };

  describe('submit freezes the policy (task 3.3)', () => {
    it('records the threshold and approver count in force at submit', async () => {
      const created = await draft(20_000);
      const submitted = await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

      expect(submitted.status).toBe(200);
      expect(submitted.body.status).toBe(RequisitionStatus.IM_REVIEW);
      expect(submitted.body.requestedAmount).toBe(20_000);
      expect(submitted.body.thresholdAtSubmit).toBe(15_000);
      // At or above the threshold: two approvers (OQ-01).
      expect(submitted.body.requiredApproverCount).toBe(2);
      expect(
        submitted.body.approvals.filter((a: { stage: string }) => a.stage === ApprovalStage.APPROVER),
      ).toHaveLength(2);
    });

    it('needs only one approver below the threshold (OQ-01)', async () => {
      const created = await draft(5_000);
      const submitted = await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

      expect(submitted.body.requiredApproverCount).toBe(1);
      const approverRows = submitted.body.approvals.filter(
        (a: { stage: string }) => a.stage === ApprovalStage.APPROVER,
      );
      expect(approverRows).toHaveLength(1);
      // Phase 05: the sub-threshold approver is the admin-designated user, not slot 1.
      expect(approverRows[0].assignedUserId).toBe(approver1.id);
    });

    /**
     * The test the plan singles out as most likely to be broken by a later change: raising the
     * threshold after submit must not reshuffle a request already in its chain.
     */
    it('does not reshuffle an in-flight requisition when the threshold changes afterwards', async () => {
      const created = await draft(20_000);
      const submitted = await requester.client.post(`/requisitions/${created.body.id}/submit`).send();
      expect(submitted.body.requiredApproverCount).toBe(2);

      // An admin raises the threshold well above this request's amount.
      await settings.set(SettingKey.EXPENSE_THRESHOLD_BDT, 100_000, {
        actorId: im.id,
        actorName: null,
        actorEmail: null,
        actorRoles: [],
        requestMethod: 'TEST',
        requestPath: 'test://requisitions.int-spec/threshold-up',
        requestIp: null,
        userAgent: 'requisitions.int-spec.ts',
      });
      settings.clearCache();

      const reread = await requester.client.get(`/requisitions/${created.body.id}`);
      expect(reread.body.requiredApproverCount).toBe(2);
      expect(reread.body.thresholdAtSubmit).toBe(15_000);
      expect(
        reread.body.approvals.filter((a: { stage: string }) => a.stage === ApprovalStage.APPROVER),
      ).toHaveLength(2);

      // And a *new* requisition for the same amount now needs only one.
      const later = await draft(20_000);
      const laterSubmitted = await requester.client
        .post(`/requisitions/${later.body.id}/submit`)
        .send();
      expect(laterSubmitted.body.requiredApproverCount).toBe(1);
      expect(laterSubmitted.body.thresholdAtSubmit).toBe(100_000);

      await settings.set(SettingKey.EXPENSE_THRESHOLD_BDT, 15_000, {
        actorId: im.id,
        actorName: null,
        actorEmail: null,
        actorRoles: [],
        requestMethod: 'TEST',
        requestPath: 'test://requisitions.int-spec/threshold-down',
        requestIp: null,
        userAgent: 'requisitions.int-spec.ts',
      });
      settings.clearCache();
    });

    it('freezes the line totals as a generated column', async () => {
      const created = await requester.client.post('/requisitions').send({
        departmentId,
        items: [
          { itemName: 'A', quantity: 3, estimatedUnitPrice: 100, productId: null, note: null },
          { itemName: 'B', quantity: 2, estimatedUnitPrice: 250, productId: null, note: null },
        ],
      });
      const submitted = await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

      expect(submitted.body.items.map((i: { estimatedLineTotal: number }) => i.estimatedLineTotal))
        .toEqual([300, 500]);
      expect(submitted.body.requestedAmount).toBe(800);
    });

    it('refuses to submit with no approver slot assigned', async () => {
      await ctx.db.deleteFrom('approver_slots').execute();
      const created = await draft(20_000);

      const submitted = await requester.client.post(`/requisitions/${created.body.id}/submit`).send();
      expect(submitted.status).toBe(409);
      expect(submitted.body.code).toBe(ErrorCode.APPROVER_SLOT_UNASSIGNED);
    });

    it('ignores slots pointing at deactivated approvers', async () => {
      // This is the live Phase 05 regression: an admin deactivated a seed approver without
      // re-saving the slot. The old row must never freeze that user into a new requisition.
      await ctx.db
        .updateTable('users')
        .set({ is_active: false })
        .where('id', '=', approver1.id)
        .execute();

      const created = await draft(20_000);
      const submitted = await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

      expect(submitted.status).toBe(409);
      expect(submitted.body.code).toBe(ErrorCode.APPROVER_SLOT_UNASSIGNED);
      expect(submitted.body.message).toContain('Approver 2');
    });

    it('refuses sub-threshold submission when its designated approver is inactive', async () => {
      await ctx.db
        .updateTable('users')
        .set({ is_active: false })
        .where('id', '=', approver1.id)
        .execute();

      const created = await draft(5_000);
      const submitted = await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

      expect(submitted.status).toBe(409);
      expect(submitted.body.code).toBe(ErrorCode.SUBTHRESHOLD_APPROVER_UNASSIGNED);
      // Must name the sub-threshold setting, not "Approver 1".
      expect(submitted.body.message).toContain('below the expense threshold');
    });

    /**
     * Reported from the running system: both approver slots were assigned, and submitting a
     * sub-threshold requisition still said "Approver 1 is not assigned" — pointing the admin at
     * a screen that was already correct. Below the threshold the chain uses
     * SUBTHRESHOLD_APPROVER_USER_ID, which is a different setting entirely.
     */
    it('names the sub-threshold setting, not the approver slots, when it is unset', async () => {
      // Slots stay assigned. Only the sub-threshold approver is missing.
      await ctx.db
        .updateTable('app_settings')
        .set({ value: JSON.stringify(null) })
        .where('key', '=', SettingKey.SUBTHRESHOLD_APPROVER_USER_ID)
        .execute();
      settings.clearCache();

      const created = await draft(5_000);
      const submitted = await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

      expect(submitted.status).toBe(409);
      // Its own code, because the web app picks its copy from the code and would otherwise show
      // the approver-slots wording however specific the server's message was.
      expect(submitted.body.code).toBe(ErrorCode.SUBTHRESHOLD_APPROVER_UNASSIGNED);
      expect(submitted.body.message).toContain('Sub-threshold approver');
      // It may *mention* the slots to say they do not apply; what it must never do is claim
      // they are unassigned, which is what sent the admin to the wrong screen.
      expect(submitted.body.message).not.toContain('Approver 1 is not assigned');
      expect(submitted.body.details?.setting).toBe('SUBTHRESHOLD_APPROVER_USER_ID');

      // The slots really were assigned — proving the old message was misleading, not merely terse.
      const slots = await ctx.db.selectFrom('approver_slots').selectAll().execute();
      expect(slots.filter((slot) => slot.user_id !== null).length).toBeGreaterThan(0);
    });

    it('cannot be submitted twice', async () => {
      const created = await draft(5_000);
      await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

      const again = await requester.client.post(`/requisitions/${created.body.id}/submit`).send();
      expect(again.status).toBe(409);
      expect(again.body.code).toBe(ErrorCode.REQUISITION_INVALID_TRANSITION);
    });

    it('cannot be edited once submitted', async () => {
      const created = await draft(5_000);
      await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

      const edited = await requester.client.put(`/requisitions/${created.body.id}`).send({
        departmentId,
        items: [{ itemName: 'Sneaky', quantity: 1, estimatedUnitPrice: 1, productId: null, note: null }],
      });
      expect(edited.status).toBe(409);
    });
  });

  describe('the approval chain (task 3.4)', () => {
    it('walks submit → IM → both approvers → APPROVED', async () => {
      const created = await draft(20_000);
      let detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send()).body;

      // The IM goes first; approvers cannot act yet.
      const early = await approver1.client
        .post(`/requisitions/approvals/${approvalOf(detail, ApprovalStage.APPROVER, 1).id}/decision`)
        .send({ approve: true });
      expect(early.status).toBe(409);

      detail = (
        await im.client
          .post(
            `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
          )
          .send({ approve: true, note: 'not in stock' })
      ).body;
      expect(detail.status).toBe(RequisitionStatus.AWAITING_APPROVAL);

      // Approvers act in parallel, in no fixed order — slot 2 first here, deliberately.
      detail = (
        await approver2.client
          .post(`/requisitions/approvals/${approvalOf(detail, ApprovalStage.APPROVER, 2).id}/decision`)
          .send({ approve: true })
      ).body;
      expect(detail.status).toBe(RequisitionStatus.AWAITING_APPROVAL);

      detail = (
        await approver1.client
          .post(`/requisitions/approvals/${approvalOf(detail, ApprovalStage.APPROVER, 1).id}/decision`)
          .send({ approve: true })
      ).body;
      expect(detail.status).toBe(RequisitionStatus.APPROVED);
      expect(detail.decidedAt).not.toBeNull();

      const types = detail.events.map((e: { eventType: string }) => e.eventType);
      expect(types).toContain(RequisitionEventType.FULLY_APPROVED);
    });

    it('kills the whole request on a single approver rejection', async () => {
      const created = await draft(20_000);
      let detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send()).body;

      detail = (
        await im.client
          .post(
            `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
          )
          .send({ approve: true })
      ).body;

      detail = (
        await approver1.client
          .post(`/requisitions/approvals/${approvalOf(detail, ApprovalStage.APPROVER, 1).id}/decision`)
          .send({ approve: true })
      ).body;

      // One rejection is terminal, even though the other approver said yes.
      detail = (
        await approver2.client
          .post(`/requisitions/approvals/${approvalOf(detail, ApprovalStage.APPROVER, 2).id}/decision`)
          .send({ approve: false, note: 'over budget this quarter' })
      ).body;

      expect(detail.status).toBe(RequisitionStatus.REJECTED);
      const rejection = detail.approvals.find(
        (a: { action: string }) => a.action === ApprovalAction.REJECTED,
      );
      // "See why" needs the note, the name and the designation (task 3.6).
      expect(rejection.note).toBe('over budget this quarter');
      expect(rejection.assignedUserDesignation).toBeTruthy();
    });

    it('an IM rejection is terminal before any approver sees it', async () => {
      const created = await draft(20_000);
      const detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send())
        .body;

      const rejected = (
        await im.client
          .post(
            `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
          )
          .send({ approve: false, note: 'we already have four of these' })
      ).body;

      expect(rejected.status).toBe(RequisitionStatus.REJECTED);
      expect(
        rejected.approvals.filter((a: { action: string }) => a.action === ApprovalAction.PENDING),
      ).toHaveLength(2);
    });

    it('refuses an approval that is not yours', async () => {
      const created = await draft(20_000);
      const detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send())
        .body;

      const stolen = await approver1.client
        .post(
          `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
        )
        .send({ approve: true });

      expect(stolen.status).toBe(403);
      expect(stolen.body.code).toBe(ErrorCode.NOT_YOUR_APPROVAL);
    });

    it('refuses a second decision on the same approval', async () => {
      const created = await draft(5_000);
      const detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send())
        .body;
      const imApproval = approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id;

      await im.client.post(`/requisitions/approvals/${imApproval}/decision`).send({ approve: true });
      const again = await im.client
        .post(`/requisitions/approvals/${imApproval}/decision`)
        .send({ approve: false });

      expect(again.status).toBe(409);
    });

    it('revises the approved amount down without touching the requested figure', async () => {
      const created = await draft(5_000);
      let detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send()).body;

      detail = (
        await im.client
          .post(
            `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
          )
          .send({ approve: true })
      ).body;

      detail = (
        await approver1.client
          .post(`/requisitions/approvals/${approvalOf(detail, ApprovalStage.APPROVER, 1).id}/decision`)
          .send({ approve: true, approvedAmount: 4_000 })
      ).body;

      expect(detail.status).toBe(RequisitionStatus.APPROVED);
      // The three money figures stay distinguishable (domain-context.md).
      expect(detail.requestedAmount).toBe(5_000);
      expect(detail.approvedAmount).toBe(4_000);
      expect(detail.events.map((e: { eventType: string }) => e.eventType)).toContain(
        RequisitionEventType.AMOUNT_REVISED,
      );
    });
  });

  describe('withdrawal', () => {
    it('returns an approved requisition to awaiting approval', async () => {
      const created = await draft(5_000);
      let detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send()).body;

      detail = (
        await im.client
          .post(
            `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
          )
          .send({ approve: true })
      ).body;

      const approverApproval = approvalOf(detail, ApprovalStage.APPROVER, 1).id;
      detail = (
        await approver1.client
          .post(`/requisitions/approvals/${approverApproval}/decision`)
          .send({ approve: true })
      ).body;
      expect(detail.status).toBe(RequisitionStatus.APPROVED);

      detail = (
        await approver1.client
          .post(`/requisitions/approvals/${approverApproval}/withdraw`)
          .send({ reason: 'need to re-check the quote' })
      ).body;

      expect(detail.status).toBe(RequisitionStatus.AWAITING_APPROVAL);
      expect(detail.events.map((e: { eventType: string }) => e.eventType)).toContain(
        RequisitionEventType.APPROVER_WITHDREW,
      );
    });

    it('can be re-approved after a withdrawal, and the tracker shows the whole history', async () => {
      const created = await draft(5_000);
      let detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send()).body;
      detail = (
        await im.client
          .post(
            `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
          )
          .send({ approve: true })
      ).body;

      const approval = approvalOf(detail, ApprovalStage.APPROVER, 1).id;
      await approver1.client.post(`/requisitions/approvals/${approval}/decision`).send({ approve: true });
      await approver1.client
        .post(`/requisitions/approvals/${approval}/withdraw`)
        .send({ reason: 'checking' });

      // The withdrawn row is PENDING again from the chain's point of view, so re-approving
      // has to work — this is the "approved, withdrawn, re-approved" tracker case (task 3.6).
      const reApproved = await approver1.client
        .post(`/requisitions/approvals/${approval}/decision`)
        .send({ approve: true });

      expect(reApproved.status).toBe(200);
      expect(reApproved.body.status).toBe(RequisitionStatus.APPROVED);

      const types = reApproved.body.events.map((e: { eventType: string }) => e.eventType);
      expect(types.filter((t: string) => t === RequisitionEventType.APPROVER_APPROVED)).toHaveLength(2);
      expect(types).toContain(RequisitionEventType.APPROVER_WITHDREW);
    });

    it('refuses to withdraw an approval that was never granted', async () => {
      const created = await draft(5_000);
      const detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send())
        .body;

      const withdrawn = await approver1.client
        .post(`/requisitions/approvals/${approvalOf(detail, ApprovalStage.APPROVER, 1).id}/withdraw`)
        .send({ reason: 'nothing to withdraw' });
      expect(withdrawn.status).toBe(409);
    });

    it('lets an approver withdraw a rejection and returns the chain to awaiting approval', async () => {
      const created = await draft(5_000);
      let detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send())
        .body;
      detail = (
        await im.client
          .post(
            `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
          )
          .send({ approve: true })
      ).body;

      const approval = approvalOf(detail, ApprovalStage.APPROVER, 1).id;
      await approver1.client.post(`/requisitions/approvals/${approval}/decision`).send({ approve: false });
      const after = await approver1.client
        .post(`/requisitions/approvals/${approval}/withdraw`)
        .send({ reason: 'changed my mind' });

      expect(after.status).toBe(200);
      expect(after.body).toBeDefined();
      expect(after.body.status).toBe(RequisitionStatus.AWAITING_APPROVAL);
      expect(
        (after.body.approvals as Array<{ id: string; action: string }>).find((a) => a.id === approval)
          ?.action,
      ).toBe(ApprovalAction.WITHDRAWN);
      // The withdrawal event records the stage so the timeline can distinguish IM vs approver.
      const types = (after.body.events as Array<{ eventType: string }>).map((e) => e.eventType);
      expect(types).toContain(RequisitionEventType.APPROVER_WITHDREW);
    });

    it('lets the IM withdraw a rejection and returns the chain to IM review', async () => {
      const created = await draft(5_000);
      const detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send())
        .body;
      const imApproval = approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id;

      await im.client.post(`/requisitions/approvals/${imApproval}/decision`).send({ approve: false });
      const after = await im.client
        .post(`/requisitions/approvals/${imApproval}/withdraw`)
        .send({ reason: 'wrong call' });

      expect(after.status).toBe(200);
      expect(after.body.status).toBe(RequisitionStatus.IM_REVIEW);
      expect(
        (after.body.approvals as Array<{ id: string; action: string }>).find((a) => a.id === imApproval)
          ?.action,
      ).toBe(ApprovalAction.WITHDRAWN);
    });
  });

  describe('delegation (task 3.5)', () => {
    const isoIn = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

    it('lets a live delegate act on the approver’s behalf and records who did it', async () => {
      const delegate = await actorFor([Role.GENERAL, Role.APPROVER]);
      await approver1.client
        .post('/requisitions/delegations')
        .send({ delegateUserId: delegate.id, startsAt: isoIn(-1), endsAt: isoIn(24) });

      const created = await draft(5_000);
      let detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send()).body;
      detail = (
        await im.client
          .post(
            `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
          )
          .send({ approve: true })
      ).body;

      const acted = await delegate.client
        .post(`/requisitions/approvals/${approvalOf(detail, ApprovalStage.APPROVER, 1).id}/decision`)
        .send({ approve: true });

      expect(acted.status).toBe(200);
      const approval = acted.body.approvals.find(
        (a: { stage: string }) => a.stage === ApprovalStage.APPROVER,
      );
      // "Approved by X on behalf of Y" — the assignee stays, the actor is recorded alongside.
      expect(approval.assignedUserId).toBe(approver1.id);
      expect(approval.actedByUserId).toBe(delegate.id);
      expect(approval.actedByUserName).toBeTruthy();
    });

    it('an expired delegation grants nothing', async () => {
      const delegate = await actorFor([Role.GENERAL, Role.APPROVER]);
      await approver1.client
        .post('/requisitions/delegations')
        .send({ delegateUserId: delegate.id, startsAt: isoIn(-48), endsAt: isoIn(-24) });

      const created = await draft(5_000);
      let detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send()).body;
      detail = (
        await im.client
          .post(
            `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
          )
          .send({ approve: true })
      ).body;

      const refused = await delegate.client
        .post(`/requisitions/approvals/${approvalOf(detail, ApprovalStage.APPROVER, 1).id}/decision`)
        .send({ approve: true });

      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe(ErrorCode.NOT_YOUR_APPROVAL);
    });

    it('a future delegation grants nothing yet', async () => {
      const delegate = await actorFor([Role.GENERAL, Role.APPROVER]);
      const created = await approver1.client
        .post('/requisitions/delegations')
        .send({ delegateUserId: delegate.id, startsAt: isoIn(24), endsAt: isoIn(48) });

      expect(created.body.isCurrentlyEffective).toBe(false);
    });

    it('refuses a delegate who is not an approver', async () => {
      const plain = await actorFor([Role.GENERAL]);
      const refused = await approver1.client
        .post('/requisitions/delegations')
        .send({ delegateUserId: plain.id, startsAt: isoIn(-1), endsAt: isoIn(24) });

      expect(refused.status).toBe(409);
    });

    it('a revoked delegation stops working immediately', async () => {
      const delegate = await actorFor([Role.GENERAL, Role.APPROVER]);
      const delegation = await approver1.client
        .post('/requisitions/delegations')
        .send({ delegateUserId: delegate.id, startsAt: isoIn(-1), endsAt: isoIn(24) });

      await approver1.client.delete(`/requisitions/delegations/${delegation.body.id}`).send();

      const created = await draft(5_000);
      let detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send()).body;
      detail = (
        await im.client
          .post(
            `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
          )
          .send({ approve: true })
      ).body;

      const refused = await delegate.client
        .post(`/requisitions/approvals/${approvalOf(detail, ApprovalStage.APPROVER, 1).id}/decision`)
        .send({ approve: true });
      expect(refused.status).toBe(403);
    });
  });

  describe('visibility and queues', () => {
    it('a requester without an approval role only sees their own', async () => {
      await draft(5_000);
      const other = await actorFor([Role.GENERAL]);

      const theirs = await other.client.get('/requisitions');
      expect(theirs.body.items).toHaveLength(0);

      const mine = await requester.client.get('/requisitions');
      expect(mine.body.total).toBe(1);
    });

    it('refuses to show someone else’s requisition to a plain user', async () => {
      const created = await draft(5_000);
      const other = await actorFor([Role.GENERAL]);

      const peeked = await other.client.get(`/requisitions/${created.body.id}`);
      expect(peeked.status).toBe(403);
    });

    it('the awaiting-me queue only shows what the caller can act on right now', async () => {
      const created = await draft(20_000);
      const detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send())
        .body;

      // While it sits in IM_REVIEW the approvers have nothing to do.
      expect((await im.client.get('/requisitions/awaiting-count')).body.count).toBe(1);
      expect((await approver1.client.get('/requisitions/awaiting-count')).body.count).toBe(0);

      await im.client
        .post(
          `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
        )
        .send({ approve: true });

      expect((await im.client.get('/requisitions/awaiting-count')).body.count).toBe(0);
      expect((await approver1.client.get('/requisitions/awaiting-count')).body.count).toBe(1);
      expect((await approver2.client.get('/requisitions/awaiting-count')).body.count).toBe(1);
    });

    it('a plain user cannot read the approver queue count', async () => {
      const other = await actorFor([Role.GENERAL]);
      expect((await other.client.get('/requisitions/awaiting-count')).status).toBe(403);
    });
  });

  describe('cancellation', () => {
    it('lets the requester cancel while it is still with the IM', async () => {
      const created = await draft(5_000);
      await requester.client.post(`/requisitions/${created.body.id}/submit`).send();

      const cancelled = await requester.client.post(`/requisitions/${created.body.id}/cancel`).send();
      expect(cancelled.body.status).toBe(RequisitionStatus.CANCELLED);
    });

    it('refuses to cancel once the approvers hold it', async () => {
      const created = await draft(5_000);
      const detail = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send())
        .body;
      await im.client
        .post(
          `/requisitions/approvals/${approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id}/decision`,
        )
        .send({ approve: true });

      const cancelled = await requester.client.post(`/requisitions/${created.body.id}/cancel`).send();
      expect(cancelled.status).toBe(409);
    });

    it('refuses to cancel someone else’s requisition', async () => {
      const created = await draft(5_000);
      const other = await actorFor([Role.GENERAL]);

      const cancelled = await other.client.post(`/requisitions/${created.body.id}/cancel`).send();
      expect(cancelled.status).toBe(403);
    });
  });

  /**
   * Query-string parsing. The SPA's `toSearchParams` always sends its booleans
   * as strings; an Express query parser delivers them as strings too. The IM
   * portal bug fix (July 2026) caught the case where `?mine=false` was being
   * coerced to `true` and the IM's "All requisitions" list silently returned
   * zero rows because the filter matched only requisitions the IM raised.
   */
  describe('list query boolean coercion', () => {
    it('treats mine=false as "all requisitions", not "my requisitions"', async () => {
      // The IM is not the requester, so a mis-coerced true would return zero rows.
      // The suite is append-only on `requisitions` (see resetData in factories.ts),
      // so we assert the *direction* of the bug: a coerced `mine=true` would return
      // exactly zero for the IM, whereas the correct `mine=false` returns the rows
      // the requester created in this test plus everything carried over.
      const before = await im.client
        .get('/requisitions')
        .query({ page: 1, limit: 25, mine: 'true', awaitingMe: 'false' })
        .send();
      expect(before.body.total).toBe(0);

      await draft(5_000);
      await draft(7_500);

      const after = await im.client
        .get('/requisitions')
        .query({ page: 1, limit: 25, mine: 'false', awaitingMe: 'false' })
        .send();

      expect(after.status).toBe(200);
      // The two drafts we just created are now visible to the IM.
      expect(after.body.total).toBeGreaterThanOrEqual(2);
    });

    it('still scopes to the actor when mine=true is explicit', async () => {
      await draft(5_000);

      const own = await im.client
        .get('/requisitions')
        .query({ page: 1, limit: 25, mine: 'true' })
        .send();
      expect(own.body.total).toBe(0);

      const actor = await requester.client
        .get('/requisitions')
        .query({ page: 1, limit: 25, mine: 'true' })
        .send();
      expect(actor.body.total).toBeGreaterThanOrEqual(1);
    });
  });
});
