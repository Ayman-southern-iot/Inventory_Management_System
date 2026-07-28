import { sql, type Kysely } from 'kysely';

/**
 * Extensions, the shared updated_at trigger, and `app_settings`.
 *
 * `app_settings.updated_by` is created without its foreign key because `users` does not exist
 * yet; migration 0002 adds the constraint. Additive first (rules/40-database.md).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Trigram index support for product-name search in Phase 01. Creating the extension early
  // keeps later migrations from needing superuser at an awkward moment.
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await db.schema
    .createTable('app_settings')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('value', 'jsonb', (col) => col.notNull())
    .addColumn('updated_by', 'uuid')
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE TRIGGER app_settings_set_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('app_settings').ifExists().execute();
  await sql`DROP FUNCTION IF EXISTS set_updated_at()`.execute(db);
  // Extensions are deliberately left in place: dropping pg_trgm would cascade away indexes
  // belonging to migrations that are not being rolled back.
}
