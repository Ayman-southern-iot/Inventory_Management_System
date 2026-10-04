import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createDepartment, createUser, createUserAndLogin, resetData } from './factories';
import { createCompartment, createProduct, createCategory, createRoom, createZone } from './stock-factories';

/**
 * Message audit M3. These refusals were all a bare CONFLICT, and the SPA selects its wording by
 * code, so a taken name could only be met with "that change conflicts with the current state".
 * Each now has a code of its own, so the screen can say what clashed. Still 409.
 */
/**
 * Rooms and departments cannot be deleted between tests (every foreign key to them restricts), so
 * every name here is unique to the run, as rules/50-testing.md requires. Lead with it: storage IDs
 * are built from the first letters of a name.
 */
const unique = (label: string): string => `${randomUUID().slice(0, 8)} ${label}`;

describe('specific conflict codes for locations and departments', () => {
  let ctx: TestApp;
  let http: HttpClient;
  let im: HttpClient;
  let admin: HttpClient;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    http = httpClient(ctx.app);
    im = (await createUserAndLogin(ctx.db, http, { roles: [Role.GENERAL, Role.INVENTORY_MANAGER] })).client;
    admin = (await createUserAndLogin(ctx.db, http, { roles: [Role.GENERAL, Role.ADMIN] })).client;
  });

  const expectCode = (response: { status: number; body: unknown }, code: string) => {
    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe(code);
  };

  describe('duplicate names', () => {
    it('a department name that is taken is DUPLICATE_DEPARTMENT_NAME', async () => {
      const name = unique('Workshop');
      await createDepartment(ctx.db, name);
      expectCode(await admin.post('/departments').send({ name }), ErrorCode.DUPLICATE_DEPARTMENT_NAME);
    });

    it('renaming a department to a taken name is DUPLICATE_DEPARTMENT_NAME', async () => {
      const taken = unique('Workshop');
      await createDepartment(ctx.db, taken);
      const other = await createDepartment(ctx.db, unique('Stores'));
      expectCode(
        await admin.patch(`/departments/${other.id}`).send({ name: taken }),
        ErrorCode.DUPLICATE_DEPARTMENT_NAME,
      );
    });

    it('a room name that is taken is DUPLICATE_ROOM_NAME', async () => {
      const name = unique('Main Hall');
      await im.post('/locations/rooms').send({ name }).expect(201);
      expectCode(await im.post('/locations/rooms').send({ name }), ErrorCode.DUPLICATE_ROOM_NAME);
    });

    it('a zone name that is taken in the same room is DUPLICATE_ZONE_NAME, and names the clash', async () => {
      const roomId = await createRoom(ctx.db, unique('Annex'));
      await im.post('/locations/zones').send({ name: 'North', roomId }).expect(201);
      const again = await im.post('/locations/zones').send({ name: 'North', roomId });
      expectCode(again, ErrorCode.DUPLICATE_ZONE_NAME);
      expect((again.body as { message: string }).message).toContain('North');
    });

    it('the same zone name in a different room is still allowed', async () => {
      const first = await createRoom(ctx.db, unique('Annex'));
      const second = await createRoom(ctx.db, unique('Basement'));
      await im.post('/locations/zones').send({ name: 'North', roomId: first }).expect(201);
      await im.post('/locations/zones').send({ name: 'North', roomId: second }).expect(201);
    });

    it('a compartment code that is taken in the zone is DUPLICATE_COMPARTMENT_CODE', async () => {
      const roomId = await createRoom(ctx.db, unique('Annex'));
      const zoneId = await createZone(ctx.db, unique('North'), roomId);
      await im.post('/locations/compartments').send({ zoneId, code: 'S1' }).expect(201);
      expectCode(
        await im.post('/locations/compartments').send({ zoneId, code: 'S1' }),
        ErrorCode.DUPLICATE_COMPARTMENT_CODE,
      );
    });
  });

  describe('deactivation refused because it is still in use', () => {
    it('a department with active people is DEPARTMENT_HAS_ACTIVE_USERS', async () => {
      const department = await createDepartment(ctx.db, unique('Workshop'));
      await createUser(ctx.db, { roles: [Role.GENERAL], departmentId: department.id });
      const response = await admin.patch(`/departments/${department.id}`).send({ isActive: false });
      expectCode(response, ErrorCode.DEPARTMENT_HAS_ACTIVE_USERS);
      expect((response.body as { details: { count: number } }).details.count).toBe(1);
    });

    it('a department with nobody in it can still be deactivated', async () => {
      const department = await createDepartment(ctx.db, unique('Empty'));
      await admin.patch(`/departments/${department.id}`).send({ isActive: false }).expect(200);
    });

    it('a compartment that holds stock is LOCATION_HOLDS_STOCK, and says which kind', async () => {
      const categoryId = await createCategory(ctx.db);
      const productId = await createProduct(ctx.db, { categoryId });
      const roomId = await createRoom(ctx.db, unique('Annex'));
      const zoneId = await createZone(ctx.db, unique('North'), roomId);
      const compartmentId = await createCompartment(ctx.db, zoneId, 'S1');
      await im.post('/stock/receive').send({ productId, compartmentId, quantity: 3 }).expect(200);

      const compartment = await im.patch(`/locations/compartments/${compartmentId}`).send({ isActive: false });
      expectCode(compartment, ErrorCode.LOCATION_HOLDS_STOCK);
      expect((compartment.body as { details: { kind: string } }).details.kind).toBe('compartment');

      const zone = await im.patch(`/locations/zones/${zoneId}`).send({ isActive: false });
      expectCode(zone, ErrorCode.LOCATION_HOLDS_STOCK);
      expect((zone.body as { details: { kind: string } }).details.kind).toBe('zone');

      const room = await im.patch(`/locations/rooms/${roomId}`).send({ isActive: false });
      expectCode(room, ErrorCode.LOCATION_HOLDS_STOCK);
      expect((room.body as { details: { kind: string } }).details.kind).toBe('room');
    });
  });
});
