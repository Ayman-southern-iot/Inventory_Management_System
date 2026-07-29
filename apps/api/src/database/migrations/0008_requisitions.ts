import { sql, type Kysely } from 'kysely';

/**
 * The procurement workflow: requisitions, their lines, the approval chain, and the event log
 * the live tracker is driven from.
 *
 * Three columns exist purely to make in-flight requests immune to later configuration changes:
 * `requested_amount`, `required_approver_count` and `threshold_at_submit` are all frozen when
 * the request is submitted. An admin raising the expense threshold next week must not silently
 * add an approver to something already halfway through its chain (requirements §11), and a
 * requisition must still be explainable a year later when the settings have moved on.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE requisition_status AS ENUM (
      'DRAFT', 'IM_REVIEW', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED',
      'BOM_GENERATED', 'SENT_TO_ACCOUNTS', 'FUNDS_PARTIAL', 'FUNDS_RECEIVED',
      'PURCHASED', 'STOCKED', 'CLOSED', 'CANCELLED'
    )
  `.execute(db);

  await sql`CREATE TYPE requisition_urgency AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')`.execute(
    db,
  );
  await sql`CREATE TYPE approval_stage AS ENUM ('INVENTORY_MANAGER', 'APPROVER')`.execute(db);
  await sql`
    CREATE TYPE approval_action AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')
  `.execute(db);

  // ------------------------------------------------------------ requisitions
  await db.schema
    .createTable('requisitions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('requisition_no', 'text', (col) => col.notNull().unique())
    .addColumn('requester_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    .addColumn('department_id', 'uuid', (col) =>
      col.references('departments.id').onDelete('restrict'),
    )
    .addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('restrict'))
    .addColumn('urgency', sql`requisition_urgency`, (col) => col.notNull().defaultTo('NORMAL'))
    .addColumn('approval_deadline', 'date')
    .addColumn('reason', 'text')
    /**
     * Money is NUMERIC, never a float. Currency is BDT throughout, so no currency column —
     * adding one later is additive if that ever changes.
     */
    .addColumn('requested_amount', 'numeric(14, 2)')
    .addColumn('approved_amount', 'numeric(14, 2)')
    /** Frozen at submit from the then-current settings. Never recomputed. */
    .addColumn('required_approver_count', 'integer')
    .addColumn('threshold_at_submit', 'numeric(14, 2)')
    .addColumn('status', sql`requisition_status`, (col) => col.notNull().defaultTo('DRAFT'))
    .addColumn('submitted_at', 'timestamptz')
    .addColumn('decided_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'requisitions_amounts_non_negative',
      sql`(requested_amount IS NULL OR requested_amount >= 0)
          AND (approved_amount IS NULL OR approved_amount >= 0)`,
    )
    // A submitted requisition must carry the frozen figures; a draft must not yet.
    .addCheckConstraint(
      'requisitions_submitted_is_frozen',
      sql`status = 'DRAFT'
          OR (submitted_at IS NOT NULL
              AND requested_amount IS NOT NULL
              AND required_approver_count IS NOT NULL
              AND threshold_at_submit IS NOT NULL)`,
    )
    .addCheckConstraint(
      'requisitions_approver_count_range',
      sql`required_approver_count IS NULL OR required_approver_count BETWEEN 1 AND 2`,
    )
    .execute();

  await sql`CREATE SEQUENCE requisition_no_seq START 1`.execute(db);
  await sql`CREATE INDEX requisitions_requester_idx
    ON requisitions (requester_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX requisitions_status_idx ON requisitions (status)`.execute(db);
  // The IM's and approvers' lists order by most recent activity, not creation (task 3.8).
  await sql`CREATE INDEX requisitions_activity_idx ON requisitions (updated_at DESC)`.execute(db);
  await sql`
    CREATE INDEX requisitions_deadline_idx ON requisitions (approval_deadline)
    WHERE status IN ('IM_REVIEW', 'AWAITING_APPROVAL')
  `.execute(db);

  // ------------------------------------------------------- requisition items
  await db.schema
    .createTable('requisition_items')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('requisition_id', 'uuid', (col) =>
      col.notNull().references('requisitions.id').onDelete('cascade'),
    )
    /** Null for something not in the catalogue yet — the free-text escape hatch (task 3.2). */
    .addColumn('product_id', 'uuid', (col) => col.references('products.id').onDelete('restrict'))
    .addColumn('item_name', 'text', (col) => col.notNull())
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('estimated_unit_price', 'numeric(14, 2)', (col) => col.notNull())
    /**
     * Generated, not written: a line total that disagrees with its own inputs is the classic
     * way a total silently drifts. The database computes it or it does not exist.
     */
    .addColumn('estimated_line_total', 'numeric(14, 2)', (col) =>
      col.generatedAlwaysAs(sql`quantity * estimated_unit_price`).stored(),
    )
    /** What the register said at submit. Advisory context for the IM, frozen for the record. */
    .addColumn('in_stock_qty_at_submit', 'integer')
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('requisition_items_qty_positive', sql`quantity > 0`)
    .addCheckConstraint('requisition_items_price_non_negative', sql`estimated_unit_price >= 0`)
    .addCheckConstraint('requisition_items_name_not_blank', sql`length(btrim(item_name)) > 0`)
    .execute();

  await sql`
    CREATE INDEX requisition_items_requisition_idx ON requisition_items (requisition_id)
  `.execute(db);

  // --------------------------------------------------- requisition approvals
  await db.schema
    .createTable('requisition_approvals')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('requisition_id', 'uuid', (col) =>
      col.notNull().references('requisitions.id').onDelete('cascade'),
    )
    .addColumn('stage', sql`approval_stage`, (col) => col.notNull())
    /** 1 or 2 for approvers; always 1 for the single IM stage. */
    .addColumn('slot', 'integer', (col) => col.notNull())
    .addColumn('assigned_user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    /** The delegate, when someone acted on the assignee's behalf (task 3.5). */
    .addColumn('acted_by_user_id', 'uuid', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('action', sql`approval_action`, (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('note', 'text')
    .addColumn('acted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('requisition_approvals_slot_range', sql`slot BETWEEN 1 AND 2`)
    // An action other than PENDING must say who did it and when.
    .addCheckConstraint(
      'requisition_approvals_acted_is_attributed',
      sql`action = 'PENDING' OR (acted_by_user_id IS NOT NULL AND acted_at IS NOT NULL)`,
    )
    .execute();

  // §7.2 — an approver appears at most once per requisition stage.
  await sql`
    ALTER TABLE requisition_approvals
    ADD CONSTRAINT requisition_approvals_unique_slot UNIQUE (requisition_id, stage, slot)
  `.execute(db);
  // Powers the pending badge (§7.4).
  await sql`
    CREATE INDEX requisition_approvals_assignee_idx
    ON requisition_approvals (assigned_user_id, action)
  `.execute(db);

  // ------------------------------------------------------ requisition events
  /**
   * The live tracker reads this, not the status column (task 3.6). A status is a single
   * current value; the tracker has to show a requisition that was approved, withdrawn and
   * re-approved, which only an event log can express.
   *
   * Append-only by trigger, for the same reason as `stock_ledger`: the application connects as
   * the database owner, so a REVOKE alone would not bind it.
   */
  await db.schema
    .createTable('requisition_events')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('requisition_id', 'uuid', (col) =>
      col.notNull().references('requisitions.id').onDelete('cascade'),
    )
    .addColumn('event_type', 'text', (col) => col.notNull())
    // RESTRICT, not SET NULL: an append-only table cannot accept a SET NULL, because that is
    // an UPDATE and the trigger below refuses it. It is also the right rule — 'who did this'
    // must keep resolving forever, so a user who acted on a requisition is deactivated, never
    // deleted. Same reasoning as stock_ledger.performed_by.
    .addColumn('actor_id', 'uuid', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('payload', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE INDEX requisition_events_requisition_idx
    ON requisition_events (requisition_id, created_at)
  `.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION requisition_events_is_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        'requisition_events is append-only: % is not permitted. Append a correcting event instead.',
        TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE TRIGGER requisition_events_no_update
    BEFORE UPDATE OR DELETE OR TRUNCATE ON requisition_events
    FOR EACH STATEMENT EXECUTE FUNCTION requisition_events_is_append_only()
  `.execute(db);

  // ------------------------------------------------------------- delegations
  await db.schema
    .createTable('delegations')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('approver_user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('delegate_user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('starts_at', 'timestamptz', (col) => col.notNull())
    .addColumn('ends_at', 'timestamptz', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Delegating to yourself is a no-op that would only confuse the audit trail.
    .addCheckConstraint('delegations_not_self', sql`approver_user_id <> delegate_user_id`)
    .addCheckConstraint('delegations_range_ordered', sql`ends_at > starts_at`)
    .execute();

  await sql`
    CREATE INDEX delegations_delegate_idx
    ON delegations (delegate_user_id, starts_at, ends_at) WHERE is_active
  `.execute(db);

  for (const table of ['requisitions', 'delegations']) {
    await sql`
      CREATE TRIGGER ${sql.raw(table)}_set_updated_at
      BEFORE UPDATE ON ${sql.raw(table)}
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('delegations').ifExists().execute();
  await db.schema.dropTable('requisition_events').ifExists().execute();
  await sql`DROP FUNCTION IF EXISTS requisition_events_is_append_only()`.execute(db);
  await db.schema.dropTable('requisition_approvals').ifExists().execute();
  await db.schema.dropTable('requisition_items').ifExists().execute();
  await db.schema.dropTable('requisitions').ifExists().execute();
  await sql`DROP SEQUENCE IF EXISTS requisition_no_seq`.execute(db);
  await sql`DROP TYPE IF EXISTS approval_action`.execute(db);
  await sql`DROP TYPE IF EXISTS approval_stage`.execute(db);
  await sql`DROP TYPE IF EXISTS requisition_urgency`.execute(db);
  await sql`DROP TYPE IF EXISTS requisition_status`.execute(db);
}
