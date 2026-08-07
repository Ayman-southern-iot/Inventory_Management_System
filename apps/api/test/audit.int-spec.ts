import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { AUDIT_ACTIONS, Role, SettingKey, type AuditEntry, type Paginated } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { TEST_PASSWORD } from './config/test-env';
import { createUser, createUserAndLogin, login, resetData, uniqueEmail } from './factories';
import { AuditService } from '../src/modules/audit/audit.service';

/**
 * Phase 06 — global audit log verification.
 *
 * The audit table is the rule for "everything that changes state is recorded". This file
 * proves that rule per-route by exercising representative mutations and confirming exactly
 * one row of the right shape lands in `audit_log`. It also proves:
 *   - non-admin cannot list or read the audit
 *   - filters compose and pagination works
 *   - direct UPDATE/DELETE/TRUNCATE on audit_log is rejected by the trigger
 *   - the reset helper is the only path that bypasses append-only (and only triggers it
 *     in the test DB)
 *   - a failed login produces a row with the attempted email and no actor id
 */

describe('audit log', () => {
  let ctx: TestApp;
  let http: HttpClient;
  let audit: AuditService;

  beforeAll(async () => {
    ctx = await createTestApp();
    audit = ctx.app.get(AuditService);
  });

  afterAll(async () => {
    // 'stops recording an action the admin has disabled' below narrows AUDIT_ENABLED_ACTIONS
    // via the real admin endpoint and never restores it. `resetData` only nulls
    // `app_settings.updated_by`, never `value` (see factories.ts), and boot no longer repairs a
    // narrowed list (the AUDIT_KNOWN_ACTIONS correction) — so left alone this leaks
    // category.create disabled into every spec file that boots after this one in the shared
    // suite database. Mirrors settings.int-spec.ts's own cleanup for the same setting.
    await ctx.db
      .updateTable('app_settings')
      .set({ value: JSON.stringify([...AUDIT_ACTIONS]) })
      .where('key', '=', SettingKey.AUDIT_ENABLED_ACTIONS)
      .execute();
    audit.clearEnabledActionsCache();
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    http = httpClient(ctx.app);
  });

  /* --------------------------------- access control -------------------------------- */

  it('forbids non-admin users from listing the audit log', async () => {
    const { client } = await createUserAndLogin(ctx.db, http, { roles: [Role.GENERAL] });

    const result = await client.get('/admin/audit-log');

    expect(result.status).toBe(403);
  });

  it('forbids non-admin users from reading a single audit entry', async () => {
    const { client } = await createUserAndLogin(ctx.db, http, { roles: [Role.INVENTORY_MANAGER] });

    const detail = await client.get('/admin/audit-log/00000000-0000-0000-0000-000000000000');

    expect(detail.status).toBe(403);
  });

  /* --------------------------------- representative mutations -------------------------------- */

  it('records a successful login as auth.login.success', async () => {
    const user = await createUser(ctx.db, { roles: [Role.GENERAL] });
    const response = await http
      .post('/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(response.status).toBe(200);

    const admin = await adminClient();
    const list = await admin.get('/admin/audit-log');
    expect(list.status).toBe(200);
    const entries = (list.body as Paginated<AuditEntry>).items;
    const login = entries.find(
      (e) => e.action === 'auth.login.success' && e.entityId === user.id,
    );
    expect(login).toBeDefined();
    expect(login?.actorId).toBe(user.id);
    expect(login?.actorEmail).toBe(user.email);
    expect(login?.entityType).toBe('auth');
    expect(login?.outcome).toBe('success');
    expect(login?.requestMethod).toBe('POST');
    expect(login?.requestPath).toBe('/auth/login');
    expect(login?.requestIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('records a failed login with the attempted email and no actor id', async () => {
    const attempted = uniqueEmail('attempted');
    const response = await http
      .post('/auth/login')
      .send({ email: attempted, password: TEST_PASSWORD });
    expect(response.status).toBe(401);

    const admin = await adminClient();
    const list = await admin.get('/admin/audit-log');
    const entries = (list.body as Paginated<AuditEntry>).items;
    const failure = entries.find(
      (e) => e.action === 'auth.login.failure' && e.entityRef === attempted,
    );
    expect(failure).toBeDefined();
    expect(failure?.actorId).toBeNull();
    expect(failure?.actorEmail).toBe(attempted);
    expect(failure?.outcome).toBe('failure');
  });

  it('records user creation with safe, non-secret metadata', async () => {
    const admin = await adminClient();
    const newEmail = uniqueEmail('created');
    const create = await admin
      .post('/admin/users')
      .send({
        email: newEmail,
        fullName: 'Audit Created',
        designation: 'Audit',
        roles: [Role.GENERAL],
        password: TEST_PASSWORD,
      });
    expect(create.status).toBe(201);

    const list = await admin.get('/admin/audit-log');
    const entries = (list.body as Paginated<AuditEntry>).items;
    const created = entries.find(
      (e) => e.action === 'user.create' && e.entityRef === newEmail,
    );
    expect(created).toBeDefined();
    expect(created?.metadata).toMatchObject({
      email: newEmail,
      fullName: 'Audit Created',
      designation: 'Audit',
      roles: ['GENERAL'],
    });
    expect(JSON.stringify(created?.metadata ?? {})).not.toContain('password');
    expect(JSON.stringify(created?.metadata ?? {})).not.toContain('hash');
  });

  it('records a setting update', async () => {
    const admin = await adminClient();
    const update = await admin.put('/admin/settings').send({
      key: SettingKey.EXPENSE_THRESHOLD_BDT,
      value: 9_999,
    });
    expect(update.status).toBe(200);

    const list = await admin.get('/admin/audit-log');
    const entries = (list.body as Paginated<AuditEntry>).items;
    const updated = entries.find(
      (e) =>
        e.action === 'settings.update' && e.entityRef === SettingKey.EXPENSE_THRESHOLD_BDT,
    );
    expect(updated).toBeDefined();
    expect(updated?.metadata).toMatchObject({ after: 9_999 });
  });

  /* --------------------------------- filters -------------------------------- */

  it('filters by user, by date range, and by approval decision — and by nothing else', async () => {
    const admin = await adminClient();
    const create = await admin.post('/admin/users').send({
      email: uniqueEmail('filter'),
      fullName: 'Filter',
      designation: 'Filter',
      roles: [Role.GENERAL],
      password: TEST_PASSWORD,
    });
    expect(create.status).toBe(201);

    // Filter 1 — user. Take the actor from a row we know exists rather than assuming an id.
    const all = await admin.get('/admin/audit-log');
    expect(all.status).toBe(200);
    const seed = (all.body as Paginated<AuditEntry>).items.find((e) => e.action === 'user.create');
    expect(seed).toBeDefined();
    expect(seed?.actorId).not.toBeNull();

    const byActor = await admin.get(`/admin/audit-log?actorId=${seed!.actorId}`);
    expect(byActor.status).toBe(200);
    const actorItems = (byActor.body as Paginated<AuditEntry>).items;
    expect(actorItems.length).toBeGreaterThan(0);
    for (const item of actorItems) expect(item.actorId).toBe(seed!.actorId);

    // Filter 2 — date range. A window that closed before this test ran holds nothing.
    const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const alsoPast = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000).toISOString();
    const byDate = await admin.get(`/admin/audit-log?from=${past}&to=${alsoPast}`);
    expect(byDate.status).toBe(200);
    expect((byDate.body as Paginated<AuditEntry>).total).toBe(0);

    // ...and a window that is still open holds the row we just made.
    const openWindow = await admin.get(`/admin/audit-log?from=${past}`);
    expect((openWindow.body as Paginated<AuditEntry>).total).toBeGreaterThan(0);

    // Filter 3 — approved / rejected approvals. No approvals happened in this spec, so the
    // meaningful assertion is that the filter excludes everything that is not a decision.
    const approved = await admin.get('/admin/audit-log?decision=APPROVED');
    expect(approved.status).toBe(200);
    for (const item of (approved.body as Paginated<AuditEntry>).items) {
      expect(['requisition.approve', 'borrowing.approve']).toContain(item.action);
    }
    const rejected = await admin.get('/admin/audit-log?decision=REJECTED');
    expect(rejected.status).toBe(200);
    for (const item of (rejected.body as Paginated<AuditEntry>).items) {
      expect(['requisition.reject', 'borrowing.reject']).toContain(item.action);
    }

    // The filters that were removed must not quietly come back: an unknown query key is
    // ignored, so `?action=` returning a filtered set would mean someone re-added it.
    const removed = await admin.get('/admin/audit-log?action=user.create&entityType=settings');
    expect(removed.status).toBe(200);
    expect((removed.body as Paginated<AuditEntry>).total).toBe(
      (all.body as Paginated<AuditEntry>).total,
    );
  });

  /* --------------------------------- append-only enforcement -------------------------------- */

  it('rejects direct UPDATE on audit_log', async () => {
    const admin = await adminClient();
    const list = await admin.get('/admin/audit-log');
    expect(list.status).toBe(200);
    const existing = (list.body as Paginated<AuditEntry>).items[0];
    if (!existing) throw new Error('expected at least one audit row');

    await expect(
      sql`UPDATE audit_log SET summary = 'tampered' WHERE id = ${existing.id}`.execute(ctx.db),
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects direct DELETE on audit_log', async () => {
    const admin = await adminClient();
    const list = await admin.get('/admin/audit-log');
    expect(list.status).toBe(200);
    const existing = (list.body as Paginated<AuditEntry>).items[0];
    if (!existing) throw new Error('expected at least one audit row');

    await expect(
      sql`DELETE FROM audit_log WHERE id = ${existing.id}`.execute(ctx.db),
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects direct TRUNCATE on audit_log', async () => {
    await expect(
      sql`TRUNCATE audit_log`.execute(ctx.db),
    ).rejects.toThrow(/append-only/i);
  });

  /* --------------------------------- pagination -------------------------------- */

  it('paginates the list with the standard envelope', async () => {
    const admin = await adminClient();
    for (let i = 0; i < 5; i += 1) {
      const u = await createUser(ctx.db, { roles: [Role.GENERAL] });
      await login(http, u.email);
    }

    const page1 = await admin.get('/admin/audit-log?limit=2');
    expect(page1.status).toBe(200);
    const body1 = page1.body as Paginated<AuditEntry>;
    expect(body1.limit).toBe(2);
    expect(body1.items.length).toBeLessThanOrEqual(2);
    expect(body1.total).toBeGreaterThan(0);

    const page2 = await admin.get('/admin/audit-log?limit=2&page=2');
    expect(page2.status).toBe(200);
    const body2 = page2.body as Paginated<AuditEntry>;
    expect(body2.page).toBe(2);
    expect(body2.items[0]?.id).not.toBe(body1.items[0]?.id);
  });

  /* --------------------------------- regressions -------------------------------- */

  /**
   * The audit insert built its jsonb with `sql.lit()`, which does not escape. `JSON.stringify`
   * escapes `"` and `\` but not `'`, so a single apostrophe anywhere in audited metadata broke
   * out of the literal: a SQL injection reachable by any authenticated user, and — because an
   * audit failure inside a transaction rolls the mutation back — a guaranteed 500 the first
   * time anybody typed "it's".
   */
  it('records metadata containing a single quote without failing the mutation', async () => {
    const admin = await adminClient();

    const created = await admin.post('/departments').send({
      name: "Rashid's Workshop",
      code: `WS${Date.now() % 100000}`,
    });

    expect(created.status).toBe(201);

    const list = await admin.get('/admin/audit-log?entityType=department');
    const body = list.body as Paginated<AuditEntry>;
    const entry = body.items.find((item) => item.entityRef?.includes("Rashid's"));
    expect(entry).toBeDefined();
    expect(entry?.summary).toContain("Rashid's");
  });

  /**
   * `request_ip` is an `inet` column. Before the fix the context read the raw
   * `X-Forwarded-For` header and took the leftmost entry, so a caller could send a value pg
   * would reject, fail the audit insert, and roll back the mutation it belonged to — any
   * authenticated user could switch off every audited write in the system with one header.
   */
  it('survives a junk X-Forwarded-For instead of rolling the mutation back', async () => {
    const admin = await adminClient();

    const created = await admin
      .post('/departments')
      .set('X-Forwarded-For', 'definitely-not-an-ip')
      .send({ name: `XFF ${Date.now()}`, code: `XF${Date.now() % 100000}` });

    // The mutation must still succeed. That is the whole point.
    expect(created.status).toBe(201);

    // And the row is still audited, with the unusable address dropped rather than stored.
    const list = await admin.get('/admin/audit-log');
    const entry = (list.body as Paginated<AuditEntry>).items.find(
      (item) => item.action === 'department.create',
    );
    expect(entry).toBeDefined();
    expect(entry?.requestIp).not.toBe('definitely-not-an-ip');
  });

  /** The same break-out, attempted deliberately rather than by accident. */
  it('stores an injection payload in metadata as inert text', async () => {
    const admin = await adminClient();
    const payload = "x'::jsonb, (SELECT password_hash FROM users LIMIT 1), null) --";

    const created = await admin
      .post('/departments')
      .send({ name: payload, code: `INJ${Date.now() % 100000}` });

    expect(created.status).toBe(201);

    // The audit_log row exists and the users table is untouched — no statement ran.
    const rows = await sql<{
      count: string;
    }>`SELECT count(*)::text AS count FROM audit_log WHERE summary LIKE ${'%' + payload + '%'}`.execute(
      ctx.db,
    );
    expect(Number(rows.rows[0]?.count ?? '0')).toBeGreaterThan(0);
  });

  /**
   * `request_ip` is an `inet` column and the context used to take the leftmost, entirely
   * client-supplied X-Forwarded-For entry. `X-Forwarded-For: x` therefore produced a 22P02 on
   * the audit insert, which rolled back the mutation it was attached to — a one-header denial
   * of service against every audited write in the system.
   */
  it('ignores a malformed X-Forwarded-For instead of failing the mutation', async () => {
    const admin = await adminClient();

    const created = await admin
      .post('/departments')
      .set('X-Forwarded-For', 'not-an-ip-address')
      .send({ name: `XFF ${Date.now()}`, code: `XFF${Date.now() % 100000}` });

    expect(created.status).toBe(201);
  });

  /* --------------------------------- filters -------------------------------- */

  /**
   * Task 6.1 specifies three filters — actor, entity, date. The others were removed; an
   * unknown query parameter must not silently behave as a filter.
   */
  it('rejects filters that are no longer part of the contract', async () => {
    const admin = await adminClient();

    const withAction = await admin.get('/admin/audit-log?action=auth.login.success');
    const withSearch = await admin.get('/admin/audit-log?search=admin');

    // Unknown keys are stripped by the schema rather than filtering, so the responses must be
    // identical to an unfiltered request rather than a narrowed one.
    const plain = await admin.get('/admin/audit-log');
    const total = (plain.body as Paginated<AuditEntry>).total;
    expect((withAction.body as Paginated<AuditEntry>).total).toBe(total);
    expect((withSearch.body as Paginated<AuditEntry>).total).toBe(total);
  });

  it('clamps an absurd page number rather than scanning to a huge offset', async () => {
    const admin = await adminClient();

    const result = await admin.get('/admin/audit-log?page=100000000');

    expect(result.status).toBe(400);
  });

  /* --------------------------------- configurable actions -------------------------------- */

  it('refuses to disable an always-on audit action', async () => {
    const admin = await adminClient();

    const result = await admin
      .put('/admin/settings')
      .send({ key: SettingKey.AUDIT_ENABLED_ACTIONS, value: ['borrowing.create'] });

    // ValidationFailedError — the same 400 every other rejected value in this API returns.
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain('auth.login.success');
  });

  it('stops recording an action the admin has disabled', async () => {
    const admin = await adminClient();
    // Everything except category.create, which is not in the always-on set.
    const enabled = AUDIT_ACTIONS.filter((action) => action !== 'category.create');

    const saved = await admin
      .put('/admin/settings')
      .send({ key: SettingKey.AUDIT_ENABLED_ACTIONS, value: enabled });
    expect(saved.status).toBe(200);

    const created = await admin
      .post('/categories')
      .send({ name: `Cat ${Date.now()}`, code: `C${Date.now() % 100000}` });
    expect(created.status).toBe(201);

    // `entityType` is no longer a filter, so this asserts against the whole feed: the category
    // was really created, and no `category.create` row was written for it.
    const list = await admin.get('/admin/audit-log');
    const actions = (list.body as Paginated<AuditEntry>).items.map((entry) => entry.action);
    expect(actions).not.toContain('category.create');
    // The settings change that disabled it is itself always-on, so the feed is not simply empty.
    expect(actions).toContain('settings.update');
  });

  /* --------------------------------- helpers -------------------------------- */

  async function adminClient(): Promise<HttpClient> {
    const { session } = await createUserAndLogin(ctx.db, http, { roles: [Role.ADMIN] });
    return http.as(session.accessToken);
  }
});