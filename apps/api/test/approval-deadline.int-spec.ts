import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalStage, RequisitionStatus, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createDepartment, createUser, futureDeadline, login, resetData, seedSubthresholdApprover } from './factories';
import { ApprovalDeadlineJob } from '../src/modules/requisitions/approval-deadline.job';

/**
 * Task 3.9's acceptance criterion, verbatim: a requisition whose deadline passes while nobody
 * is logged in still generates the reminder. That is why this drives the job directly rather
 * than through a request — no session exists in the scenario being tested.
 */
describe('approval deadline reminders', () => {
  let ctx: TestApp;
  let job: ApprovalDeadlineJob;
  let requester: { id: string; client: HttpClient };
  let im: { id: string; client: HttpClient };
  let approver: { id: string; client: HttpClient };
  let departmentId: string;

  const actorFor = async (roles: Role[]) => {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return { id: user.id, client: http.as(session.accessToken) };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    job = ctx.app.get(ApprovalDeadlineJob);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    requester = await actorFor([Role.GENERAL]);
    im = await actorFor([Role.GENERAL, Role.INVENTORY_MANAGER]);
    approver = await actorFor([Role.GENERAL, Role.APPROVER]);

    await ctx.db
      .insertInto('approver_slots')
      .values({ department_id: null, slot_no: 1, user_id: approver.id })
      .execute();

    await seedSubthresholdApprover(ctx, approver.id);
    departmentId = (await createDepartment(ctx.db)).id;

    // Requisitions cannot be deleted between tests — requisition_events is append-only — so
    // earlier overdue ones would keep answering the job and inflate every count. Stamping the
    // existing rows as already-reminded gives each test a quiet baseline; only the approvals
    // it creates are eligible.
    await ctx.db
      .updateTable('requisition_approvals')
      .set({ last_reminded_at: new Date() })
      .execute();
  });

  /**
   * Submits a small requisition (one approver) carrying the given deadline.
   *
   * D-006 made the deadline mandatory *at submit*, so a null one can no longer be submitted
   * through the API at all. A null deadline is still reachable in the data — every row written
   * before the rule has one — and the job must stay quiet about those, so that state is now
   * built the only way it can legitimately exist: submit a valid deadline, then clear the
   * column directly. The assertions below are unchanged; only the route to the state is.
   *
   * Past deadlines are written the same way. They are the whole subject of this spec, and D-003
   * will refuse them at submit for the same reason D-006 refuses a missing one.
   */
  const submitWithDeadline = async (approvalDeadline: string | null) => {
    const created = await requester.client.post('/requisitions').send({
      departmentId,
      reason: 'Deadline reminder fixture',
      approvalDeadline: futureDeadline(),
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: 500, productId: null, note: null },
      ],
    });
    const submitted = await requester.client
      .post(`/requisitions/${created.body.id}/submit`)
      .send();
    expect(submitted.status).toBe(200);

    await ctx.db
      .updateTable('requisitions')
      .set({ approval_deadline: approvalDeadline })
      .where('id', '=', created.body.id)
      .execute();

    const refreshed = await requester.client.get(`/requisitions/${created.body.id}`);
    return refreshed.body;
  };

  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  /** Makes one requisition's approvals eligible again, without touching anyone else's. */
  const clearReminders = (requisitionId: string) =>
    ctx.db
      .updateTable('requisition_approvals')
      .set({ last_reminded_at: null })
      .where('requisition_id', '=', requisitionId)
      .execute();

  it('reminds about an approval whose deadline has passed', async () => {
    await submitWithDeadline(yesterday());

    // Nobody has logged in or acted; the job is the only thing running.
    expect(await job.remind()).toBe(1);
  });

  it('says nothing about a deadline still in the future', async () => {
    await submitWithDeadline(tomorrow());
    expect(await job.remind()).toBe(0);
  });

  it('says nothing when there is no deadline at all', async () => {
    await submitWithDeadline(null);
    expect(await job.remind()).toBe(0);
  });

  it('does not repeat within the 24-hour window', async () => {
    await submitWithDeadline(yesterday());

    expect(await job.remind()).toBe(1);
    // The second tick, minutes later, must stay quiet or the reminder becomes noise.
    expect(await job.remind()).toBe(0);
  });

  it('reminds again once a day has passed and it is still unactioned', async () => {
    const detail = await submitWithDeadline(yesterday());
    expect(await job.remind()).toBe(1);

    // Rather than sleeping, backdate the marker — the behaviour under test is the window,
    // not the clock.
    await ctx.db
      .updateTable('requisition_approvals')
      .set({ last_reminded_at: new Date(Date.now() - 25 * 3_600_000) })
      .where('requisition_id', '=', detail.id)
      .execute();

    expect(await job.remind()).toBe(1);
  });

  it('stops once the approval is acted on', async () => {
    const detail = await submitWithDeadline(yesterday());
    const imApproval = detail.approvals.find(
      (a: { stage: string }) => a.stage === ApprovalStage.INVENTORY_MANAGER,
    );

    expect(await job.remind()).toBe(1);

    await im.client
      .post(`/requisitions/approvals/${imApproval.id}/decision`)
      .send({ approve: false, note: 'we already have these' });

    await clearReminders(detail.id);
    expect(await job.remind()).toBe(0);
  });

  it('only reminds the stage that can actually act', async () => {
    const detail = await submitWithDeadline(yesterday());
    await clearReminders(detail.id);

    // While it sits in IM_REVIEW, only the IM is chased — telling the approver to act on
    // something they cannot yet touch would train them to ignore the reminder.
    const first = await job.remind();
    expect(first).toBe(1);

    const imApproval = detail.approvals.find(
      (a: { stage: string }) => a.stage === ApprovalStage.INVENTORY_MANAGER,
    );
    await im.client.post(`/requisitions/approvals/${imApproval.id}/decision`).send({ approve: true });

    const moved = await requester.client.get(`/requisitions/${detail.id}`);
    expect(moved.body.status).toBe(RequisitionStatus.AWAITING_APPROVAL);

    await clearReminders(detail.id);
    // Now it is the approver's turn, so exactly one reminder again — for them this time.
    expect(await job.remind()).toBe(1);
  });
});
