import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData, seedSubthresholdApprover } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * QA round 2, D-014 — Critical.
 *
 * Every `date` column was handed back by the driver as a JS `Date` at the *server's* local
 * midnight, and every reader then called `.toISOString().slice(0, 10)`, which is UTC. East of
 * Greenwich that is the previous calendar day, so a deadline entered as the 27th was stored
 * and returned as the 26th — and because the edit form repopulates from the stored value, each
 * subsequent save lost another day. Reproduced on production as REQ-000013: 27 → 26 → 25.
 *
 * The suite could not see it. Eighteen specs write `expectedReturnDate: '2026-12-31'` and not
 * one reads a date back, so the round trip was never asserted anywhere. These tests exist to
 * make the round trip itself the thing under test, for both `date` columns in the schema:
 * `requisitions.approval_deadline` and `borrow_requests.expected_return_date`.
 *
 * They only fail in a timezone east of UTC. `Intl` is asserted first so that a run on a UTC
 * box reports "this test cannot see the bug here" rather than passing and implying it is fixed.
 */
describe('date columns survive a round trip', () => {
  let ctx: TestApp;
  let requester: { id: string; client: HttpClient };
  let im: { id: string; client: HttpClient };
  let approver: { id: string; client: HttpClient };
  let fixture: StockFixture;
  let stock: StockService;

  const actorFor = async (roles: Role[]) => {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return { id: user.id, client: http.as(session.accessToken) };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  // The faked clock must never outlive its test — a later spec minting a token against it
  // would fail in a way that looks nothing like the cause.
  afterEach(() => {
    vi.useRealTimers();
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
    fixture = await createStockFixture(ctx.db);

    // A borrow request 404s against a product with no placement, so put stock on the shelf.
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  /**
   * A date far enough out that no test run can drift onto it, and deliberately not the 1st or
   * the 31st: a one-day shift has to stay inside the same month, so a month-boundary bug cannot
   * mask it as a formatting difference.
   */
  const DEADLINE = '2027-03-18';

  it('returns the approval deadline exactly as it was written', async () => {
    // Guard: the defect is invisible at UTC+0 or west of it. Fail loudly rather than silently.
    expect(-new Date().getTimezoneOffset()).toBeGreaterThan(0);

    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: DEADLINE,
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: 500, productId: null, note: null },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.approvalDeadline).toBe(DEADLINE);

    // The write's own response is where the shift first shows, but the stored value has to be
    // checked independently — a correct echo over a wrong row would be the worse bug.
    const fetched = await requester.client.get(`/requisitions/${created.body.id}`);
    expect(fetched.body.approvalDeadline).toBe(DEADLINE);
  });

  it('does not lose a further day on every save', async () => {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: DEADLINE,
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: 500, productId: null, note: null },
      ],
    });

    // The edit form repopulates from the stored value and sends it straight back, so this is
    // what a user pressing Save twice without touching the field actually does.
    for (let save = 0; save < 3; save++) {
      const current = await requester.client.get(`/requisitions/${created.body.id}`);
      await requester.client.put(`/requisitions/${created.body.id}`).send({
        approvalDeadline: current.body.approvalDeadline,
        items: [
          { itemName: 'Widget', quantity: 1, estimatedUnitPrice: 500, productId: null, note: null },
        ],
      });
    }

    const after = await requester.client.get(`/requisitions/${created.body.id}`);
    expect(after.body.approvalDeadline).toBe(DEADLINE);
  });

  /**
   * The tail of D-014: "what day is it" was answered in UTC, so for the first six hours of
   * every Dhaka day the overdue flag was a day behind. The clock is faked into that window —
   * 20:00 UTC on the 23rd is 02:00 on the 24th in Dhaka — so a deadline of the 23rd is
   * yesterday to the business and still today to UTC.
   *
   * The clock is set before signing in, because the token's own iat/exp are minted against
   * whatever `Date` says at the time and would otherwise fail validation at the faked instant.
   */
  it('flags a deadline overdue on the business calendar, not the UTC one', async () => {
    vi.setSystemTime(new Date('2026-08-23T20:00:00.000Z'));

    const inWindow = await actorFor([Role.GENERAL]);
    const created = await inWindow.client.post('/requisitions').send({
      approvalDeadline: '2026-08-23',
      items: [
        { itemName: 'Widget', quantity: 1, estimatedUnitPrice: 500, productId: null, note: null },
      ],
    });
    const submitted = await inWindow.client.post(`/requisitions/${created.body.id}/submit`).send();
    // Without this the requisition stays DRAFT, which is never overdue, and the test would
    // pass or fail for a reason that has nothing to do with the clock.
    expect(submitted.status).toBe(200);

    const fetched = await inWindow.client.get(`/requisitions/${created.body.id}`);
    expect(fetched.body.approvalDeadline).toBe('2026-08-23');
    // UTC says the 23rd is today, so `deadline < today` is false and the flag stays down.
    // Dhaka says it is already the 24th, so the deadline has passed and the approvers are late.
    expect(fetched.body.isOverdue).toBe(true);
  });

  it('returns the borrowing expected-return date exactly as it was written', async () => {
    const raised = await requester.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 1,
      expectedReturnDate: DEADLINE,
      isReturnable: true,
      purpose: 'Round-trip check',
    });
    expect(raised.status).toBe(201);
    expect(raised.body.expectedReturnDate).toBe(DEADLINE);

    const listed = await im.client.get('/borrowing?page=1&limit=25&mine=false');
    const found = listed.body.items.find(
      (b: { id: string; expectedReturnDate: string | null }) => b.id === raised.body.id,
    );
    expect(found?.expectedReturnDate).toBe(DEADLINE);
  });
});
