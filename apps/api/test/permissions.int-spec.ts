import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role, SettingKey } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { TEST_PASSWORD } from './config/test-env';
import {
  createDepartment,
  createUser,
  login,
  resetData,
  uniqueDepartmentName,
  uniqueEmail,
} from './factories';

/**
 * Permission boundaries are priority 4 in rules/50-testing.md and the acceptance criterion for
 * plan 0.7: "a non-admin gets 403 on every admin route". Table-driven so that adding an admin
 * route without adding it here is visibly an omission rather than an invisible gap.
 */

interface ApiResponse {
  status: number;
  body: { code?: string; [key: string]: unknown };
}

interface Fixtures {
  targetUserId: string;
  departmentId: string;
  approverId: string;
}

interface AdminRoute {
  name: string;
  call: (client: HttpClient, fixtures: Fixtures) => PromiseLike<ApiResponse>;
}

const ADMIN_ROUTES: AdminRoute[] = [
  {
    name: 'GET /admin/users',
    call: (client) => client.get('/admin/users'),
  },
  {
    name: 'POST /admin/users',
    call: (client) =>
      client.post('/admin/users').send({
        email: uniqueEmail('created-by-permission-test'),
        fullName: 'Permission Probe',
        designation: 'Probe',
        roles: [Role.GENERAL],
        password: TEST_PASSWORD,
      }),
  },
  {
    name: 'PATCH /admin/users/:id',
    call: (client, f) => client.patch(`/admin/users/${f.targetUserId}`).send({ designation: 'Patched' }),
  },
  {
    name: 'PATCH /admin/users/:id/active',
    call: (client, f) => client.patch(`/admin/users/${f.targetUserId}/active`).send({ isActive: false }),
  },
  {
    name: 'POST /admin/users/:id/password',
    call: (client, f) =>
      client.post(`/admin/users/${f.targetUserId}/password`).send({ newPassword: TEST_PASSWORD }),
  },
  {
    name: 'GET /admin/settings',
    call: (client) => client.get('/admin/settings'),
  },
  {
    name: 'PUT /admin/settings',
    call: (client) =>
      client.put('/admin/settings').send({ key: SettingKey.EXPENSE_THRESHOLD_BDT, value: 12_345 }),
  },
  {
    name: 'GET /admin/settings/approver-slots',
    call: (client) => client.get('/admin/settings/approver-slots'),
  },
  {
    name: 'PUT /admin/settings/approver-slots',
    call: (client, f) =>
      client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 1, userId: f.approverId }),
  },
  {
    name: 'POST /departments',
    call: (client) => client.post('/departments').send({ name: uniqueDepartmentName('Probe') }),
  },
  {
    name: 'PATCH /departments/:id',
    call: (client, f) =>
      client.patch(`/departments/${f.departmentId}`).send({ name: uniqueDepartmentName('Renamed') }),
  },
];

/** Every role that must NOT reach an admin route. GENERAL is implicit in all of them. */
const NON_ADMIN_ROLES: Role[] = [Role.GENERAL, Role.INVENTORY_MANAGER, Role.APPROVER];

describe('permission boundaries', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
  });

  async function buildFixtures(): Promise<Fixtures> {
    const [target, approver, department] = await Promise.all([
      createUser(ctx.db, { roles: [Role.GENERAL] }),
      createUser(ctx.db, { roles: [Role.APPROVER] }),
      createDepartment(ctx.db),
    ]);
    return { targetUserId: target.id, departmentId: department.id, approverId: approver.id };
  }

  async function clientForRole(role: Role): Promise<HttpClient> {
    const http = httpClient(ctx.app);
    const user = await createUser(ctx.db, { roles: [role] });
    const session = await login(http, user.email);
    return http.as(session.accessToken);
  }

  for (const role of NON_ADMIN_ROLES) {
    describe(`as ${role}`, () => {
      for (const route of ADMIN_ROUTES) {
        it(`is refused ${route.name} with 403 FORBIDDEN`, async () => {
          const fixtures = await buildFixtures();
          const client = await clientForRole(role);

          const response = await route.call(client, fixtures);

          expect({ route: route.name, status: response.status, code: response.body.code }).toEqual({
            route: route.name,
            status: 403,
            code: ErrorCode.FORBIDDEN,
          });
        });
      }
    });
  }

  describe('as ADMIN', () => {
    for (const route of ADMIN_ROUTES) {
      it(`reaches ${route.name}`, async () => {
        const fixtures = await buildFixtures();
        const client = await clientForRole(Role.ADMIN);

        const response = await route.call(client, fixtures);

        expect({ route: route.name, forbidden: response.status === 403 }).toEqual({
          route: route.name,
          forbidden: false,
        });
        expect(response.status).toBeLessThan(400);
      });
    }
  });

  describe('unauthenticated', () => {
    for (const route of ADMIN_ROUTES) {
      it(`is refused ${route.name} with 401, not 403`, async () => {
        const fixtures = await buildFixtures();

        const response = await route.call(httpClient(ctx.app), fixtures);

        expect(response.status).toBe(401);
        expect(response.body.code).toBe(ErrorCode.UNAUTHENTICATED);
      });
    }
  });

  describe('GET /departments', () => {
    for (const role of [...NON_ADMIN_ROLES, Role.ADMIN]) {
      it(`is readable by ${role} — the requisition form needs the list`, async () => {
        const department = await createDepartment(ctx.db);
        const client = await clientForRole(role);

        const response = await client.get('/departments');

        // The subject here is the permission boundary: this role may read the list at all.
        //
        // It used to assert that *this* department appeared in the response, which quietly
        // depended on it landing on page one. `resetData` cannot delete departments that
        // requisitions reference, so the test database accumulates them across specs and the
        // assertion started failing once enough specs ran first — a flake that had nothing to do
        // with permissions. Ownership of the list's contents belongs to the departments spec.
        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.items)).toBe(true);
        expect(response.body.total).toBeGreaterThan(0);
        expect(department.id).toBeTruthy();
      });
    }

    it('is not readable without a token', async () => {
      const response = await httpClient(ctx.app).get('/departments');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.UNAUTHENTICATED);
    });
  });
});
