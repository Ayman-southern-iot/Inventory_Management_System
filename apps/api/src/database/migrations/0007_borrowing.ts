import { sql, type Kysely } from 'kysely';

/**
 * The borrow loop: projects, requests, returns, and the idempotency store.
 *
 * A borrow request holds a `placement_id` rather than just a compartment: the reservation is
 * against one specific placement row, and that is what `StockService` locks on issue. Storing
 * only the compartment would mean re-resolving the placement later against stock that may have
 * moved in between.
 *
 * OPEN QUESTION: OQ-04 — what the IM's ✎ Edit does after physical issue is undecided. The
 * working assumption is implemented: an approved request may be reverted to PENDING only while
 * `issued_at IS NULL`, which the CHECK below makes structural rather than a service-level hope.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE borrow_status AS ENUM (
      'PENDING', 'REJECTED', 'ISSUED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED'
    )
  `.execute(db);

  // ----------------------------------------------------------------- projects
  // OPEN QUESTION: OQ-09 — name only for now. A code, owner or budget would be additive
  // columns, so choosing the minimum here costs nothing later.
  await db.schema
    .createTable('projects')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('projects_name_not_blank', sql`length(btrim(name)) > 0`)
    .execute();

  /**
   * Deliberately NOT unique. OQ-09's answer is a duplicate-name *warning*, not a hard block —
   * two teams may legitimately run a "Falcon". The index exists so the warning lookup is cheap.
   */
  await sql`
    CREATE INDEX projects_name_lower_idx ON projects (lower(btrim(name)))
  `.execute(db);

  // --------------------------------------------------------- borrow requests
  await db.schema
    .createTable('borrow_requests')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    /** Human-facing reference. Generated from a sequence so it is gapless and never guessed. */
    .addColumn('borrow_no', 'text', (col) => col.notNull().unique())
    .addColumn('requester_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    .addColumn('product_id', 'uuid', (col) =>
      col.notNull().references('products.id').onDelete('restrict'),
    )
    /** The exact placement the stock is reserved against. */
    .addColumn('placement_id', 'uuid', (col) =>
      col.references('stock_placements.id').onDelete('set null'),
    )
    .addColumn('compartment_id', 'uuid', (col) =>
      col.notNull().references('storage_compartments.id').onDelete('restrict'),
    )
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('restrict'))
    /** OQ-08: defaults from the product, overridable per borrow. */
    .addColumn('is_returnable', 'boolean', (col) => col.notNull())
    .addColumn('expected_return_date', 'date')
    .addColumn('purpose', 'text')
    .addColumn('status', sql`borrow_status`, (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('decided_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('decision_note', 'text')
    .addColumn('decided_at', 'timestamptz')
    .addColumn('issued_at', 'timestamptz')
    .addColumn('returned_at', 'timestamptz')
    /** Running total, so "what is still out" never needs a sum over borrow_returns. */
    .addColumn('returned_qty', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('borrow_requests_qty_positive', sql`quantity > 0`)
    // Returning more than was borrowed is the classic way a ledger drifts positive.
    .addCheckConstraint(
      'borrow_requests_returned_within_quantity',
      sql`returned_qty >= 0 AND returned_qty <= quantity`,
    )
    // A consumable is issued and never comes back (domain-context.md).
    .addCheckConstraint(
      'borrow_requests_consumable_never_returns',
      sql`is_returnable OR returned_qty = 0`,
    )
    // An expected return date on a consumable is a contradiction the form should never send.
    .addCheckConstraint(
      'borrow_requests_return_date_only_when_returnable',
      sql`is_returnable OR expected_return_date IS NULL`,
    )
    .execute();

  await sql`CREATE SEQUENCE borrow_no_seq START 1`.execute(db);

  await sql`CREATE INDEX borrow_requests_product_created_idx
    ON borrow_requests (product_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX borrow_requests_requester_idx
    ON borrow_requests (requester_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX borrow_requests_status_idx ON borrow_requests (status)`.execute(db);
  // Powers the IM's pending badge and the overdue job without scanning history.
  await sql`
    CREATE INDEX borrow_requests_overdue_idx
    ON borrow_requests (expected_return_date)
    WHERE status IN ('ISSUED', 'PARTIALLY_RETURNED')
  `.execute(db);

  // ---------------------------------------------------------- borrow returns
  await db.schema
    .createTable('borrow_returns')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('borrow_request_id', 'uuid', (col) =>
      col.notNull().references('borrow_requests.id').onDelete('restrict'),
    )
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('compartment_id', 'uuid', (col) =>
      col.notNull().references('storage_compartments.id').onDelete('restrict'),
    )
    .addColumn('received_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('condition_note', 'text')
    .addColumn('returned_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('borrow_returns_qty_positive', sql`quantity > 0`)
    .execute();

  await sql`
    CREATE INDEX borrow_returns_request_idx ON borrow_returns (borrow_request_id, returned_at)
  `.execute(db);

  // ------------------------------------------------------------- idempotency
  /**
   * Closes gap G-04. A double-clicked Approve must issue stock once, and the second attempt
   * must return the first response rather than a confusing error. The unique key is what makes
   * that atomic — two concurrent requests race to INSERT and exactly one wins.
   */
  await db.schema
    .createTable('idempotency_keys')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    /** Scoped by endpoint so the same key on a different action is not silently replayed. */
    .addColumn('scope', 'text', (col) => col.notNull())
    .addColumn('response', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX idempotency_keys_scope_key ON idempotency_keys (user_id, scope, key)
  `.execute(db);
  await sql`
    CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at)
  `.execute(db);

  for (const table of ['projects', 'borrow_requests']) {
    await sql`
      CREATE TRIGGER ${sql.raw(table)}_set_updated_at
      BEFORE UPDATE ON ${sql.raw(table)}
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('idempotency_keys').ifExists().execute();
  await db.schema.dropTable('borrow_returns').ifExists().execute();
  await db.schema.dropTable('borrow_requests').ifExists().execute();
  await sql`DROP SEQUENCE IF EXISTS borrow_no_seq`.execute(db);
  await db.schema.dropTable('projects').ifExists().execute();
  await sql`DROP TYPE IF EXISTS borrow_status`.execute(db);
}
