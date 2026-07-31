import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { SystemHealthService } from '../src/modules/maintenance/system-health.service';
import { MonitoringJob } from '../src/modules/maintenance/monitoring.job';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { CONFIG, type AppConfig } from '../src/config';
import request from 'supertest';

/** A path that cannot exist on any platform this runs on, so the storage probe must fail. */
const NOWHERE = '/definitely/not/a/real/path/ims-monitoring-probe';

/**
 * Phase 06 task 6.4 — the monitoring floor.
 *
 * The point of these checks is the failures nothing else notices: a full disk, a storage volume
 * that has gone read-only, a backup job that quietly stopped. So the tests care about two things —
 * that a healthy system reports healthy (no crying wolf), and that admins are told **once** when
 * something breaks rather than every hour.
 */
describe('system monitoring', () => {
  let ctx: TestApp;
  let health: SystemHealthService;
  let job: MonitoringJob;
  let admin: { id: string; client: HttpClient };

  beforeAll(async () => {
    ctx = await createTestApp();
    health = ctx.app.get(SystemHealthService);
    job = ctx.app.get(MonitoringJob);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    admin = await signIn([Role.GENERAL, Role.ADMIN]);
  });

  it('reports every check on a healthy system', async () => {
    const result = await health.check();

    const names = result.checks.map((check) => check.name).sort();
    expect(names).toEqual(['backups', 'database', 'disk', 'storage']);
    expect(result.ok).toBe(true);

    // Each check explains itself — a bare boolean is useless at 3am.
    for (const check of result.checks) {
      expect(check.detail.length).toBeGreaterThan(0);
    }
  });

  it('actually writes to the storage directory rather than checking permissions', async () => {
    const storage = result(await health.check(), 'storage');
    expect(storage.ok).toBe(true);
    expect(storage.detail).toBe('writable');
  });

  /**
   * The backup check must stay green where no backups are expected. A dev machine that has never
   * taken one is not broken, and an alert that fires on every developer's laptop is an alert
   * everyone learns to ignore before it ever matters in production.
   */
  it('stays quiet about backups when no backup directory is configured', async () => {
    const backups = result(await health.check(), 'backups');
    expect(backups.ok).toBe(true);
    expect(backups.detail).toContain('not configured');
  });

  it('notifies admins once per failure, not once per sweep', async () => {
    // The container's config object is deeply frozen, so the failure is induced by building a
    // health service around a doctored copy rather than by mutating the real one. Same code
    // under test; only the storage path differs.
    const broken = new SystemHealthService(ctx.db, {
      ...ctx.app.get<AppConfig>(CONFIG),
      uploads: { ...ctx.app.get<AppConfig>(CONFIG).uploads, storageDir: NOWHERE },
    } as AppConfig);
    const brokenJob = new MonitoringJob(broken, ctx.app.get(NotificationsService));

    const first = await brokenJob.sweep();
    expect(first.map((check) => check.name)).toContain('storage');
    const afterFirst = await unreadFor(admin.client);
    expect(afterFirst).toBeGreaterThan(0);

    // Still broken on the next sweep — and deliberately silent, because repeating an alert every
    // hour is how a badge stops meaning anything and the next real one goes unread with it.
    await brokenJob.sweep();
    expect(await unreadFor(admin.client)).toBe(afterFirst);
  });

  it('stays silent while everything is healthy', async () => {
    expect(await job.sweep()).toEqual([]);
    expect(await unreadFor(admin.client)).toBe(0);
  });

  /* ---------------------------------------------------------- the endpoint */

  it('exposes the detail to admins only', async () => {
    const asAdmin = await admin.client.get('/admin/system-health');
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.checks).toHaveLength(4);

    const general = await signIn([Role.GENERAL]);
    expect((await general.client.get('/admin/system-health')).status).toBe(403);

    const im = await signIn([Role.GENERAL, Role.INVENTORY_MANAGER]);
    expect((await im.client.get('/admin/system-health')).status).toBe(403);
  });

  it('keeps the public health endpoint to one bit', async () => {
    // `/health` is excluded from the global prefix, so it is NOT under /api/v1 — the compose
    // healthcheck hits it bare. The shared client always prefixes, hence supertest directly.
    const response = await request(ctx.app.getHttpServer()).get('/health');

    // Unauthenticated by design — the compose healthcheck has no credentials.
    expect(response.status).toBe(200);
    // And it must not leak disk headroom or backup timing to whoever can reach the port.
    expect(Object.keys(response.body).sort()).toEqual(['database', 'status']);
  });

  /* ----------------------------------------------------------- helpers */

  function result(health: { checks: Array<{ name: string; ok: boolean; detail: string }> }, name: string) {
    const found = health.checks.find((check) => check.name === name);
    expect(found, `no check named ${name}`).toBeDefined();
    return found!;
  }

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const user = await createUser(ctx.db, { roles });
    const client = httpClient(ctx.app);
    const session = await login(client, user.email);
    return { id: user.id, client: client.as(session.accessToken) };
  }

  async function unreadFor(client: HttpClient): Promise<number> {
    const response = await client.get('/notifications/unread-count');
    expect(response.status).toBe(200);
    return response.body.unread as number;
  }
});
