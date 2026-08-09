import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { ErrorCode, Role, SettingKey } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';

interface Actor {
  id: string;
  client: HttpClient;
}

const actorFor = async (ctx: TestApp, roles: Role[]): Promise<Actor> => {
  const user = await createUser(ctx.db, { roles });
  const http = httpClient(ctx.app);
  const session = await login(http, user.email);
  return { id: user.id, client: http.as(session.accessToken) };
};

/**
 * Transportation cost on a requisition.
 *
 * The contract is small: a requester can add a single rolled-up cost (amount + description)
 * to a DRAFT, the cost is editable in DRAFT only, and the value rolls up into
 * `requested_amount` at submit. The DB enforces both-or-neither structurally; the
 * service layer trusts the schema and just sets the columns.
 */
describe('requisition transportation cost', () => {
  let ctx: TestApp;
  let requester: Actor;
  let im: Actor;

  // Threshold higher than any requisition amount in this suite so the submit path takes the
  // subthreshold branch (designated approver under SUBTHRESHOLD_APPROVER_USER_ID) instead of
  // having to fill every approver slot.
  const ensureSubthresholdSettings = async () => {
    await ctx.db
      .insertInto('app_settings')
      .values([
        // `app_settings.value` is `jsonb` — every write must be valid JSON, even primitives.
        { key: SettingKey.EXPENSE_THRESHOLD_BDT, value: JSON.stringify(1_000_000) },
        { key: SettingKey.SUBTHRESHOLD_APPROVER_USER_ID, value: JSON.stringify(im.id) },
      ])
      .onConflict((oc) =>
        oc.column('key').doUpdateSet((eb) => ({
          value: eb.ref('excluded.value'),
          updated_by: null,
          updated_at: new Date(),
        })),
      )
      .execute();
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    requester = await actorFor(ctx, [Role.GENERAL]);
    im = await actorFor(ctx, [Role.GENERAL, Role.INVENTORY_MANAGER]);
    await ensureSubthresholdSettings();
  });

  const draftBody = (overrides: Record<string, unknown> = {}) => ({
    urgency: 'NORMAL',
    reason: 'Going to market',
    items: [
      { itemName: 'Cable', quantity: 4, estimatedUnitPrice: 250, productId: null, note: null },
    ],
    ...overrides,
  });

  /* -------------------------------------------------- happy path -- create */

  it('persists both fields on create', async () => {
    const created = await requester.client
      .post('/requisitions')
      .send(
        draftBody({
          transportationCost: 1200,
          transportationDescription: 'Pickup truck to Gazipur',
        }),
      );
    expect(created.status).toBe(201);

    const row = await ctx.db
      .selectFrom('requisitions')
      .select(['transportation_cost', 'transportation_description'])
      .where('id', '=', created.body.id)
      .executeTakeFirstOrThrow();
    expect(Number(row.transportation_cost)).toBe(1200);
    expect(row.transportation_description).toBe('Pickup truck to Gazipur');
  });

  it('persists both fields on update', async () => {
    const created = await requester.client
      .post('/requisitions')
      .send(draftBody({ transportationCost: 800, transportationDescription: 'CNG' }));
    const id = created.body.id;

    const updated = await requester.client
      .put(`/requisitions/${id}`)
      .send(
        draftBody({
          transportationCost: 1500,
          transportationDescription: 'Pickup truck to Gazipur',
        }),
      );
    expect(updated.status).toBe(200);

    const row = await ctx.db
      .selectFrom('requisitions')
      .select(['transportation_cost', 'transportation_description'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(Number(row.transportation_cost)).toBe(1500);
    expect(row.transportation_description).toBe('Pickup truck to Gazipur');
  });

  /* -------------------------------------------------- happy path -- clear */

  it('clears both fields when the body sends null for both', async () => {
    const created = await requester.client
      .post('/requisitions')
      .send(draftBody({ transportationCost: 1200, transportationDescription: 'Bus' }));
    const id = created.body.id;

    const updated = await requester.client
      .put(`/requisitions/${id}`)
      .send(draftBody({ transportationCost: null, transportationDescription: null }));
    expect(updated.status).toBe(200);

    const row = await ctx.db
      .selectFrom('requisitions')
      .select(['transportation_cost', 'transportation_description'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.transportation_cost).toBeNull();
    expect(row.transportation_description).toBeNull();
  });

  /* ----------------------------------------------- Zod validation gates */

  it('rejects a non-zero cost without a description', async () => {
    const created = await requester.client
      .post('/requisitions')
      .send(draftBody({ transportationCost: 1200, transportationDescription: null }));
    expect(created.status).toBe(400);
    expect(created.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(JSON.stringify(created.body)).toMatch(/transportationDescription/i);
  });

  it('rejects a non-zero cost with an empty description', async () => {
    const created = await requester.client
      .post('/requisitions')
      .send(draftBody({ transportationCost: 1200, transportationDescription: '   ' }));
    expect(created.status).toBe(400);
  });

  it('accepts a description when the cost is zero (treated as "not set")', async () => {
    // Zero is the client's "not set" signal and the Zod refinement lets it through.
    const created = await requester.client
      .post('/requisitions')
      .send(draftBody({ transportationCost: 0, transportationDescription: null }));
    expect(created.status).toBe(201);
    const row = await ctx.db
      .selectFrom('requisitions')
      .select(['transportation_cost', 'transportation_description'])
      .where('id', '=', created.body.id)
      .executeTakeFirstOrThrow();
    expect(row.transportation_cost).toBeNull();
    expect(row.transportation_description).toBeNull();
  });

  it('rejects a negative cost', async () => {
    const created = await requester.client
      .post('/requisitions')
      .send(draftBody({ transportationCost: -1, transportationDescription: 'x' }));
    expect(created.status).toBe(400);
  });

  it('rejects a description longer than 500 chars', async () => {
    const created = await requester.client
      .post('/requisitions')
      .send(draftBody({ transportationCost: 1, transportationDescription: 'x'.repeat(501) }));
    expect(created.status).toBe(400);
  });

  /* ----------------------------------------- submit freeze + integration */

  it('rolls transportation into the requested amount at submit', async () => {
    const created = await requester.client
      .post('/requisitions')
      .send(
        draftBody({
          // items total = 4 * 250 = 1000; transportation = 200 → requested = 1200
          transportationCost: 200,
          transportationDescription: 'CNG to the wholesale market',
        }),
      );
    const id = created.body.id;

    const submitted = await requester.client.post(`/requisitions/${id}/submit`).send();
    expect(submitted.status).toBe(200);

    const row = await ctx.db
      .selectFrom('requisitions')
      .select(['requested_amount', 'approved_amount', 'status'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('IM_REVIEW');
    expect(Number(row.requested_amount)).toBe(1200);
    expect(Number(row.approved_amount)).toBe(1200);
  });

  it('rejects editing transportation after the requisition is submitted', async () => {
    const created = await requester.client
      .post('/requisitions')
      .send(draftBody({ transportationCost: 200, transportationDescription: 'CNG' }));
    const id = created.body.id;

    await requester.client.post(`/requisitions/${id}/submit`).send();

    // The PUT after submit hits the existing DRAFT-only gate and returns 409.
    const updated = await requester.client
      .put(`/requisitions/${id}`)
      .send(draftBody({ transportationCost: 999, transportationDescription: 'New plan' }));
    expect(updated.status).toBe(409);
    expect(updated.body.code).toBe(ErrorCode.REQUISITION_INVALID_TRANSITION);
  });

  /* ----------------------------------------------- detail endpoint shape */

  it('returns the fields on the detail endpoint', async () => {
    const created = await requester.client
      .post('/requisitions')
      .send(draftBody({ transportationCost: 700, transportationDescription: 'Bus' }));
    const id = created.body.id;

    const detail = await requester.client.get(`/requisitions/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.transportationCost).toBe(700);
    expect(detail.body.transportationDescription).toBe('Bus');
  });

  it('returns null fields when no transportation was set', async () => {
    const created = await requester.client.post('/requisitions').send(draftBody());
    const detail = await requester.client.get(`/requisitions/${created.body.id}`);
    expect(detail.body.transportationCost).toBeNull();
    expect(detail.body.transportationDescription).toBeNull();
  });

  /* ------------------------------------------- DB-level structural guard */

  it('the DB rejects a cost without a description when Zod is bypassed', async () => {
    // Bypass the schema on purpose to confirm the structural CHECK catch — the service should
    // never let this through, but if it did, the DB still refuses.
    const created = await requester.client.post('/requisitions').send(draftBody());
    const id = created.body.id;

    await expect(
      ctx.db
        .updateTable('requisitions')
        .set({ transportation_cost: '50', transportation_description: null })
        .where('id', '=', id)
        .execute(),
    ).rejects.toThrow();
  });

  it('the DB rejects a description longer than 500 chars when Zod is bypassed', async () => {
    const created = await requester.client.post('/requisitions').send(draftBody());
    const id = created.body.id;

    await expect(
      ctx.db
        .updateTable('requisitions')
        .set({ transportation_cost: '50', transportation_description: 'x'.repeat(501) })
        .where('id', '=', id)
        .execute(),
    ).rejects.toThrow();
  });

  // A direct DB poke that we exercise to confirm the negative-cost CHECK works. Same
  // principle as the previous two: the service never sends a negative number, but the DB
  // is the last line of defence.
  it('the DB rejects a negative cost at the constraint level', async () => {
    const created = await requester.client.post('/requisitions').send(draftBody());
    const id = created.body.id;

    await expect(
      sql`
        UPDATE requisitions
        SET transportation_cost = -1, transportation_description = 'desc'
        WHERE id = ${id}::uuid
      `.execute(ctx.db),
    ).rejects.toThrow();
  });

  /* -------------------------------------------------- regression guard */

  it('a requisition without transportation still freezes to the items total', async () => {
    // The freeze path existed before transportation — a regression here would mean
    // transportation has accidentally made items_total optional.
    const created = await requester.client.post('/requisitions').send(draftBody());
    const id = created.body.id;

    await requester.client.post(`/requisitions/${id}/submit`).send();

    const row = await ctx.db
      .selectFrom('requisitions')
      .select('requested_amount')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(Number(row.requested_amount)).toBe(1000);
  });
});
