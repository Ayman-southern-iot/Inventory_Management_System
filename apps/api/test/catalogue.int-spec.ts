import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiKeyScope, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUserAndLogin, resetData } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * `GET /catalogue` — everything in one response.
 *
 * Ayman, 2026-09-21: another system mirrors this catalogue. It stores nothing, loads on open
 * and lets people search. The properties that matter to that consumer are completeness (it has
 * no second call to fall back on), correctness of the availability number (its UI says what can
 * be taken), and the absence of anything personal — it is a product browser, not an HR report.
 */
describe('catalogue', () => {
  let ctx: TestApp;
  let admin: HttpClient;
  let adminId: string;
  let fixture: StockFixture;

  async function issueKey(): Promise<string> {
    const response = await admin.post('/admin/api-keys').send({
      name: 'External catalogue mirror',
      scopes: [ApiKeyScope.INVENTORY_READ],
      expiresInDays: null,
    });
    expect(response.status).toBe(201);
    return response.body.token as string;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    fixture = await createStockFixture(ctx.db);
    const session = await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.ADMIN] });
    admin = session.client;
    adminId = session.user.id;
  });

  it('returns products, categories and rooms in one call', async () => {
    const response = await admin.get('/catalogue');
    expect(response.status).toBe(200);

    expect(response.body.products.length).toBeGreaterThan(0);
    expect(response.body.categories.length).toBeGreaterThan(0);
    expect(response.body.rooms.length).toBeGreaterThan(0);
    expect(response.body.generatedAt).toEqual(expect.any(String));
  });

  it('is reachable with an API key', async () => {
    const token = await issueKey();
    const response = await httpClient(ctx.app, { token }).get('/catalogue');
    expect(response.status).toBe(200);
    expect(response.body.products.length).toBeGreaterThan(0);
  });

  it('nests rooms down to compartments, so a consumer can render the tree', async () => {
    const response = await admin.get('/catalogue');
    const room = response.body.rooms.find((r: { id: string }) => r.id === fixture.roomId);
    expect(room).toBeDefined();
    const zone = room.zones.find((z: { id: string }) => z.id === fixture.zoneId);
    expect(zone).toBeDefined();
    expect(zone.compartments.length).toBeGreaterThanOrEqual(2);
    // The printed shelf label, which is what somebody reads off a shelf to find a thing.
    expect(zone.compartments[0].storageId).toEqual(expect.any(String));
  });

  describe('stock', () => {
    beforeEach(async () => {
      const stock = ctx.app.get(StockService);
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        { performedBy: adminId, note: 'catalogue fixture' },
      );
    });

    it('says where each product physically is', async () => {
      const response = await admin.get('/catalogue');
      const product = response.body.products.find(
        (p: { id: string }) => p.id === fixture.productId,
      );

      expect(product.placements).toHaveLength(1);
      expect(product.placements[0]).toMatchObject({
        compartmentId: fixture.compartmentA,
        roomId: fixture.roomId,
        zoneId: fixture.zoneId,
        quantity: 10,
        availableQty: 10,
      });
      expect(product.placements[0].storageId).toEqual(expect.any(String));
    });

    it('counts totals across every shelf', async () => {
      const response = await admin.get('/catalogue');
      const product = response.body.products.find(
        (p: { id: string }) => p.id === fixture.productId,
      );
      expect(product.totalQuantity).toBe(10);
      expect(product.totalAvailable).toBe(10);
    });
  });

  it('carries a product with no stock rather than dropping it', async () => {
    const response = await admin.get('/catalogue');
    const product = response.body.products.find((p: { id: string }) => p.id === fixture.productId);
    // A catalogue that hides what is out of stock cannot be searched for what to order.
    expect(product).toBeDefined();
    expect(product.placements).toEqual([]);
    expect(product.totalQuantity).toBe(0);
  });

  /**
   * The consumer is a product browser in another company system. `ProductDetail` carries
   * `activeBorrows`, which names employees; nothing here may.
   */
  it('names no people anywhere in the response', async () => {
    const response = await admin.get('/catalogue');
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('activeBorrows');
    expect(body).not.toContain('borrowerName');
    expect(body).not.toContain('createdByName');
  });

  it('hides retired products unless asked', async () => {
    await ctx.db
      .updateTable('products')
      .set({ is_active: false })
      .where('id', '=', fixture.productId)
      .execute();

    const hidden = await admin.get('/catalogue');
    expect(
      hidden.body.products.find((p: { id: string }) => p.id === fixture.productId),
    ).toBeUndefined();

    const shown = await admin.get('/catalogue?includeInactive=true');
    expect(
      shown.body.products.find((p: { id: string }) => p.id === fixture.productId),
    ).toBeDefined();
  });

  it('reports counts that match what it returned', async () => {
    const response = await admin.get('/catalogue');
    expect(response.body.counts.products).toBe(response.body.products.length);
    expect(response.body.counts.rooms).toBe(response.body.rooms.length);
  });

  it('is refused without any credential at all', async () => {
    const response = await httpClient(ctx.app).get('/catalogue');
    expect(response.status).toBe(401);
  });
});
