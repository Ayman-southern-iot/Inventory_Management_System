import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, RequisitionStatus, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData, seedSubthresholdApprover } from './factories';

/**
 * D-006. Requirements §3 scopes department, project, reason and approval deadline per request,
 * but never says any of them is mandatory, so QA could submit REQ-000003 carrying none of them.
 * A requisition with no deadline can never trigger the §5 reminder it is entitled to, and one
 * with no department is invisible to every expenditure report.
 *
 * Ayman's ruling, 2026-08-26: department, approval deadline and reason are required **at submit
 * only**; project stays optional, because no project means personal development rather than a
 * missing answer. Recorded in DECISIONS.md — the requirements are silent, so this is DERIVED.
 *
 * "At submit only" is half the rule and the easier half to lose, so it is tested in both
 * directions: an incomplete draft must still save.
 */
describe('a submission must carry its request-level fields', () => {
  let ctx: TestApp;
  let requester: { id: string; client: HttpClient };
  let approver: { id: string; client: HttpClient };
  let departmentId: string;

  const actorFor = async (roles: Role[]) => {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return { id: user.id, client: http.as(session.accessToken) };
  };

  // An instant since migration 0027. The .slice(0, 10) this used to carry is what the contract
  // now rejects.
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

  const COMPLETE = () => ({
    departmentId,
    approvalDeadline: tomorrow(),
    reason: 'Bench power supply for the RF rig',
    urgency: 'NORMAL',
    items: [
      { itemName: 'Widget', quantity: 1, estimatedUnitPrice: 500, productId: null, note: null },
    ],
  });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    requester = await actorFor([Role.GENERAL]);
    approver = await actorFor([Role.GENERAL, Role.APPROVER]);
    // The IM stage is the first approval, so a submission with no active Inventory Manager is
    // refused before the completeness gate is even reached.
    await actorFor([Role.GENERAL, Role.INVENTORY_MANAGER]);
    await seedSubthresholdApprover(ctx, approver.id);

    const department = await ctx.db
      .insertInto('departments')
      .values({ name: `Dept ${Date.now()}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    departmentId = department.id;
  });

  const createThenSubmit = async (overrides: Record<string, unknown>) => {
    const created = await requester.client.post('/requisitions').send({
      ...COMPLETE(),
      ...overrides,
    });
    expect(created.status).toBe(201);
    const submitted = await requester.client
      .post(`/requisitions/${created.body.id}/submit`)
      .send();
    return { created, submitted };
  };

  it.each([
    ['department', { departmentId: null }, 'Department'],
    ['approval deadline', { approvalDeadline: null }, 'Approval deadline'],
    ['reason', { reason: null }, 'Reason'],
  ])('refuses to submit without a %s', async (_label, overrides, fieldName) => {
    const { submitted } = await createThenSubmit(overrides);

    expect(submitted.status).toBe(409);
    expect(submitted.body.code).toBe(ErrorCode.REQUISITION_INCOMPLETE);
    expect(submitted.body.details.missing).toContain(fieldName);
  });

  it('names every missing field at once, so the requester fixes them in one pass', async () => {
    const { submitted } = await createThenSubmit({
      departmentId: null,
      approvalDeadline: null,
      reason: null,
    });

    expect(submitted.body.details.missing).toEqual([
      'Department',
      'Approval deadline',
      'Reason',
    ]);
  });

  it('treats whitespace as a missing reason rather than as an answer', async () => {
    const { submitted } = await createThenSubmit({ reason: '   ' });

    expect(submitted.status).toBe(409);
    expect(submitted.body.details.missing).toContain('Reason');
  });

  it('keeps the incomplete requisition as a draft rather than discarding the work', async () => {
    const { created, submitted } = await createThenSubmit({ departmentId: null });
    expect(submitted.status).toBe(409);

    const fetched = await requester.client.get(`/requisitions/${created.body.id}`);
    expect(fetched.body.status).toBe(RequisitionStatus.DRAFT);
  });

  it('still saves a draft that is missing all three', async () => {
    const created = await requester.client.post('/requisitions').send({
      ...COMPLETE(),
      departmentId: null,
      approvalDeadline: null,
      reason: null,
    });

    // The point of the ruling: incomplete is fine until you submit.
    expect(created.status).toBe(201);
    expect(created.body.status).toBe(RequisitionStatus.DRAFT);
  });

  it('submits without a project, because no project means personal development', async () => {
    const { submitted } = await createThenSubmit({ projectId: null });

    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe(RequisitionStatus.IM_REVIEW);
  });

  /**
   * D-003. The deadline field's helper text says "Pick today or later" and the browser enforced
   * it; the API did not, so a requisition could be submitted already Overdue and trip the §5
   * reminder at the moment of submission.
   */
  it('refuses to submit a deadline that has already passed', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const { created, submitted } = await createThenSubmit({ approvalDeadline: yesterday });

    expect(submitted.status).toBe(409);
    expect(submitted.body.code).toBe(ErrorCode.APPROVAL_DEADLINE_IN_PAST);

    // The work is kept, exactly as for an incomplete requisition.
    const fetched = await requester.client.get(`/requisitions/${created.body.id}`);
    expect(fetched.body.status).toBe(RequisitionStatus.DRAFT);
  });

  it('accepts a deadline later today', async () => {
    const inAnHour = new Date(Date.now() + 3_600_000).toISOString();
    const { submitted } = await createThenSubmit({ approvalDeadline: inAnHour });

    expect(submitted.status).toBe(200);
  });

  /**
   * The rule that migration 0027 made expressible, and Ayman's ruling of 2026-08-26 required:
   * "previous time and date not accepted".
   *
   * The old calendar-day comparison could not see this. It asked whether the deadline's *day*
   * was before today's, so 09:00 this morning passed at 17:00 this afternoon — a requisition
   * submitted against a deadline that had already gone, which is the exact thing D-003 exists to
   * refuse. Only the column carrying a time makes the distinction possible at all.
   */
  it('refuses a deadline earlier today, which the old date-only rule let through', async () => {
    const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { submitted } = await createThenSubmit({ approvalDeadline: anHourAgo });

    expect(submitted.status).toBe(409);
    expect(submitted.body.code).toBe(ErrorCode.APPROVAL_DEADLINE_IN_PAST);
  });

  it('lets a draft keep a stale deadline until it is submitted', async () => {
    const longGone = new Date(2020, 0, 1, 12, 0).toISOString();
    const created = await requester.client.post('/requisitions').send({
      ...COMPLETE(),
      approvalDeadline: longGone,
    });

    expect(created.status).toBe(201);
    expect(Date.parse(created.body.approvalDeadline)).toBe(Date.parse(longGone));
  });

  it('submits when all three are present', async () => {
    const { submitted } = await createThenSubmit({});

    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe(RequisitionStatus.IM_REVIEW);
  });
});
