import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BorrowStatus, ErrorCode, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { createStockFixture, ledgerRows, placementOf, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';
import { BorrowingRepository } from '../src/modules/borrowing/borrowing.repository';

/**
 * Phase 09 Part E-b — custody reassignment.
 *
 * The thing under test is not really the endpoint; it is that the system stops disagreeing with
 * itself about who has the equipment. So most of these assertions are about the *other* screens:
 * the borrow list, the dashboard, the overdue sweep, and — most of all — the ledger, which must
 * not gain a single row for a correction that moved nothing physical (plan decision D5).
 */
describe('borrowing — holder reassignment', () => {
  let ctx: TestApp;
  let stock: StockService;
  let borrowRepo: BorrowingRepository;
  let fixture: StockFixture;
  let im: { id: string; client: HttpClient };
  let alice: { id: string; client: HttpClient };
  let bob: { id: string; client: HttpClient };

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);
    borrowRepo = ctx.app.get(BorrowingRepository);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    fixture = await createStockFixture(ctx.db);

    const imUser = await createUser(ctx.db, { roles: [Role.GENERAL, Role.INVENTORY_MANAGER] });
    const imHttp = httpClient(ctx.app);
    im = { id: imUser.id, client: imHttp.as((await login(imHttp, imUser.email)).accessToken) };

    const aliceUser = await createUser(ctx.db, { roles: [Role.GENERAL], fullName: 'Alice Asker' });
    const aliceHttp = httpClient(ctx.app);
    alice = {
      id: aliceUser.id,
      client: aliceHttp.as((await login(aliceHttp, aliceUser.email)).accessToken),
    };

    const bobUser = await createUser(ctx.db, { roles: [Role.GENERAL], fullName: 'Bob Holder' });
    const bobHttp = httpClient(ctx.app);
    bob = {
      id: bobUser.id,
      client: bobHttp.as((await login(bobHttp, bobUser.email)).accessToken),
    };

    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  /** Alice asks for 5, the IM approves, so 5 units are physically with Alice. */
  const issuedToAlice = async (): Promise<string> => {
    const created = await alice.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 5,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Field testing',
    });
    expect(created.status).toBe(201);
    const approved = await im.client
      .post(`/borrowing/${created.body.id}/decision`)
      .send({ approve: true, note: 'ok' });
    expect(approved.status).toBe(200);
    return created.body.id as string;
  };

  const reassign = (id: string, body: Record<string, unknown> = {}) =>
    im.client.post(`/borrowing/${id}/holder`).send({
      holderId: bob.id,
      reason: 'Alice handed the kit to Bob before going on leave',
      ...body,
    });

  describe('the record moves and the shelf does not', () => {
    it('moves the holder while leaving the requester exactly as written', async () => {
      const id = await issuedToAlice();

      const moved = await reassign(id);
      expect(moved.status).toBe(200);
      expect(moved.body.currentHolderId).toBe(bob.id);
      expect(moved.body.currentHolderName).toBe('Bob Holder');
      // Who asked is history. Rewriting it would falsify the request itself.
      expect(moved.body.requesterId).toBe(alice.id);
      expect(moved.body.requesterName).toBe('Alice Asker');
      expect(moved.body.status).toBe(BorrowStatus.ISSUED);
    });

    /**
     * The invariant this whole part rests on. A compensating RECEIPT/ISSUE pair would keep
     * `SUM(ledger) = placements.quantity` balanced, so nothing would ever flag it — the ledger
     * would just quietly claim the units came back to a compartment and went out again.
     */
    it('writes no ledger row and touches no placement', async () => {
      const id = await issuedToAlice();

      const before = await ledgerRows(ctx.db, fixture.productId);
      const placementBefore = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);

      expect((await reassign(id)).status).toBe(200);

      const after = await ledgerRows(ctx.db, fixture.productId);
      expect(after).toHaveLength(before.length);

      const placementAfter = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placementAfter).toMatchObject({
        quantity: placementBefore!.quantity,
        reserved_qty: placementBefore!.reserved_qty,
        quarantined_qty: placementBefore!.quarantined_qty,
      });
      expect(await stock.findReconciliationMismatches()).toEqual([]);
    });

    it('appends one custody row naming both parties, the actor and the reason', async () => {
      const id = await issuedToAlice();
      await reassign(id);

      const trail = await ctx.db
        .selectFrom('borrow_holder_changes')
        .selectAll()
        .where('borrow_request_id', '=', id)
        .execute();

      expect(trail).toHaveLength(1);
      expect(trail[0]).toMatchObject({
        from_user_id: alice.id,
        to_user_id: bob.id,
        changed_by: im.id,
        reason: 'Alice handed the kit to Bob before going on leave',
      });
    });

    it('records the audit row as a custody change, not a re-issue', async () => {
      const id = await issuedToAlice();
      await reassign(id);

      const rows = await ctx.db
        .selectFrom('audit_log')
        .selectAll()
        .where('entity_id', '=', id)
        .where('action', '=', 'borrowing.holder_changed')
        .execute();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toMatchObject({ stockMoved: false, toUserId: bob.id });
    });

    it('allows a second hop, and keeps both rows of the trail', async () => {
      const id = await issuedToAlice();
      await reassign(id);
      const back = await im.client
        .post(`/borrowing/${id}/holder`)
        .send({ holderId: alice.id, reason: 'Bob gave it back to Alice' });
      expect(back.status).toBe(200);
      expect(back.body.currentHolderId).toBe(alice.id);

      const trail = await ctx.db
        .selectFrom('borrow_holder_changes')
        .select(['from_user_id', 'to_user_id'])
        .where('borrow_request_id', '=', id)
        .orderBy('changed_at', 'asc')
        .execute();
      expect(trail).toEqual([
        { from_user_id: alice.id, to_user_id: bob.id },
        { from_user_id: bob.id, to_user_id: alice.id },
      ]);
    });
  });

  describe('both parties are told', () => {
    it('tells the new holder it is now against them', async () => {
      const id = await issuedToAlice();
      await reassign(id);

      const inbox = await bob.client.get('/notifications?unreadOnly=true&page=1&limit=50');
      const entry = inbox.body.items.find(
        (n: { type: string }) => n.type === 'borrowing.holder_assigned',
      );
      expect(entry).toBeDefined();
      // Who it came from is in the body: "now against you" alone sends the reader asking.
      expect(entry.body).toContain('Alice Asker');
    });

    /**
     * The half that makes the trail proof rather than paperwork. Without it the previous holder
     * discovers months later that a loan they handed on was still in their name and has nothing
     * to point at.
     */
    it('tells the previous holder it is no longer against them', async () => {
      const id = await issuedToAlice();
      await reassign(id);

      const inbox = await alice.client.get('/notifications?unreadOnly=true&page=1&limit=50');
      const entry = inbox.body.items.find(
        (n: { type: string }) => n.type === 'borrowing.holder_released',
      );
      expect(entry).toBeDefined();
      expect(entry.body).toContain('Bob Holder');
    });
  });

  describe('every "who has it" read follows the holder', () => {
    it('leaves the previous holder\'s list and joins the new one\'s', async () => {
      const id = await issuedToAlice();

      const aliceBefore = await alice.client.get('/borrowing?mine=true&page=1&limit=50');
      expect(aliceBefore.body.items.map((b: { id: string }) => b.id)).toContain(id);

      await reassign(id);

      const aliceAfter = await alice.client.get('/borrowing?mine=true&page=1&limit=50');
      expect(aliceAfter.body.items.map((b: { id: string }) => b.id)).not.toContain(id);

      const bobAfter = await bob.client.get('/borrowing?mine=true&page=1&limit=50');
      expect(bobAfter.body.items.map((b: { id: string }) => b.id)).toContain(id);
    });

    it('moves "still out" on the dashboard from one person to the other', async () => {
      const id = await issuedToAlice();

      const aliceBefore = await alice.client.get('/dashboard/me');
      expect(aliceBefore.body.borrowing.stillOut).toBe(1);

      await reassign(id);

      expect((await alice.client.get('/dashboard/me')).body.borrowing.stillOut).toBe(0);
      expect((await bob.client.get('/dashboard/me')).body.borrowing.stillOut).toBe(1);
    });

    /**
     * The one the plan calls out by name: miss this and the reminder chases somebody who handed
     * the equipment on weeks ago.
     */
    it('points the overdue sweep at the new holder', async () => {
      const id = await issuedToAlice();
      // Backdate it rather than waiting for 2026-12-31.
      await ctx.db
        .updateTable('borrow_requests')
        .set({ expected_return_date: '2020-01-01' })
        .where('id', '=', id)
        .execute();

      const before = await borrowRepo.findOverdue();
      expect(before.find((row) => row.id === id)?.current_holder_id).toBe(alice.id);

      await reassign(id);

      const after = await borrowRepo.findOverdue();
      expect(after.find((row) => row.id === id)?.current_holder_id).toBe(bob.id);
    });

    it('names the holder on the project items list', async () => {
      const project = await im.client.post('/projects').send({ name: 'Custody Project' });
      expect(project.status).toBe(201);
      const projectId = project.body.id as string;

      const created = await alice.client.post('/borrowing').send({
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity: 2,
        projectId,
        isReturnable: true,
        expectedReturnDate: '2026-12-31',
        purpose: 'Project work',
      });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });
      await reassign(created.body.id);

      const items = await im.client.get(`/projects/${projectId}/items?page=1&limit=50`);
      const row = items.body.items.find(
        (i: { borrowRequestId: string }) => i.borrowRequestId === created.body.id,
      );
      // The field is called `borrowerName`; after a reassignment that is Bob, not Alice.
      expect(row.borrowerName).toBe('Bob Holder');
    });

    it('still names the requester on the borrow row itself', async () => {
      const id = await issuedToAlice();
      await reassign(id);

      const row = await im.client.get('/borrowing?page=1&limit=50');
      const found = row.body.items.find((b: { id: string }) => b.id === id);
      expect(found).toMatchObject({
        requesterName: 'Alice Asker',
        currentHolderName: 'Bob Holder',
      });
    });
  });

  describe('what it refuses', () => {
    it('refuses a general user, because this moves who is liable for equipment', async () => {
      const id = await issuedToAlice();
      const denied = await alice.client
        .post(`/borrowing/${id}/holder`)
        .send({ holderId: bob.id, reason: 'I would rather Bob had it' });
      expect(denied.status).toBe(403);
    });

    it('refuses a PENDING borrow, where nothing is in anyone\'s hands yet', async () => {
      const created = await alice.client.post('/borrowing').send({
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity: 1,
        isReturnable: true,
        expectedReturnDate: '2026-12-31',
      });
      const refused = await reassign(created.body.id);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe(ErrorCode.BORROW_INVALID_TRANSITION);
    });

    it('refuses a fully returned borrow, which is closed history', async () => {
      const id = await issuedToAlice();
      await im.client
        .post(`/borrowing/${id}/returns`)
        .send({ quantity: 5, compartmentId: fixture.compartmentA, condition: 'GOOD' });

      const refused = await reassign(id);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe(ErrorCode.BORROW_INVALID_TRANSITION);
    });

    it('allows it on a partially returned borrow, where units are still out', async () => {
      const id = await issuedToAlice();
      await im.client
        .post(`/borrowing/${id}/returns`)
        .send({ quantity: 2, compartmentId: fixture.compartmentA, condition: 'GOOD' });

      const moved = await reassign(id);
      expect(moved.status).toBe(200);
      expect(moved.body.status).toBe(BorrowStatus.PARTIALLY_RETURNED);
      expect(moved.body.currentHolderId).toBe(bob.id);
    });

    it('refuses reassigning to the person who already holds it', async () => {
      const id = await issuedToAlice();
      const refused = await reassign(id, { holderId: alice.id });
      expect(refused.status).toBe(409);

      const trail = await ctx.db
        .selectFrom('borrow_holder_changes')
        .selectAll()
        .where('borrow_request_id', '=', id)
        .execute();
      expect(trail).toHaveLength(0);
    });

    it('refuses a deactivated holder, who could never return it', async () => {
      const id = await issuedToAlice();
      const gone = await createUser(ctx.db, { roles: [Role.GENERAL], isActive: false });
      const refused = await reassign(id, { holderId: gone.id });
      expect(refused.status).toBe(400);
    });

    it('refuses a blank reason — an unexplained transfer of liability is worthless', async () => {
      const id = await issuedToAlice();
      const refused = await reassign(id, { reason: '  ' });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('leaves the holder untouched when it refuses', async () => {
      const id = await issuedToAlice();
      await reassign(id, { reason: '' });

      const row = await ctx.db
        .selectFrom('borrow_requests')
        .select('current_holder_id')
        .where('id', '=', id)
        .executeTakeFirst();
      expect(row!.current_holder_id).toBe(alice.id);
    });
  });
});
