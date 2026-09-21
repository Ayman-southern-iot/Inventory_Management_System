import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/schema';

/**
 * The catalogue code of a product: `NAM-0001`.
 *
 * Three letters from the product name, then a zero-padded serial — the shape the existing codes
 * already have (`LAP-0001`, `GPU-0001`), so this changes who types it, not what it looks like.
 *
 * It is deliberately **not** the Storage ID. That names a shelf slot and is four segments
 * (`LAB-MET-1A-0001`, migration 0034); this names a catalogue entry and is two. A product sits
 * in two rooms at once quite normally, so a location cannot live in a per-product identifier.
 */
const NAME_TOKEN_LENGTH = 3;
const SERIAL_PAD = 4;

/** Letters and digits only, uppercased. `ITM` when a name has none — a code must still exist. */
export function productCodeToken(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned.length > 0 ? cleaned.slice(0, NAME_TOKEN_LENGTH) : 'ITM';
}

export function buildProductCode(name: string, serial: number): string {
  return `${productCodeToken(name)}-${String(serial).padStart(SERIAL_PAD, '0')}`;
}

/**
 * Draw the next serial and build the code.
 *
 * `nextval` rather than `max(...) + 1`: two IMs adding a product at the same moment must not be
 * handed the same code. The UNIQUE index on `product_code` is still the guarantee — this just
 * means it is never reached in practice.
 */
export async function generateProductCode(
  conn: Kysely<Database>,
  name: string,
): Promise<string> {
  const row = await sql<{ n: string }>`SELECT nextval('product_code_seq') AS n`.execute(conn);
  return buildProductCode(name, Number(row.rows[0]?.n ?? 1));
}
