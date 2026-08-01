/**
 * Helpers for the dev scenario seed (`scripts/seed-scenarios.ts`).
 *
 * These thin re-exports exist so the seed file does not have to know about the test suite's
 * internals. `factories.ts` imports `TEST_ENV` and the `TestApp` type from `./app`; pulling
 * those into a long-running script would couple the dev workflow to the test runner. The
 * helpers below expose only the pieces the seed needs.
 */
import {
  createDepartment,
  createUser,
  createUserAndLogin,
  login,
  seedSubthresholdApprover,
} from '../factories';
import type { HttpClient } from '../app';
import type { Db } from '../../src/database/create-db';

export {
  createDepartment,
  createUser,
  createUserAndLogin,
  login,
  seedSubthresholdApprover,
};

/** Re-export so the seed file does not have to import the test-app module directly. */
export type { HttpClient } from '../app';

/**
 * Looks up a catalogue product by code, or creates one ready to be attached to a requisition
 * line. The seed wants idempotent reference data: re-running must not duplicate a product.
 *
 * Not used by the current scenarios (the seed prefers receiving into stock which creates the
 * product inline) but kept here for any future scenario that needs an existing catalogue item.
 */
export async function findOrCreateProduct(
  db: Db,
  options: {
    code: string;
    name: string;
    unit?: string;
    categoryName: string;
    categoryTrackable?: boolean;
    returnable?: boolean;
  },
): Promise<{ id: string; productCode: string; name: string }> {
  const existing = await db
    .selectFrom('products')
    .select(['id', 'product_code', 'name'])
    .where('product_code', '=', options.code)
    .executeTakeFirst();
  if (existing) {
    return { id: existing.id, productCode: existing.product_code, name: existing.name };
  }

  let categoryId: string | undefined = (
    await db
      .selectFrom('categories')
      .select('id')
      .where('name', '=', options.categoryName)
      .executeTakeFirst()
  )?.id;
  if (!categoryId) {
    categoryId = (
      await db
        .insertInto('categories')
        .values({ name: options.categoryName, is_trackable: options.categoryTrackable ?? true })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  const inserted = await db
    .insertInto('products')
    .values({
      product_code: options.code,
      name: options.name,
      category_id: categoryId,
      unit: options.unit ?? 'pcs',
      default_returnable: options.returnable ?? true,
    })
    .returning(['id', 'product_code', 'name'])
    .executeTakeFirstOrThrow();

  return { id: inserted.id, productCode: inserted.product_code, name: inserted.name };
}

/**
 * Looks up a storage compartment by zone name + code, or creates both. Kept for scenarios
 * that need a stable destination; the current scenarios call `ensureCompartment` inline so
 * they always have a guaranteed slot.
 */
export async function findOrCreateCompartment(
  db: Db,
  options: { zoneName: string; code: string },
): Promise<string> {
  const row = await db
    .selectFrom('storage_compartments')
    .innerJoin('storage_zones', 'storage_zones.id', 'storage_compartments.zone_id')
    .select('storage_compartments.id')
    .where('storage_zones.name', '=', options.zoneName)
    .where('storage_compartments.code', '=', options.code)
    .executeTakeFirst();
  if (row) return row.id;

  let zoneId: string | undefined = (
    await db.selectFrom('storage_zones').select('id').where('name', '=', options.zoneName).executeTakeFirst()
  )?.id;
  if (!zoneId) {
    zoneId = (
      await db
        .insertInto('storage_zones')
        .values({ name: options.zoneName })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  const created = await db
    .insertInto('storage_compartments')
    .values({ zone_id: zoneId, code: options.code })
    .returning('id')
    .executeTakeFirstOrThrow();
  return created.id;
}

/** Tiny struct the seed uses to thread HTTP callers around. */
export interface Client {
  id: string;
  email: string;
  client: HttpClient;
}
