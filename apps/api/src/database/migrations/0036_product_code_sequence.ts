import { sql, type Kysely } from 'kysely';

/**
 * A serial source for auto-generated product codes.
 *
 * The New product form asked the IM to type a "Storage ID" by hand, which was `product_code`
 * wearing a borrowed label. Ayman's ask #1 is that it generates itself; his 2026-09-21 ruling
 * settled that the *Storage ID* proper names a shelf slot (migration 0034), which leaves the
 * product with an ordinary catalogue code — and no reason for a human to invent it.
 *
 * Shape is `NAM-0001`: three letters from the product name, then a zero-padded serial. That is
 * what the existing codes already look like (`LAP-0001`, `GPU-0001`, `CBL-0001`), so nothing
 * that has been printed or quoted changes meaning — the difference is only that nobody types
 * it any more.
 *
 * ---------------------------------------------------------------------------------------------
 * The sequence starts past the highest serial already in use, so a generated code cannot collide
 * with one somebody typed before this landed. `product_code` keeps its UNIQUE index, which
 * remains the actual guarantee; the sequence only makes collisions vanishingly unlikely rather
 * than impossible, because a hand-typed legacy code could in principle be anything at all.
 *
 * No column changes and no backfill: every existing product keeps exactly the code it has.
 * Renaming a product does not regenerate its code, for the same reason renaming a room does not
 * rewrite a shelf label — the code is quoted on requisitions and BOMs that have already been
 * printed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE SEQUENCE product_code_seq START 1`.execute(db);

  /**
   * Walk the existing codes for a trailing number and start above the largest. `NULLIF` guards
   * the case where nothing matches the shape, and `GREATEST(..., 1)` keeps `setval` legal on an
   * empty catalogue.
   */
  await sql`
    SELECT setval(
      'product_code_seq',
      GREATEST(
        coalesce(
          (
            SELECT max((regexp_replace(product_code, '^.*?(\\d+)$', '\\1'))::bigint)
            FROM products
            WHERE product_code ~ '\\d+$'
          ),
          0
        ),
        1
      )
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP SEQUENCE IF EXISTS product_code_seq`.execute(db);
}
