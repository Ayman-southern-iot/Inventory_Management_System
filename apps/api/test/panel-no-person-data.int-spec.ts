import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role, type Catalogue } from '@ims/shared';
import { StockService } from '../src/modules/stock/stock.service';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, createUserAndLogin, resetData } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';

/**
 * The lab panel (`/panel`) is a wall screen anyone in the lab can read, signed in as a person-type
 * GENERAL account (OQ-P3). It must never show who holds anything (K2). The panel's
 * one data call is `GET /catalogue` (apps/web/src/features/panel/api.ts, `PANEL_CATALOGUE_PATH`);
 * the K2 walk proves that route for an API key, and this proves it for the session the panel uses,
 * which the key-only redaction interceptor does not touch.
 *
 * The second test is the reason the panel reads the catalogue and not product detail: to a
 * session, `GET /products/:id` names the borrower. It also shows the check below can see a name
 * when one is there. If product detail stops naming borrowers to a session, update that test.
 */

/** Field names that only ever hold a person. Their presence is the leak, whatever the value. */
const PERSON_FIELDS = [
  'borrowerId',
  'requesterId',
  'borrowerName',
  'requesterName',
  'userId',
  'fullName',
  'email',
  'performedBy',
  'createdBy',
] as const;

describe('lab panel: the catalogue answers a GENERAL session without naming a person', () => {
  const tag = randomUUID().slice(0, 8);
  const people: Array<{ id: string; fullName: string; email: string }> = [];
  let ctx: TestApp;
  let panel: HttpClient;
  let fixture: StockFixture;

  /** Every way a person could appear in `payload`, each reported by name. */
  function personsIn(payload: unknown): string[] {
    const body = JSON.stringify(payload);
    const found: string[] = [];
    for (const person of people) {
      if (body.includes(person.fullName)) found.push(person.fullName);
      if (body.includes(person.email)) found.push(person.email);
      if (body.includes(person.id)) found.push(`id ${person.id}`);
    }
    for (const field of PERSON_FIELDS) {
      if (body.includes(`"${field}"`)) found.push(`field ${field}`);
    }
    return found;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetData(ctx.db);

    const imName = `Nusrat Haque ${tag}`;
    const borrowerName = `Tahmid Karim ${tag}`;
    const requesterName = `Farzana Islam ${tag}`;
    const im = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.INVENTORY_MANAGER],
      fullName: imName,
    });
    const borrower = await createUser(ctx.db, { fullName: borrowerName });
    const requester = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      fullName: requesterName,
    });
    people.push(
      { id: im.user.id, fullName: imName, email: im.user.email },
      { id: borrower.id, fullName: borrowerName, email: borrower.email },
      { id: requester.user.id, fullName: requesterName, email: requester.user.email },
    );

    // The panel's own account: a person-type user holding GENERAL only.
    const panelUser = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      fullName: `Lab panel ${tag}`,
    });
    expect(panelUser.user.roles).toEqual([Role.GENERAL]);
    panel = panelUser.client;

    fixture = await createStockFixture(ctx.db);
    await ctx.app
      .get(StockService, { strict: false })
      .receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 20 },
        { performedBy: im.user.id, refType: 'TEST' },
      );
    // A live loan, so the product the panel shows has a borrower within reach to leak.
    const returnBy = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const issued = await im.client.post('/borrowing/issue-from-stock').send({
      borrowerId: borrower.id,
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 2,
      isReturnable: true,
      expectedReturnDate: returnBy,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    // And a pending request from a third person, which reserves stock in their name.
    const requested = await requester.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 1,
      isReturnable: false,
      expectedReturnDate: null,
      purpose: null,
    });
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /catalogue answers the panel with the lent product and its shelf, and no person', async () => {
    const response = await panel.get('/catalogue');
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const catalogue = response.body as Catalogue;
    const lent = catalogue.products.find((product) => product.id === fixture.productId);
    expect(lent, 'the fixture product is in the catalogue').toBeDefined();
    expect(lent!.stock.inUse).toBe(2);
    expect(lent!.locations.map((location) => location.compartmentId)).toContain(
      fixture.compartmentA,
    );

    expect(personsIn(response.body)).toEqual([]);
  });

  it('GET /products/:id would name the borrower to the same session, which is why the panel does not call it', async () => {
    const response = await panel.get(`/products/${fixture.productId}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(personsIn(response.body)).toEqual(
      expect.arrayContaining([people[1]!.fullName, 'field borrowerId', 'field borrowerName']),
    );
  });
});
