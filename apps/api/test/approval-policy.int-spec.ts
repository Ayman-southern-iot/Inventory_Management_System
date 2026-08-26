import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, SettingKey, approversRequiredFor, type ApprovalPolicy } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData, restoreSeededSettings } from './factories';

/**
 * `GET /requisitions/approval-policy`.
 *
 * The requisition form tells the requester how many approvers their amount will need, live, as
 * they type. Before this the only route exposing the threshold was `@Roles(ADMIN)
 * /admin/settings`, so the form had no way to know it — and a threshold hardcoded into the SPA
 * would go stale the first time an admin changed it, which is the thing requirements §11 makes
 * runtime-configurable to avoid.
 */
describe('the approval policy is readable by anyone who can raise a requisition', () => {
  let ctx: TestApp;

  const actorFor = async (roles: Role[]): Promise<HttpClient> => {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return http.as(session.accessToken);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    // This spec writes EXPENSE_THRESHOLD_BDT through the admin endpoint and must put it back,
    // or it leaks into every spec that boots after it in the shared suite database.
    await restoreSeededSettings(ctx);
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
  });

  it('is readable by a plain General user', async () => {
    const general = await actorFor([Role.GENERAL]);
    const response = await general.get('/requisitions/approval-policy');

    expect(response.status).toBe(200);
    const policy = response.body as ApprovalPolicy;
    expect(policy.expenseThresholdBdt).toBe(15_000);
    expect(policy.approversAtOrAboveThreshold).toBe(2);
  });

  it('still requires a session', async () => {
    expect((await httpClient(ctx.app).get('/requisitions/approval-policy')).status).toBe(401);
  });

  /** The route is a literal and sits above `@Get(':id')`, which would otherwise swallow it. */
  it('is not mistaken for a requisition id', async () => {
    const general = await actorFor([Role.GENERAL]);
    const response = await general.get('/requisitions/approval-policy');
    expect(response.status).not.toBe(404);
    expect(response.body).toHaveProperty('expenseThresholdBdt');
  });

  it('follows the setting when an admin changes it', async () => {
    const admin = await actorFor([Role.GENERAL, Role.ADMIN]);
    const general = await actorFor([Role.GENERAL]);

    await admin
      .put('/admin/settings')
      .send({ key: SettingKey.EXPENSE_THRESHOLD_BDT, value: 42_000 });

    const policy = (await general.get('/requisitions/approval-policy')).body as ApprovalPolicy;
    // The whole point of the endpoint: a hardcoded 15,000 in the SPA would now be wrong.
    expect(policy.expenseThresholdBdt).toBe(42_000);
  });

  /**
   * The form and the server must not disagree about the boundary. `approversRequiredFor` is the
   * shared helper the note calls, and the server branches on `requestedAmount < threshold`
   * (OQ-01) — so exactly the threshold takes the higher count.
   */
  it('puts exactly the threshold on the higher count', async () => {
    const general = await actorFor([Role.GENERAL]);
    const policy = (await general.get('/requisitions/approval-policy')).body as ApprovalPolicy;

    expect(approversRequiredFor(policy.expenseThresholdBdt - 1, policy)).toBe(1);
    expect(approversRequiredFor(policy.expenseThresholdBdt, policy)).toBe(2);
    expect(approversRequiredFor(policy.expenseThresholdBdt + 1, policy)).toBe(2);
  });
});
