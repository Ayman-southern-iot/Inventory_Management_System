import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';

/**
 * D-013. QA established two things and inferred a third: the SPA routes refuse a role that
 * should not reach them, and an unauthenticated API call gets 401. What was never established is
 * the one that matters — whether the **API** refuses an *authenticated* user who simply lacks
 * the role. UI-level blocking is a convenience; it is not a control, because the browser is not
 * where the decision is made.
 *
 * `permissions.int-spec.ts` covers the admin routes exhaustively. It covers nothing else, so
 * every Inventory-Manager-only and Approver-only route was unproven. This file is that half.
 *
 * Table-driven for the same reason as its sibling: adding a guarded route without adding it here
 * should read as an omission rather than disappear.
 *
 * The assertion is 403 and not "not 200" on purpose. A 404 would also keep the caller out, but
 * only by accident of routing, and a later refactor could turn it into a 200 without any test
 * noticing. 403 is the server saying it decided.
 */

interface ApiResponse {
  status: number;
  body: { code?: string; [key: string]: unknown };
}

interface GuardedRoute {
  name: string;
  /** Roles that must be refused. GENERAL is always among them. */
  refuse: Role[];
  call: (client: HttpClient) => PromiseLike<ApiResponse>;
}

const IM_ONLY: Role[] = [Role.GENERAL, Role.APPROVER];
const APPROVER_ONLY: Role[] = [Role.GENERAL, Role.INVENTORY_MANAGER];

const UUID = '00000000-0000-4000-8000-000000000000';

/**
 * Most of these are refused by the `@Roles` guard, which Nest runs before the validation pipe —
 * so an empty body never reaches the handler and the payload does not matter. Sending nonsense
 * is deliberate there: if the guard ever stops running, the test fails on the status rather than
 * quietly mutating something.
 *
 * Two are not. `POST /boms` and `POST /boms/:id/void` carry no `@Roles` decorator and are
 * enforced inside `BomsService` (`assertCanGenerate` / `assertCanVoid`) instead. Both still
 * refuse correctly, but the decision happens *after* validation, so those two need a
 * schema-valid body or the pipe answers 400 first and the test proves nothing. Found by exactly
 * that false pass while writing this file.
 */
const GUARDED_ROUTES: GuardedRoute[] = [
  // --- Catalogue and locations: the Inventory Manager owns the register -------------------
  { name: 'POST /products', refuse: IM_ONLY, call: (c) => c.post('/products').send({}) },
  { name: 'PATCH /products/:id', refuse: IM_ONLY, call: (c) => c.patch(`/products/${UUID}`).send({}) },
  { name: 'POST /categories', refuse: IM_ONLY, call: (c) => c.post('/categories').send({}) },
  { name: 'PATCH /categories/:id', refuse: IM_ONLY, call: (c) => c.patch(`/categories/${UUID}`).send({}) },
  { name: 'POST /locations/zones', refuse: IM_ONLY, call: (c) => c.post('/locations/zones').send({}) },
  { name: 'PATCH /locations/zones/:id', refuse: IM_ONLY, call: (c) => c.patch(`/locations/zones/${UUID}`).send({}) },
  { name: 'POST /locations/compartments', refuse: IM_ONLY, call: (c) => c.post('/locations/compartments').send({}) },

  // --- Stock: only StockService writes, and only the IM may ask it to --------------------
  { name: 'POST /stock/receive', refuse: IM_ONLY, call: (c) => c.post('/stock/receive').send({}) },
  { name: 'POST /stock/move', refuse: IM_ONLY, call: (c) => c.post('/stock/move').send({}) },
  { name: 'POST /stock/adjust', refuse: IM_ONLY, call: (c) => c.post('/stock/adjust').send({}) },
  { name: 'POST /stock/quarantine/resolve', refuse: IM_ONLY, call: (c) => c.post('/stock/quarantine/resolve').send({}) },

  // --- Borrowing decisions: approving and receiving back is the IM's --------------------
  { name: 'POST /borrowing/:id/decision', refuse: IM_ONLY, call: (c) => c.post(`/borrowing/${UUID}/decision`).send({}) },
  { name: 'POST /borrowing/:id/returns', refuse: IM_ONLY, call: (c) => c.post(`/borrowing/${UUID}/returns`).send({}) },

  // --- BOM: generated, rendered and voided by the IM ------------------------------------
  /**
   * Schema-valid on purpose. POST /boms carries no @Roles decorator -- BomsService.assertCanGenerate
   * makes the decision instead -- so an empty body is refused by the zod pipe with a 400 before
   * authorisation is ever reached, and the test would pass while proving nothing. The UUIDs point
   * at nothing; the role check runs before any lookup.
   */
  {
    name: 'POST /boms',
    refuse: IM_ONLY,
    call: (c) =>
      c.post('/boms').send({
        requisitionIds: [UUID],
        lines: [{ requisitionItemId: UUID, unitCost: 100, vendor: null }],
      }),
  },
  { name: 'POST /boms/:id/void', refuse: IM_ONLY, call: (c) => c.post(`/boms/${UUID}/void`).send({ reason: 'permission probe' }) },
  { name: 'GET /boms', refuse: IM_ONLY, call: (c) => c.get('/boms') },

  // --- Money: logged by the IM, never by the requester ----------------------------------
  { name: 'POST /requisitions/:id/send-to-accounts', refuse: IM_ONLY, call: (c) => c.post(`/requisitions/${UUID}/send-to-accounts`).send({}) },
  { name: 'POST /requisitions/:id/fund-receipts', refuse: IM_ONLY, call: (c) => c.post(`/requisitions/${UUID}/fund-receipts`).send({}) },
  { name: 'POST /requisitions/:id/purchases', refuse: IM_ONLY, call: (c) => c.post(`/requisitions/${UUID}/purchases`).send({}) },

  // --- Send back for revision is the IM's branch of the approval flow --------------------
  { name: 'POST /requisitions/:id/send-back-for-revision', refuse: IM_ONLY, call: (c) => c.post(`/requisitions/${UUID}/send-back-for-revision`).send({}) },

  // --- Delegation belongs to the approver whose authority it is --------------------------
  { name: 'GET /requisitions/delegations/mine', refuse: APPROVER_ONLY, call: (c) => c.get('/requisitions/delegations/mine') },
  { name: 'POST /requisitions/delegations', refuse: APPROVER_ONLY, call: (c) => c.post('/requisitions/delegations').send({}) },

  // --- The expense report shows what everyone is spending --------------------------------
  { name: 'GET /reports/expenses', refuse: [Role.GENERAL], call: (c) => c.get('/reports/expenses') },
  { name: 'GET /reports/expenses/export.csv', refuse: [Role.GENERAL], call: (c) => c.get('/reports/expenses/export.csv') },
];

describe('an authenticated user without the role is refused by the API, not just the SPA', () => {
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

  async function clientForRole(role: Role): Promise<HttpClient> {
    const http = httpClient(ctx.app);
    const user = await createUser(ctx.db, { roles: [role] });
    const session = await login(http, user.email);
    return http.as(session.accessToken);
  }

  for (const route of GUARDED_ROUTES) {
    for (const role of route.refuse) {
      it(`refuses ${role} on ${route.name}`, async () => {
        const client = await clientForRole(role);
        const response = await route.call(client);

        expect({ route: route.name, role, status: response.status }).toEqual({
          route: route.name,
          role,
          status: 403,
        });
        expect(response.body.code).toBe(ErrorCode.FORBIDDEN);
      });
    }
  }

  /**
   * The other half of the claim QA could not close: a token is required at all. Asserted here
   * against the same table so the two can never drift apart.
   */
  for (const route of GUARDED_ROUTES) {
    it(`refuses an anonymous caller on ${route.name} with 401, not 403`, async () => {
      const response = await route.call(httpClient(ctx.app));

      // 401 and not 403: "who are you" is a different answer from "not you", and collapsing them
      // tells a signed-out user to go and ask for a permission they may already have.
      expect({ route: route.name, status: response.status }).toEqual({
        route: route.name,
        status: 401,
      });
    });
  }
});
