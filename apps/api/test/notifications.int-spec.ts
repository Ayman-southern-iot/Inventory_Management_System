import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type Notification, type Paginated, type UnreadCount } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createStockFixture, type StockFixture } from './stock-factories';
import { createUser, login, resetData } from './factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * Phase 06 — in-app notifications.
 *
 * The rule this file defends is "the right person is told, and nobody else is". Most bugs in a
 * notification system are not crashes; they are a notification that went to the wrong queue, or
 * one that quietly went nowhere, and neither shows up in a smoke test.
 */
describe('notifications', () => {
  let ctx: TestApp;
  let stock: StockService;
  let fixture: StockFixture;
  let im: { id: string; client: HttpClient };
  let requester: { id: string; client: HttpClient };
  let bystander: { id: string; client: HttpClient };

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    fixture = await createStockFixture(ctx.db);

    im = await signIn([Role.GENERAL, Role.INVENTORY_MANAGER]);
    requester = await signIn([Role.GENERAL]);
    bystander = await signIn([Role.GENERAL]);

    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  /* ------------------------------------------------------------ fan-out */

  it('notifies the inventory manager when a borrow is raised, and nobody else', async () => {
    const created = await raiseBorrow();
    expect(created.status).toBe(201);

    const imList = await listFor(im.client);
    expect(imList.items).toHaveLength(1);
    expect(imList.items[0]?.type).toBe('borrowing.requested');
    expect(imList.items[0]?.severity).toBe('action_required');
    expect(imList.items[0]?.link).toBe(`/borrowing/${created.body.id}`);
    expect(imList.items[0]?.readAt).toBeNull();

    // The person who raised it already knows, and an uninvolved colleague must not be told.
    expect((await listFor(requester.client)).total).toBe(0);
    expect((await listFor(bystander.client)).total).toBe(0);
  });

  it('notifies the requester when the IM decides, with the reason on a rejection', async () => {
    const created = await raiseBorrow();

    const decided = await im.client
      .post(`/borrowing/${created.body.id}/decision`)
      .send({ approve: false, note: "we don't have the spare" });
    expect(decided.status).toBe(200);

    const list = await listFor(requester.client);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.type).toBe('borrowing.rejected');
    // An apostrophe in the note — the same input shape that broke the audit insert.
    expect(list.items[0]?.body).toContain("we don't have the spare");
    expect(list.items[0]?.actorName).not.toBeNull();
  });

  it('never notifies the actor about their own action', async () => {
    // The IM raises their own borrow: they are both the actor and the notified role.
    const created = await im.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 1,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Own use',
    });
    expect(created.status).toBe(201);

    expect((await listFor(im.client)).total).toBe(0);
  });

  /* --------------------------------------------------------- the badge */

  it('counts unread, and marking read decrements it', async () => {
    await raiseBorrow();
    await raiseBorrow();

    expect((await unreadFor(im.client)).unread).toBe(2);

    const list = await listFor(im.client);
    const marked = await im.client
      .post('/notifications/mark-read')
      .send({ ids: [list.items[0]!.id] });
    expect(marked.status).toBe(200);
    expect((marked.body as UnreadCount).unread).toBe(1);

    const all = await im.client.post('/notifications/mark-all-read').send();
    expect(all.status).toBe(200);
    expect((await unreadFor(im.client)).unread).toBe(0);
  });

  it('re-marking an already-read notification does not change its read timestamp', async () => {
    await raiseBorrow();
    const list = await listFor(im.client);
    const id = list.items[0]!.id;

    await im.client.post('/notifications/mark-read').send({ ids: [id] });
    const first = (await listFor(im.client)).items[0]?.readAt;
    expect(first).not.toBeNull();

    await im.client.post('/notifications/mark-read').send({ ids: [id] });
    expect((await listFor(im.client)).items[0]?.readAt).toBe(first);
  });

  it('filters to unread only', async () => {
    await raiseBorrow();
    await raiseBorrow();
    const list = await listFor(im.client);
    await im.client.post('/notifications/mark-read').send({ ids: [list.items[0]!.id] });

    const unread = await im.client.get('/notifications?unreadOnly=true');
    expect((unread.body as Paginated<Notification>).total).toBe(1);
  });

  /* ------------------------------------------------------ authorization */

  it('never returns another user’s notifications', async () => {
    await raiseBorrow();

    // The bystander sees an empty feed even though a notification exists in the table.
    expect((await listFor(bystander.client)).total).toBe(0);
    expect((await unreadFor(bystander.client)).unread).toBe(0);
  });

  it('cannot mark another user’s notification read', async () => {
    await raiseBorrow();
    const imList = await listFor(im.client);
    const victimId = imList.items[0]!.id;

    const attempt = await bystander.client
      .post('/notifications/mark-read')
      .send({ ids: [victimId] });

    // Not a 403: the row is simply not in the caller's scope, so nothing matches and nothing
    // changes. What matters is that the IM's notification is still unread.
    expect(attempt.status).toBe(200);
    expect((await unreadFor(im.client)).unread).toBe(1);
    expect((await listFor(im.client)).items[0]?.readAt).toBeNull();
  });

  it('requires authentication', async () => {
    const anonymous = httpClient(ctx.app);
    expect((await anonymous.get('/notifications')).status).toBe(401);
    expect((await anonymous.get('/notifications/unread-count')).status).toBe(401);
  });

  /* ----------------------------------------------------------- helpers */

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return { id: user.id, client: http.as(session.accessToken) };
  }

  function raiseBorrow() {
    return requester.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 1,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Field testing',
    });
  }

  async function listFor(client: HttpClient): Promise<Paginated<Notification>> {
    const response = await client.get('/notifications');
    expect(response.status).toBe(200);
    return response.body as Paginated<Notification>;
  }

  async function unreadFor(client: HttpClient): Promise<UnreadCount> {
    const response = await client.get('/notifications/unread-count');
    expect(response.status).toBe(200);
    return response.body as UnreadCount;
  }
});
