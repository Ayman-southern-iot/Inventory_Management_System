import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role, SettingKey } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * Phase 06 task 6.6 — requirements §10 (docs/reference/10-permissions.md:19):
 *
 *   "An approver cannot approve their own requisition — the system skips to the next configured
 *    approver and logs the substitution."
 *
 * Before this suite existed the rule was documented and completely unimplemented: the Inventory
 * Manager raising a requisition was assigned their own IM approval and could clear it on the
 * happy path, and an approver holding slot 1 was assigned their own money approval. Both fired
 * without any crafted request.
 *
 * The tests are written against the substitution *outcome* — who ends up assigned — rather than
 * against the internals, because that is what a self-approval bug actually looks like.
 */
describe('self-approval (requirements §10, OQ-07)', () => {
  let ctx: TestApp;
  let settings: SettingsService;

  let departmentId: string;
  let requester: Actor;
  let im: Actor;
  let secondIm: Actor;
  let approver1: Actor;
  let approver2: Actor;
  let approver3: Actor;

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
    approver3 = await actorFor([Role.GENERAL, Role.APPROVER]);

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

  it('never assigns an Inventory Manager the review of their own requisition', async () => {
    const submitted = await submitAs(im, 500);
    expect(submitted.status).toBe(200);

    const reviewers = assigneesOf(submitted, 'INVENTORY_MANAGER');
    expect(reviewers).toHaveLength(1);
    expect(reviewers).not.toContain(im.id);
    // The other active IM stands in, rather than the submit being refused outright.
    expect(reviewers[0]).toBe(secondIm.id);
  });

  it('refuses the submit when the only Inventory Manager is the requester', async () => {
    await ctx.db
      .updateTable('users')
      .set({ is_active: false })
      .where('id', '=', secondIm.id)
      .execute();

    const submitted = await submitAs(im, 500);
    expect(submitted.status).toBe(409);
    // Its own code: "appoint another IM" is a different instruction from "fill in a slot".
    expect(submitted.body.code).toBe(ErrorCode.SELF_APPROVAL_NO_SUBSTITUTE);
  });

  /* -------------------------------------------------------------- the approvers */

  it('stands another approver in when the requester holds slot 1', async () => {
    const submitted = await submitAs(approver1, (await threshold()) + 1000);
    expect(submitted.status).toBe(200);

    const approvers = assigneesOf(submitted, 'APPROVER');
    expect(approvers).not.toContain(approver1.id);
    // Slot 2 keeps its holder, and the count is still two — a self-approval must not quietly
    // turn an above-threshold requisition into a one-approver one.
    expect(approvers).toHaveLength(2);
    expect(approvers.sort()).toEqual([approver2.id, approver3.id].sort());
  });

  it('does not seat the same substitute in two slots', async () => {
    // Both slot holders are the same person, who is also the requester. There is exactly one
    // other approver, so two distinct non-requester approvers cannot be found.
    await ctx.db
      .updateTable('approver_slots')
      .set({ user_id: approver1.id })
      .where('slot_no', '=', 2)
      .execute();
    await ctx.db
      .updateTable('users')
      .set({ is_active: false })
      .where('id', '=', approver2.id)
      .execute();

    const submitted = await submitAs(approver1, (await threshold()) + 1000);
    expect(submitted.status).toBe(409);
    expect(submitted.body.code).toBe(ErrorCode.SELF_APPROVAL_NO_SUBSTITUTE);
  });

  it('refuses when the requester holds a slot and no other approver exists', async () => {
    for (const spare of [approver2, approver3]) {
      await ctx.db
        .updateTable('users')
        .set({ is_active: false })
        .where('id', '=', spare.id)
        .execute();
    }

    const submitted = await submitAs(approver1, (await threshold()) + 1000);
    expect(submitted.status).toBe(409);
  });

  it('substitutes the sub-threshold approver from the slot chain when they are the requester', async () => {
    // approver1 is both the designated sub-threshold approver and the requester. The setting
    // holds exactly one person, so the stand-in has to come from the slot chain.
    const submitted = await submitAs(approver1, 500);
    expect(submitted.status).toBe(200);

    const approvers = assigneesOf(submitted, 'APPROVER');
    expect(approvers).toHaveLength(1);
    expect(approvers).not.toContain(approver1.id);
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
