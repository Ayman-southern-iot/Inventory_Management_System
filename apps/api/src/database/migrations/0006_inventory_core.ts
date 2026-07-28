import { sql, type Kysely } from 'kysely';

/**
 * The stock register: catalogue, locations, placements and the ledger.
 *
 * This is the migration where a mistake is permanent, so the invariants live in the database
 * rather than only in `StockService` (rules/40-database.md: a CHECK constraint beats a comment
 * beats a code review).
 *
 * Ledger sign convention, which the whole reconciliation depends on:
 *   `quantity` is always POSITIVE. Direction comes from the compartment columns —
 *   `to_compartment_id` adds, `from_compartment_id` removes. A MOVE sets both and is therefore
 *   net-zero for the product while still being net-correct per compartment. That makes the
 *   nightly invariant a single query per (product, compartment) rather than a per-movement-type
 *   case analysis that someone will eventually get wrong.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE stock_movement_type AS ENUM (
      'RECEIPT', 'MOVE', 'ISSUE', 'RETURN', 'ADJUST', 'DISPOSE'
    )
  `.execute(db);

  // ---------------------------------------------------------------- catalogue
  await db.schema
    .createTable('categories')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('parent_id', 'uuid', (col) =>
      // Restrict, not cascade: deleting a parent must never silently delete a subtree of
      // categories that products still point at.
      col.references('categories.id').onDelete('restrict'),
    )
    /**
     * requirements §11: only laptops and R&D hardware are tracked today, furniture is not.
     * Modelled as a flag rather than hard-coded logic so turning furniture on later is a
     * checkbox, not a migration. An untracked category may still hold catalogue entries for
     * reference; they simply carry no placements or ledger rows.
     */
    .addColumn('is_trackable', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('categories_name_not_blank', sql`length(btrim(name)) > 0`)
    .addCheckConstraint('categories_not_own_parent', sql`parent_id IS NULL OR parent_id <> id`)
    .execute();

  // Sibling names must be unique, but the same name may appear under different parents.
  // Two partial indexes because NULL never equals NULL in a UNIQUE constraint.
  await sql`
    CREATE UNIQUE INDEX categories_root_name_key
    ON categories (lower(btrim(name))) WHERE parent_id IS NULL
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX categories_sibling_name_key
    ON categories (parent_id, lower(btrim(name))) WHERE parent_id IS NOT NULL
  `.execute(db);
  await sql`CREATE INDEX categories_parent_id_idx ON categories (parent_id)`.execute(db);

  await db.schema
    .createTable('products')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    /** The Storage ID the IM writes on the shelf label. */
    .addColumn('product_code', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('category_id', 'uuid', (col) =>
      col.notNull().references('categories.id').onDelete('restrict'),
    )
    .addColumn('unit', 'text', (col) => col.notNull().defaultTo('pcs'))
    /** OQ-08: the borrow form's default, overridable per borrow line. */
    .addColumn('default_returnable', 'boolean', (col) => col.notNull().defaultTo(true))
    /** OQ-03: answered "no serial tracking". Dormant, kept so switching it on is additive. */
    .addColumn('is_serialised', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('description', 'text')
    /** Soft delete: history must keep resolving to a real product row. */
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('products_name_not_blank', sql`length(btrim(name)) > 0`)
    .addCheckConstraint('products_code_not_blank', sql`length(btrim(product_code)) > 0`)
    .addCheckConstraint('products_unit_not_blank', sql`length(btrim(unit)) > 0`)
    .execute();

  await sql`
    CREATE UNIQUE INDEX products_code_key ON products (lower(btrim(product_code)))
  `.execute(db);
  await sql`CREATE INDEX products_category_id_idx ON products (category_id)`.execute(db);
  // Trigram index for the combobox search (§7.4). pg_trgm was installed in 0001.
  await sql`CREATE INDEX products_name_trgm_idx ON products USING gin (name gin_trgm_ops)`.execute(
    db,
  );
  await sql`
    CREATE INDEX products_code_trgm_idx ON products USING gin (product_code gin_trgm_ops)
  `.execute(db);

  // ---------------------------------------------------------------- locations
  await db.schema
    .createTable('storage_zones')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('storage_zones_name_not_blank', sql`length(btrim(name)) > 0`)
    .execute();

  await sql`
    CREATE UNIQUE INDEX storage_zones_name_key ON storage_zones (lower(btrim(name)))
  `.execute(db);

  await db.schema
    .createTable('storage_compartments')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('zone_id', 'uuid', (col) =>
      col.notNull().references('storage_zones.id').onDelete('restrict'),
    )
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('storage_compartments_code_not_blank', sql`length(btrim(code)) > 0`)
    .execute();

  // §7.2: one compartment code per zone, enforced by the database and not only by the UI.
  await sql`
    CREATE UNIQUE INDEX storage_compartments_zone_code_key
    ON storage_compartments (zone_id, lower(btrim(code)))
  `.execute(db);

  // --------------------------------------------------------------- placements
  await db.schema
    .createTable('stock_placements')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('product_id', 'uuid', (col) =>
      col.notNull().references('products.id').onDelete('restrict'),
    )
    .addColumn('compartment_id', 'uuid', (col) =>
      col.notNull().references('storage_compartments.id').onDelete('restrict'),
    )
    .addColumn('quantity', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('reserved_qty', 'integer', (col) => col.notNull().defaultTo(0))
    /** Optimistic lock for the IM screen (§7.3.2): a stale version returns 409, not a silent write. */
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // §7.2 — the "error free" part. These are guarantees; the service checks are advisory.
    .addCheckConstraint('stock_placements_qty_non_negative', sql`quantity >= 0`)
    .addCheckConstraint(
      'stock_placements_reserved_within_qty',
      sql`reserved_qty >= 0 AND reserved_qty <= quantity`,
    )
    .execute();

  await sql`
    CREATE UNIQUE INDEX stock_placements_product_compartment_key
    ON stock_placements (product_id, compartment_id)
  `.execute(db);
  await sql`CREATE INDEX stock_placements_product_id_idx ON stock_placements (product_id)`.execute(
    db,
  );
  await sql`
    CREATE INDEX stock_placements_compartment_id_idx ON stock_placements (compartment_id)
  `.execute(db);

  // ------------------------------------------------------------------- ledger
  await db.schema
    .createTable('stock_ledger')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('product_id', 'uuid', (col) =>
      col.notNull().references('products.id').onDelete('restrict'),
    )
    .addColumn('from_compartment_id', 'uuid', (col) =>
      col.references('storage_compartments.id').onDelete('restrict'),
    )
    .addColumn('to_compartment_id', 'uuid', (col) =>
      col.references('storage_compartments.id').onDelete('restrict'),
    )
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('movement_type', sql`stock_movement_type`, (col) => col.notNull())
    /** What caused this movement — 'BORROW', 'PURCHASE', 'ADJUSTMENT'. Free-form by design. */
    .addColumn('ref_type', 'text')
    .addColumn('ref_id', 'uuid')
    .addColumn('performed_by', 'uuid', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Direction is carried by the compartment columns, so magnitude is always positive.
    .addCheckConstraint('stock_ledger_qty_positive', sql`quantity > 0`)
    .addCheckConstraint(
      'stock_ledger_has_direction',
      sql`from_compartment_id IS NOT NULL OR to_compartment_id IS NOT NULL`,
    )
    // A MOVE that starts and ends in the same compartment is a no-op pretending to be history.
    .addCheckConstraint(
      'stock_ledger_move_changes_compartment',
      sql`from_compartment_id IS NULL OR to_compartment_id IS NULL
          OR from_compartment_id <> to_compartment_id`,
    )
    .execute();

  await sql`
    CREATE INDEX stock_ledger_product_created_idx ON stock_ledger (product_id, created_at DESC)
  `.execute(db);
  await sql`CREATE INDEX stock_ledger_ref_idx ON stock_ledger (ref_type, ref_id)`.execute(db);

  /**
   * Append-only, enforced by the database rather than by convention (§7.2).
   *
   * The reference doc specifies revoking UPDATE/DELETE from the application role. That is done
   * below, but a REVOKE alone is not enough here: the application connects as the database
   * OWNER in both the compose stack and local development, and an owner bypasses its own
   * grants. The trigger closes that hole and fails loudly for every role including superuser,
   * so a correction has to be a compensating row — which is the actual rule.
   */
  await sql`
    CREATE OR REPLACE FUNCTION stock_ledger_is_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        'stock_ledger is append-only: % is not permitted. Write a compensating row instead.',
        TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE TRIGGER stock_ledger_no_update
    BEFORE UPDATE OR DELETE OR TRUNCATE ON stock_ledger
    FOR EACH STATEMENT EXECUTE FUNCTION stock_ledger_is_append_only()
  `.execute(db);

  // Defence in depth for the day the application stops being the owner.
  await sql`REVOKE UPDATE, DELETE, TRUNCATE ON stock_ledger FROM PUBLIC`.execute(db);

  for (const table of [
    'categories',
    'products',
    'storage_zones',
    'storage_compartments',
    'stock_placements',
  ]) {
    await sql`
      CREATE TRIGGER ${sql.raw(table)}_set_updated_at
      BEFORE UPDATE ON ${sql.raw(table)}
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // The trigger blocks TRUNCATE but not DROP, so the table goes with its trigger attached.
  await db.schema.dropTable('stock_ledger').ifExists().execute();
  await sql`DROP FUNCTION IF EXISTS stock_ledger_is_append_only()`.execute(db);
  await db.schema.dropTable('stock_placements').ifExists().execute();
  await db.schema.dropTable('storage_compartments').ifExists().execute();
  await db.schema.dropTable('storage_zones').ifExists().execute();
  await db.schema.dropTable('products').ifExists().execute();
  await db.schema.dropTable('categories').ifExists().execute();
  await sql`DROP TYPE IF EXISTS stock_movement_type`.execute(db);
}
