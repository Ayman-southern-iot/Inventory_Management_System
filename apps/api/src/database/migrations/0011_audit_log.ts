import { sql, type Kysely } from 'kysely';

/**
 * Phase 06 — globally append-only audit log.
 *
 * Domain-specific histories (stock_ledger, requisition_events, borrow_returns, login_attempts)
 * remain authoritative for their workflows; this table is the unified administrative feed that
 * domain workflows each write one row into, so an admin can answer "who did what, when, from
 * where, with what result" without joining across half a dozen tables.
 *
 * Two rules govern the table:
 *
 *  1. The vocabulary is closed. `action`, `entity_type`, and `outcome` are constrained to the
 *     values declared in `@ims/shared/contracts/audit.ts`. The API cannot store an action the
 *     admin panel has never heard of, and the admin panel cannot filter on an action that was
 *     never possible.
 *
 *  2. The table is append-only, enforced by trigger. The application connects as the database
 *     owner in dev and compose, so a REVOKE alone would not bind it — the same defence-in-depth
 *     used by `stock_ledger` and `requisition_events`. A correction is a new row, not an edit.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE audit_outcome AS ENUM ('success', 'failure', 'denied', 'error')
  `.execute(db);

  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // RESTRICT, not SET NULL: the append-only trigger on audit_log rejects UPDATE, so a
    // SET NULL ON DELETE would fail with a confusing trigger error rather than the clear
    // foreign-key error the rule already encodes ("you cannot delete a user who audited").
    // The actor snapshot columns (actor_name, actor_email) preserve identity once the FK
    // becomes irrelevant.
    .addColumn('actor_id', 'uuid', (col) => col.references('users.id').onDelete('restrict'))
    /**
     * Snapshot, not join. The admin must keep reading yesterday's audit rows after a user is
     * renamed, deactivated, or (eventually) deleted — so the table keeps its own copy of the
     * name and email that were current when the action was recorded.
     */
    .addColumn('actor_name', 'text')
    .addColumn('actor_email', 'text')
    .addColumn('actor_roles', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('entity_type', 'text', (col) => col.notNull())
    .addColumn('entity_id', 'text')
    /** Human reference (REQ-000123, BOM No, product code, user email). Free-form by design. */
    .addColumn('entity_ref', 'text')
    .addColumn('summary', 'text', (col) => col.notNull())
    /**
     * Sanitised non-secret before/after and contextual fields. The application calls the
     * redactor before insertion; this column is jsonb so the admin page can render a structured
     * diff without the server hand-formatting it.
     */
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('request_method', 'text')
    /** Pathname only — the sanitiser strips query strings before writing. */
    .addColumn('request_path', 'text')
    .addColumn('request_ip', sql`inet`)
    /** Truncated to 512 chars in the service as a second line of defence. */
    .addColumn('user_agent', 'text')
    .addColumn('outcome', sql`audit_outcome`, (col) => col.notNull())
    .addColumn('error_code', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'audit_log_summary_not_blank',
      sql`length(btrim(summary)) > 0`,
    )
    .execute();

  // ---- access pattern indexes ----------------------------------------------
  // The list endpoint always orders by newest first; the helper index covers
  // (created_at DESC, id DESC) so keyset-style pagination is also usable later.
  await sql`
    CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC, id DESC)
  `.execute(db);
  await sql`CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX audit_log_action_idx ON audit_log (action, created_at DESC)`.execute(db);
  await sql`
    CREATE INDEX audit_log_entity_idx
    ON audit_log (entity_type, entity_id, created_at DESC)
  `.execute(db);
  await sql`CREATE INDEX audit_log_outcome_idx ON audit_log (outcome, created_at DESC)`.execute(
    db,
  );
  // Partial — `request_ip` is nullable and the admin rarely filters by it, but when they do
  // they want a small scan.
  await sql`
    CREATE INDEX audit_log_ip_idx
    ON audit_log (request_ip, created_at DESC) WHERE request_ip IS NOT NULL
  `.execute(db);

  // ---- full-text index -----------------------------------------------------
  // The free-text search bar lives across actor name, actor email, entity reference, and
  // summary. Coalesce to empty string so NULLs do not silently take an index out of the search
  // (rules/40-database.md: prefer the database over elaborate app code).
  await sql`
    CREATE INDEX audit_log_search_idx
    ON audit_log
    USING gin (
      to_tsvector(
        'simple',
        coalesce(actor_name, '') || ' ' || coalesce(actor_email, '') || ' '
          || coalesce(entity_ref, '') || ' ' || coalesce(summary, '')
      )
    )
  `.execute(db);

  // ---- append-only enforcement ---------------------------------------------
  // The application owns the database, so a REVOKE alone does not bind it. The trigger fails
  // every role including the OWNER, exactly as `stock_ledger` and `requisition_events` do. A
  // correction is a new row, not an edit — which is the actual rule for an audit log.
  await sql`
    CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        'audit_log is append-only: % is not permitted. Append a correcting entry instead.',
        TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only()
  `.execute(db);

  // Defence in depth for the day the application stops being the owner.
  await sql`REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log`.execute(db);
  await sql`DROP FUNCTION IF EXISTS audit_log_is_append_only()`.execute(db);
  await db.schema.dropTable('audit_log').ifExists().execute();
  await sql`DROP TYPE IF EXISTS audit_outcome`.execute(db);
}
