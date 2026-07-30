import { sql, type Kysely } from 'kysely';

/**
 * Phase 06 — audit retention, and the index trim that goes with restricting the feed's filters.
 *
 * Two changes, both consequences of task 6.1 landing as specified:
 *
 *  1. `audit_log` is filterable by actor, entity and date — three filters, per the plan. The
 *     first cut also shipped `action`, `entity_id`, `outcome`, `ip` and a free-text search, each
 *     with an index behind it. Every one of those indexes is maintained on *every* mutation in
 *     the system, because every mutation writes an audit row. The GIN full-text index is the
 *     expensive one: GIN maintenance on insert is far from free, and nothing queries it now.
 *     Dropping the four unused ones leaves the three the surviving filters actually use.
 *
 *  2. The append-only trigger blocked DELETE for every role including the owner, which made a
 *     time-based purge impossible. Rather than weaken it, DELETE is now permitted only inside a
 *     transaction that has explicitly set `ims.audit_purge = 'on'` — a flag nothing but the
 *     retention job sets. UPDATE and TRUNCATE stay forbidden unconditionally: a correction is
 *     still a new row, and there is still no way to quietly rewrite history.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ---- index trim -----------------------------------------------------------
  // `audit_log_created_at_idx` (ordering + date filter), `audit_log_actor_idx` and
  // `audit_log_entity_idx` are kept — they serve the three surviving filters.
  await sql`DROP INDEX IF EXISTS audit_log_outcome_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS audit_log_ip_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS audit_log_search_idx`.execute(db);
  // Kept deliberately: `action` is not a filter any more, but the purge and support queries
  // both select on it, and a btree on a low-cardinality text column is cheap to maintain.

  // ---- purge-aware append-only guard ----------------------------------------
  await sql`
    CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
    BEGIN
      -- The retention job sets this with SET LOCAL, so it is scoped to one transaction and
      -- reverts on commit or rollback. current_setting(..., true) returns NULL when unset
      -- rather than raising, which is what makes the default case "forbidden".
      IF TG_OP = 'DELETE' AND coalesce(current_setting('ims.audit_purge', true), '') = 'on' THEN
        RETURN NULL;
      END IF;

      RAISE EXCEPTION
        'audit_log is append-only: % is not permitted. Append a correcting entry instead.',
        TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
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

  await sql`CREATE INDEX audit_log_outcome_idx ON audit_log (outcome, created_at DESC)`.execute(db);
  await sql`
    CREATE INDEX audit_log_ip_idx
    ON audit_log (request_ip, created_at DESC) WHERE request_ip IS NOT NULL
  `.execute(db);
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
}
