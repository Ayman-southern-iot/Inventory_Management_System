import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PAGINATION_MAX_LIMIT, Role, type Paginated, type SelectableUser } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, createUserAndLogin, resetData } from './factories';

/**
 * D-023 / OQ-29. The only user-list endpoint was `@Roles(ADMIN) /admin/users`, so an approver
 * could not populate a delegate picker and the IM could not populate the borrow-to-user picker.
 * One resource, one filter, for both.
 *
 * It is a permissions expansion and treated as one: it exposes exactly the fields
 * `ApprovalTracker` already renders to any approver (name and designation) and nothing else —
 * no email, no roles, no department, no `last_login_at`.
 */
describe('GET /users/selectable', () => {
  let ctx: TestApp;
  let http: HttpClient;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    http = httpClient(ctx.app);
  });

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const { user, client } = await createUserAndLogin(ctx.db, http, { roles });
    return { id: user.id, client };
  }

  const fetch = (client: HttpClient, query = '') =>
    client.get(`/users/selectable?page=1&limit=${PAGINATION_MAX_LIMIT}${query}`);

  it('lets an approver list active approvers', async () => {
    const approver = await signIn([Role.GENERAL, Role.APPROVER]);
    const other = await createUser(ctx.db, { roles: [Role.APPROVER], fullName: 'Other Approver' });

    const response = await fetch(approver.client, `&role=${Role.APPROVER}`);

    expect(response.status).toBe(200);
    const body = response.body as Paginated<SelectableUser>;
    expect(body.items.map((u) => u.id)).toContain(other.id);
    expect(body.items.find((u) => u.id === other.id)?.fullName).toBe('Other Approver');
  });

  it('lets the Inventory Manager list every active user, unfiltered by role', async () => {
    const im = await signIn([Role.GENERAL, Role.INVENTORY_MANAGER]);
    const plain = await createUser(ctx.db, { roles: [Role.GENERAL], fullName: 'Plain Person' });

    const response = await fetch(im.client);

    expect(response.status).toBe(200);
    expect((response.body as Paginated<SelectableUser>).items.map((u) => u.id)).toContain(plain.id);
  });

  it('excludes deactivated users — a picker must not offer someone who cannot act', async () => {
    const approver = await signIn([Role.GENERAL, Role.APPROVER]);
    const gone = await createUser(ctx.db, {
      roles: [Role.APPROVER],
      isActive: false,
      fullName: 'Departed Approver',
    });

    const response = await fetch(approver.client, `&role=${Role.APPROVER}`);

    expect((response.body as Paginated<SelectableUser>).items.map((u) => u.id)).not.toContain(gone.id);
  });

  /**
   * Ruling 2026-08-23: do NOT hide candidates who already hold a live delegation from the
   * caller. Filtering them out would make the one-live-delegation rule look like an empty
   * picker instead of the 409 it is.
   */
  it('still offers an approver who already holds a live delegation from the caller', async () => {
    const approver = await signIn([Role.GENERAL, Role.APPROVER]);
    const delegate = await createUser(ctx.db, { roles: [Role.APPROVER], fullName: 'Busy Delegate' });
    const granted = await approver.client.post('/requisitions/delegations').send({
      delegateUserId: delegate.id,
      startsAt: new Date(Date.now() - 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(granted.status).toBe(201);

    const response = await fetch(approver.client, `&role=${Role.APPROVER}`);

    expect((response.body as Paginated<SelectableUser>).items.map((u) => u.id)).toContain(delegate.id);
  });

  it('never returns an email, a role or a department', async () => {
    const approver = await signIn([Role.GENERAL, Role.APPROVER]);
    await createUser(ctx.db, { roles: [Role.APPROVER] });

    const response = await fetch(approver.client, `&role=${Role.APPROVER}`);

    const [first] = (response.body as Paginated<SelectableUser>).items;
    expect(first).toBeDefined();
    expect(Object.keys(first!).sort()).toEqual(['designation', 'fullName', 'id']);
    expect(JSON.stringify(response.body)).not.toContain('@');
  });

  it('denies a plain user', async () => {
    const plain = await signIn([Role.GENERAL]);

    expect((await fetch(plain.client)).status).toBe(403);
  });

  it('denies an unauthenticated caller', async () => {
    const anonymous = httpClient(ctx.app);

    expect((await fetch(anonymous)).status).toBe(401);
  });

  it('rejects a limit above the contract ceiling', async () => {
    const approver = await signIn([Role.GENERAL, Role.APPROVER]);

    const response = await approver.client.get(
      `/users/selectable?page=1&limit=${PAGINATION_MAX_LIMIT + 1}`,
    );

    expect(response.status).toBe(400);
  });
});
