import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role, SettingKey } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData , futureDeadline} from './factories';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * Nobody is assigned to approve their own requisition — their stage is not created.
 *
 * Ayman's ruling, 2026-09-01, replacing the substitution model (OQ-07).
 *
 * **On the authority for this.** The old header quoted `docs/reference/10-permissions.md` as if
 * it were requirements §10. It is not: the requirements document contains no self-approval rule
 * at all, and the transcription's own notes say so — "No self-approval rule. Nothing prohibits
 * an approver approving their own request. The entire substitution mechanism is derived." The
 * whole of this behaviour is DERIVED, which is why it could be changed on a ruling.
 *
 * **Why it changed.** Substitution stood somebody else in at every stage the requester
 * occupied, and refused the submit outright when there was nobody to stand in. In an office
 * with one Inventory Manager that meant the IM could never raise a requisition — the system was
 * unusable for one of the people who run it.
 *
 * **Skipped, not auto-approved.** The stage is absent rather than recorded as approved by its
 * own requester, so the audit trail never shows a person signing off their own money.
 *
 * The tests read the *outcome* — who ends up assigned — rather than the internals, because that
 * is what a self-approval bug actually looks like.
 */
describe('a requester never approves their own requisition', () => {
  let ctx: TestApp;
  let settings: SettingsService;

  let departmentId: string;
  let requester: Actor;
  let im: Actor;
  let secondIm: Actor;
  let approver1: Actor;
  let approver2: Actor;

  interface Actor {
    id: string;
    client: HttpClient;
  }

  const actorFor = async (roles: Role[]): Promise<Actor> => {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return { id: user.id, client: http.as(session.accessToken) };
  };

  const auditContext = {
    actorId: null,
    actorName: null,
    actorEmail: null,
    actorRoles: [],
    requestMethod: 'TEST',
    requestPath: 'test://self-approval.int-spec',
    requestIp: null,
    userAgent: 'self-approval.int-spec.ts',
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
    secondIm = await actorFor([Role.GENERAL, Role.INVENTORY_MANAGER]);
    approver1 = await actorFor([Role.GENERAL, Role.APPROVER]);
    approver2 = await actorFor([Role.GENERAL, Role.APPROVER]);

    const department = await ctx.db
      .insertInto('departments')
      .values({ name: `SelfApproval ${Date.now()}-${Math.random()}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    departmentId = department.id;

    // Migration 0004 constrains slot_no to (1, 2), so there is no third slot to fall through
    // to. approver3 holds no slot at all and is the substitute pool.
    await ctx.db
      .insertInto('approver_slots')
      .values([
        { department_id: null, slot_no: 1, user_id: approver1.id },
        { department_id: null, slot_no: 2, user_id: approver2.id },
      ])
      .execute();

    await settings.set(SettingKey.SUBTHRESHOLD_APPROVER_USER_ID, approver1.id, auditContext);
  });

  /* ------------------------------------------------------------------ helpers */

  /** Raises a draft as `actor` for exactly `amount`, and submits it. */
  const submitAs = async (actor: Actor, amount: number) => {
    const created = await actor.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'Self-approval test',
      items: [
        {
          itemName: 'Widget',
          quantity: 1,
          estimatedUnitPrice: amount,
          productId: null,
          note: null,
        },
      ],
    });
    expect(created.status).toBe(201);
    return actor.client.post(`/requisitions/${created.body.id}/submit`).send();
  };

  const assigneesOf = (
    submitted: { body: { approvals: Array<{ stage: string; assignedUserId: string }> } },
    stage: string,
  ) =>
    submitted.body.approvals
      .filter((approval) => approval.stage === stage)
      .map((approval) => approval.assignedUserId);

  const threshold = async (): Promise<number> => settings.get(SettingKey.EXPENSE_THRESHOLD_BDT);

  /* ------------------------------------------------------- the Inventory Manager */

  it('creates no IM stage when the Inventory Manager is the requester', async () => {
    const submitted = await submitAs(im, 500);
    expect(submitted.status).toBe(200);

    // Not reassigned to the other IM — absent. The IM is the person who would have checked
    // "do we already have this", and they know.
    expect(assigneesOf(submitted, 'INVENTORY_MANAGER')).toEqual([]);
    expect(submitted.body.status).toBe('AWAITING_APPROVAL');
  });

  /**
   * The failure that made the old model unusable: one Inventory Manager, who therefore could
   * never raise a requisition, because there was nobody to substitute and submit refused.
   */
  it('lets the only Inventory Manager raise a requisition at all', async () => {
    await ctx.db
      .updateTable('users')
      .set({ is_active: false })
      .where('id', '=', secondIm.id)
      .execute();

    const submitted = await submitAs(im, 500);
    expect(submitted.status).toBe(200);
    expect(assigneesOf(submitted, 'INVENTORY_MANAGER')).toEqual([]);
  });

  /* -------------------------------------------------------------- the approvers */

  it('drops the requester\u2019s own slot and keeps the others', async () => {
    const submitted = await submitAs(approver1, (await threshold()) + 1000);
    expect(submitted.status).toBe(200);

    const approvers = assigneesOf(submitted, 'APPROVER');
    expect(approvers).not.toContain(approver1.id);
    // The other slot holder still has to sign. Their slot is gone, not filled by somebody else,
    // so the count drops to one rather than staying at two.
    expect(approvers).toEqual([approver2.id]);
    expect(submitted.body.requiredApproverCount).toBe(1);
  });

  it('leaves no approver stage when the requester holds every slot', async () => {
    await ctx.db
      .updateTable('approver_slots')
      .set({ user_id: approver1.id })
      .where('slot_no', '=', 2)
      .execute();

    const submitted = await submitAs(approver1, (await threshold()) + 1000);
    expect(submitted.status).toBe(200);
    expect(assigneesOf(submitted, 'APPROVER')).toEqual([]);
  });

  /**
   * Below the threshold the policy names exactly one approver. When that person is the one
   * asking, there is nobody left to ask — and Ayman's ruling for that case (2026-09-01) is that
   * it stands: below the threshold, their own money, their own authority.
   */
  it('needs no approver when the sub-threshold approver raises it themselves', async () => {
    const submitted = await submitAs(approver1, 500);
    expect(submitted.status).toBe(200);

    expect(assigneesOf(submitted, 'APPROVER')).toEqual([]);
    // The IM stage still stands — approver1 is not the Inventory Manager.
    expect(assigneesOf(submitted, 'INVENTORY_MANAGER')).toEqual([im.id]);
    expect(submitted.body.status).toBe('IM_REVIEW');
  });

  /**
   * Both stages skipped at once: an Inventory Manager who is also the designated sub-threshold
   * approver, raising a small requisition of their own. Nothing is left to wait for, so it is
   * approved on submit rather than sitting in a queue nobody is watching.
   */
  it('stands approved on submit when every stage belongs to the requester', async () => {
    await settings.set(SettingKey.SUBTHRESHOLD_APPROVER_USER_ID, im.id, auditContext);

    const submitted = await submitAs(im, 500);
    expect(submitted.status).toBe(200);

    expect(assigneesOf(submitted, 'INVENTORY_MANAGER')).toEqual([]);
    expect(assigneesOf(submitted, 'APPROVER')).toEqual([]);
    expect(submitted.body.status).toBe('APPROVED');
  });
  it('leaves the ordinary case completely alone', async () => {
    // A General user raising a requisition holds no slot, so nothing is substituted and the
    // configured chain is used exactly as an administrator set it up.
    const submitted = await submitAs(requester, (await threshold()) + 1000);
    expect(submitted.status).toBe(200);

    expect(assigneesOf(submitted, 'INVENTORY_MANAGER')).toEqual([im.id]);
    expect(assigneesOf(submitted, 'APPROVER').sort()).toEqual([approver1.id, approver2.id].sort());
  });

  /* -------------------------------------------------------------- the backstop */

  it('refuses a decision on your own requisition even if a row somehow assigns it to you', async () => {
    const submitted = await submitAs(requester, 500);
    expect(submitted.status).toBe(200);

    const requisitionId = submitted.body.id as string;
    const imApproval = submitted.body.approvals.find(
      (approval: { stage: string }) => approval.stage === 'INVENTORY_MANAGER',
    );

    // Reassign the IM approval to the requester behind the service's back — the shape a row
    // predating this rule has, and the shape a future delegation bug would produce.
    await ctx.db
      .updateTable('requisition_approvals')
      .set({ assigned_user_id: requester.id })
      .where('id', '=', imApproval.id)
      .execute();

    const decided = await requester.client
      .post(`/requisitions/approvals/${imApproval.id}/decision`)
      .send({ approve: true });

    expect(decided.status).toBe(403);
    expect(decided.body.code).toBe(ErrorCode.SELF_APPROVAL_FORBIDDEN);

    // And the requisition did not move.
    const after = await requester.client.get(`/requisitions/${requisitionId}`);
    expect(after.body.status).toBe('IM_REVIEW');
  });
});
