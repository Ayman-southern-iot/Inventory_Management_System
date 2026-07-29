import { sql, type Kysely } from 'kysely';

/**
 * Bills of Materials.
 *
 * The column that carries the weight here is `bom_requisitions.approval_snapshot`. A BOM
 * printed in July must still show July's names and job titles, so the approvers are frozen
 * into JSON at generation and the PDF is never rendered by joining live to `users`
 * (docs/reference/09-bom.md). Somebody changing their designation, or leaving, must not
 * silently rewrite a document Accounts already has on file.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('boms')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('bom_no', 'text', (col) => col.notNull().unique())
    .addColumn('generated_by', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    /** Sum of the line totals, stored because the PDF must not disagree with the record. */
    .addColumn('subtotal', 'numeric(14, 2)', (col) => col.notNull().defaultTo(0))
    /** Relative path under the files volume. Served by a signed URL, never listed. */
    .addColumn('pdf_path', 'text')
    .addColumn('pdf_generated_at', 'timestamptz')
    .addColumn('is_void', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('void_reason', 'text')
    .addColumn('voided_by', 'uuid', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('voided_at', 'timestamptz')
    /** Set when generation found the total over tolerance and bounced it back (OQ-05). */
    .addColumn('over_budget_bounced', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('generated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('boms_subtotal_non_negative', sql`subtotal >= 0`)
    // Voiding requires a reason and an actor — an unexplained void is indistinguishable from
    // a mistake being covered up (task 4.5).
    .addCheckConstraint(
      'boms_void_is_explained',
      sql`NOT is_void
          OR (void_reason IS NOT NULL AND length(btrim(void_reason)) > 0
              AND voided_by IS NOT NULL AND voided_at IS NOT NULL)`,
    )
    .execute();

  await sql`CREATE SEQUENCE bom_no_seq START 1`.execute(db);
  await sql`CREATE INDEX boms_generated_at_idx ON boms (generated_at DESC)`.execute(db);
  await sql`CREATE INDEX boms_live_idx ON boms (is_void) WHERE NOT is_void`.execute(db);

  // ------------------------------------------------------- bom ↔ requisition
  await db.schema
    .createTable('bom_requisitions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('bom_id', 'uuid', (col) => col.notNull().references('boms.id').onDelete('cascade'))
    .addColumn('requisition_id', 'uuid', (col) =>
      col.notNull().references('requisitions.id').onDelete('restrict'),
    )
    /**
     * The immutable footprints block: name, designation and timestamp per approver, as they
     * were at generation. See docs/reference/09-bom.md for the shape.
     */
    .addColumn('approval_snapshot', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    ALTER TABLE bom_requisitions
    ADD CONSTRAINT bom_requisitions_unique_pair UNIQUE (bom_id, requisition_id)
  `.execute(db);

  /**
   * §7.2 — a requisition may sit on at most one *live* BOM.
   *
   * Partial on the join row rather than referencing `boms.is_void` in the predicate, because a
   * partial index cannot see another table. `is_void` is therefore denormalised onto the join
   * and kept in step by the trigger below; the index is what actually enforces the rule, so
   * voiding genuinely frees the requisition for a new BOM (task 4.5).
   */
  await db.schema
    .alterTable('bom_requisitions')
    .addColumn('is_void', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();

  await sql`
    CREATE UNIQUE INDEX bom_requisitions_one_live_bom
    ON bom_requisitions (requisition_id) WHERE NOT is_void
  `.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION bom_requisitions_sync_void() RETURNS trigger AS $$
    BEGIN
      UPDATE bom_requisitions SET is_void = NEW.is_void WHERE bom_id = NEW.id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE TRIGGER boms_propagate_void
    AFTER UPDATE OF is_void ON boms
    FOR EACH ROW WHEN (OLD.is_void IS DISTINCT FROM NEW.is_void)
    EXECUTE FUNCTION bom_requisitions_sync_void()
  `.execute(db);

  await sql`
    CREATE INDEX bom_requisitions_requisition_idx ON bom_requisitions (requisition_id)
  `.execute(db);

  // ---------------------------------------------------------------- bom lines
  await db.schema
    .createTable('bom_lines')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('bom_id', 'uuid', (col) => col.notNull().references('boms.id').onDelete('cascade'))
    /** The requisition line this came from, so a batched BOM stays traceable line by line. */
    .addColumn('requisition_item_id', 'uuid', (col) =>
      col.notNull().references('requisition_items.id').onDelete('restrict'),
    )
    .addColumn('product_id', 'uuid', (col) => col.references('products.id').onDelete('restrict'))
    .addColumn('item_name', 'text', (col) => col.notNull())
    .addColumn('quantity', 'integer', (col) => col.notNull())
    /** The IM fills these two in at generation; everything else is inherited. */
    .addColumn('unit_cost', 'numeric(14, 2)', (col) => col.notNull())
    .addColumn('total_cost', 'numeric(14, 2)', (col) =>
      // Generated, like the requisition line total: a stored total that disagrees with its
      // own inputs is how a BOM silently stops adding up.
      col.generatedAlwaysAs(sql`quantity * unit_cost`).stored(),
    )
    .addColumn('vendor', 'text')
    /** Inherited from the source requisition so a batched BOM stays legible per line. */
    .addColumn('purpose', 'text')
    .addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('restrict'))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('bom_lines_qty_positive', sql`quantity > 0`)
    .addCheckConstraint('bom_lines_unit_cost_non_negative', sql`unit_cost >= 0`)
    .execute();

  await sql`CREATE INDEX bom_lines_bom_idx ON bom_lines (bom_id, sort_order)`.execute(db);
  // A requisition line may appear on a later BOM after the first is voided, but never on two
  // live ones at once — the join-level index above already guarantees that.
  await sql`
    CREATE INDEX bom_lines_requisition_item_idx ON bom_lines (requisition_item_id)
  `.execute(db);

  await sql`
    CREATE TRIGGER boms_set_updated_at
    BEFORE UPDATE ON boms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('bom_lines').ifExists().execute();
  await sql`DROP TRIGGER IF EXISTS boms_propagate_void ON boms`.execute(db);
  await sql`DROP FUNCTION IF EXISTS bom_requisitions_sync_void()`.execute(db);
  await db.schema.dropTable('bom_requisitions').ifExists().execute();
  await db.schema.dropTable('boms').ifExists().execute();
  await sql`DROP SEQUENCE IF EXISTS bom_no_seq`.execute(db);
}
