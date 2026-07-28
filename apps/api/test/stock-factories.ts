import { randomUUID } from 'node:crypto';
import type { Db } from '../src/database/create-db';

/**
 * Inventory fixtures. Every name is unique per call so specs can run in any order without
 * colliding on the unique indexes — no shared mutable fixture that tests take turns corrupting.
 */

export interface StockFixture {
  categoryId: string;
  productId: string;
  zoneId: string;
  compartmentA: string;
  compartmentB: string;
}

export async function createCategory(
  db: Db,
  options: { name?: string; isTrackable?: boolean; parentId?: string | null } = {},
): Promise<string> {
  const row = await db
    .insertInto('categories')
    .values({
      name: options.name ?? `Category ${randomUUID().slice(0, 8)}`,
      is_trackable: options.isTrackable ?? true,
      parent_id: options.parentId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function createProduct(
  db: Db,
  options: { categoryId?: string; name?: string; code?: string; isActive?: boolean } = {},
): Promise<string> {
  const categoryId = options.categoryId ?? (await createCategory(db));
  const row = await db
    .insertInto('products')
    .values({
      product_code: options.code ?? `SKU-${randomUUID().slice(0, 8)}`,
      name: options.name ?? `Product ${randomUUID().slice(0, 8)}`,
      category_id: categoryId,
      is_active: options.isActive ?? true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function createZone(db: Db, name?: string): Promise<string> {
  const row = await db
    .insertInto('storage_zones')
    .values({ name: name ?? `Zone ${randomUUID().slice(0, 8)}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function createCompartment(
  db: Db,
  zoneId: string,
  code?: string,
): Promise<string> {
  const row = await db
    .insertInto('storage_compartments')
    .values({ zone_id: zoneId, code: code ?? randomUUID().slice(0, 6) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** One trackable product and two compartments in one zone — what most stock specs need. */
export async function createStockFixture(db: Db): Promise<StockFixture> {
  const categoryId = await createCategory(db);
  const productId = await createProduct(db, { categoryId });
  const zoneId = await createZone(db);
  const compartmentA = await createCompartment(db, zoneId, 'A1');
  const compartmentB = await createCompartment(db, zoneId, 'B2');
  return { categoryId, productId, zoneId, compartmentA, compartmentB };
}

export async function placementOf(
  db: Db,
  productId: string,
  compartmentId: string,
): Promise<{ quantity: number; reserved_qty: number; version: number } | undefined> {
  return db
    .selectFrom('stock_placements')
    .select(['quantity', 'reserved_qty', 'version'])
    .where('product_id', '=', productId)
    .where('compartment_id', '=', compartmentId)
    .executeTakeFirst();
}

export async function ledgerRows(db: Db, productId: string) {
  return db
    .selectFrom('stock_ledger')
    .selectAll()
    .where('product_id', '=', productId)
    .orderBy('id')
    .execute();
}

/**
 * Deliberately does nothing.
 *
 * The obvious reset — delete every placement between tests — is wrong here. `stock_ledger` is
 * append-only, so its rows survive, and the leftover history then disagrees with the wiped
 * placements. That is a *manufactured* discrepancy: it makes the reconciliation invariant fail
 * for a reason that can never occur in production, where placements are never deleted wholesale.
 *
 * Every fixture creates a fresh product with a unique code instead, so tests cannot interfere.
 * The upside is that `SUM(ledger) = placements.quantity` then holds across the entire suite at
 * once, which is a far stronger assertion than checking one product in isolation.
 */
export async function resetInventory(_db: Db): Promise<void> {
  // Intentionally empty — see above.
}
