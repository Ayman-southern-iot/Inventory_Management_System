import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiKeyScope, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUserAndLogin, resetData } from './factories';
import { createCategory, createProduct, createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * `GET /catalogue` — everything a search screen needs, and nothing else.
 *
 * Ayman, 2026-09-21: another system shows this on a big display where people look items up. The
 * first version returned the database's own shape — 120 categories of which 113 were empty, four
 * UUIDs per shelf, `createdAt` everywhere — and he was right that it was unusable.
 *
 * So the tests here are mostly about what is *absent*, and about the two reshapings that make
 * the payload usable without a second lookup: a resolved category path, and a readable location
 * label. Both are the kind of thing that silently regresses to "well, the data is technically
 * all there" unless something holds the line.
 */
describe('catalogue', () => {
  let ctx: TestApp;
  let admin: HttpClient;
  let adminId: string;
  let fixture: StockFixture;

  async function issueKey(): Promise<string> {
    const response = await admin.post('/admin/api-keys').send({
      name: 'External search screen',
      scopes: [ApiKeyScope.INVENTORY_READ],
      expiresInDays: null,
    });
    expect(response.status).toBe(201);
    return response.body.token as string;
  }

  /** The shape this spec asserts against, spelled out so the assertions are typed. */
  interface CatalogueBody {
    products: Array<{
      id: string;
      category: { name: string; path: string[] } | null;
      stock: { total: number; available: number; inUse: number };
      locations: Array<{
        compartmentId: string;
        label: string;
        room: string;
        zone: string;
        compartment: string;
        storageId: string;
        quantity: number;
        available: number;
      }>;
    }>;
  }

  const findProduct = (body: CatalogueBody, id: string) =>
    body.products.find((p) => p.id === id);

  /** Throws rather than returning undefined, so a missing product fails on the line that looked. */
  function productIn(body: CatalogueBody, id: string) {
    const found = findProduct(body, id);
    if (!found) throw new Error(`no product ${id} in the catalogue`);
    return found;
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

  it('returns products, categories and locations in one call', async () => {
    const response = await admin.get('/catalogue');
    expect(response.status).toBe(200);
    expect(response.body.products.length).toBeGreaterThan(0);
    expect(response.body.locations.length).toBeGreaterThan(0);
    expect(response.body.generatedAt).toEqual(expect.any(String));
  });

  it('is reachable with an API key', async () => {
    const token = await issueKey();
    const response = await httpClient(ctx.app, { token }).get('/catalogue');
    expect(response.status).toBe(200);
  });

  describe('the shape a display can render directly', () => {
    beforeEach(async () => {
      const stock = ctx.app.get(StockService);
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        { performedBy: adminId, note: 'catalogue fixture' },
      );
    });

    it('labels each shelf as text, not as three ids to join', async () => {
      const response = await admin.get('/catalogue');
      const product = productIn(response.body, fixture.productId);

      expect(product.locations).toHaveLength(1);
      const at = product.locations[0]!;
      // "Main Store / Meta / 1A" — assembled once here, the same way the IMS renders it.
      expect(at.label).toBe(`${at.room} / ${at.zone} / ${at.compartment}`);
      expect(at.storageId).toEqual(expect.any(String));
      expect(at.quantity).toBe(10);
      expect(at.available).toBe(10);
    });

    it('answers total, available and in use, and nothing narrower', async () => {
      const response = await admin.get('/catalogue');
      const product = productIn(response.body, fixture.productId);

      expect(product.stock).toEqual({ total: 10, available: 10, inUse: 0 });
    });

    /** The category breadcrumb, resolved server-side so nobody walks `parentId` upwards. */
    it('resolves the whole category path, root first', async () => {
      const parent = await createCategory(ctx.db, { name: 'Electronics' });
      const child = await createCategory(ctx.db, { name: 'Computers', parentId: parent });
      const leaf = await createCategory(ctx.db, { name: 'Laptops', parentId: child });
      const productId = await createProduct(ctx.db, { categoryId: leaf });

      const response = await admin.get('/catalogue');
      const product = productIn(response.body, productId);

      expect(product.category?.name).toBe('Laptops');
      expect(product.category?.path).toEqual(['Electronics', 'Computers', 'Laptops']);
    });

    it('says null rather than inventing a category for an uncategorised product', async () => {
      const productId = await createProduct(ctx.db, { categoryId: null });
      const response = await admin.get('/catalogue');
      expect(productIn(response.body, productId).category).toBeNull();
    });
  });

  describe('what it leaves out', () => {
    it('drops the bookkeeping a display has no use for', async () => {
      const response = await admin.get('/catalogue');
      const body = JSON.stringify(response.body);

      // Each of these was in the first version and answered nobody's question on a search screen.
      for (const noise of ['createdAt', 'isTrackable', 'parentId', 'productCountInTree']) {
        expect(body, `expected "${noise}" to be gone`).not.toContain(noise);
      }
    });

    /** It is a product browser in another company's screen, not an HR report. */
    it('names no people anywhere', async () => {
      const response = await admin.get('/catalogue');
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('activeBorrows');
      expect(body).not.toContain('borrowerName');
      expect(body).not.toContain('createdByName');
    });

    /**
     * The single biggest saving. The seeded tree is ~120 nodes and a handful hold anything; the
     * rest are dead ends in a filter list.
     */
    it('hides categories that hold nothing, and their count says so', async () => {
      await createCategory(ctx.db, { name: 'Holds Absolutely Nothing' });

      const lean = await admin.get('/catalogue');
      expect(
        lean.body.categories.some((c: { name: string }) => c.name === 'Holds Absolutely Nothing'),
      ).toBe(false);
      expect(lean.body.counts.categories).toBe(lean.body.categories.length);

      const full = await admin.get('/catalogue?allCategories=true');
      expect(
        full.body.categories.some((c: { name: string }) => c.name === 'Holds Absolutely Nothing'),
      ).toBe(true);
      expect(full.body.categories.length).toBeGreaterThan(lean.body.categories.length);
    });

    /** An ancestor of a stocked category stays, or the paths cannot be rebuilt into a tree. */
    it('keeps a parent whose child holds something', async () => {
      const parent = await createCategory(ctx.db, { name: 'Kept Parent' });
      const child = await createCategory(ctx.db, { name: 'Stocked Child', parentId: parent });
      await createProduct(ctx.db, { categoryId: child });

      const response = await admin.get('/catalogue');
      const names = response.body.categories.map((c: { name: string }) => c.name);
      expect(names).toContain('Kept Parent');
      expect(names).toContain('Stocked Child');
    });
  });

  it('lists every shelf flat, for a location filter', async () => {
    const response = await admin.get('/catalogue');
    const shelf = response.body.locations.find(
      (l: { compartmentId: string }) => l.compartmentId === fixture.compartmentA,
    );
    expect(shelf).toBeDefined();
    expect(shelf.label).toBe(`${shelf.room} / ${shelf.zone} / ${shelf.compartment}`);
    expect(response.body.counts.locations).toBe(response.body.locations.length);
  });

  it('carries a product with no stock rather than dropping it', async () => {
    const response = await admin.get('/catalogue');
    // A catalogue that hides what is out of stock cannot be searched for what to order.
    const product = productIn(response.body, fixture.productId);
    expect(product.locations).toEqual([]);
    expect(product.stock.total).toBe(0);
  });

  it('hides retired products unless asked', async () => {
    await ctx.db
      .updateTable('products')
      .set({ is_active: false })
      .where('id', '=', fixture.productId)
      .execute();

    expect(findProduct((await admin.get('/catalogue')).body, fixture.productId)).toBeUndefined();
    expect(
      findProduct((await admin.get('/catalogue?includeInactive=true')).body, fixture.productId),
    ).toBeDefined();
  });

  it('is refused without any credential at all', async () => {
    const response = await httpClient(ctx.app).get('/catalogue');
    expect(response.status).toBe(401);
  });
});
