import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { NO_MIGRATIONS, sql, type Kysely, type Migrator, type MigrationResultSet } from 'kysely';
import type { AppConfig } from '../../src/config';
import { createDatabase } from '../../src/database/create-db';
import { createMigrator } from '../../src/database/migrator';

/**
 * The real migrator loads `*.ts` migration files with `require`, which works under `tsx` (how
 * `pnpm db:migrate` runs) but not under vite-node. Registering tsx's CommonJS hook gives the
 * migration provider the same loader the CLI has, so the tests exercise the production
 * migrator rather than a re-implementation that could disagree with it.
 */
let registered = false;
function registerTypeScriptRequire(): void {
  if (registered) return;
  const nodeRequire = createRequire(__filename);
  const tsx = nodeRequire('tsx/cjs/api') as { register: () => unknown };
  tsx.register();
  registered = true;
}

/** Absolute, so it does not depend on the runner's working directory. */
export const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'src', 'database', 'migrations');

function assertOk(results: MigrationResultSet, what: string): void {
  if (results.error) {
    throw new Error(`${what} failed: ${String(results.error)}`);
  }
}

export function migratorFor<Schema>(db: Kysely<Schema>): Migrator {
  registerTypeScriptRequire();
  return createMigrator(db, MIGRATIONS_DIR);
}

export async function migrateUp<Schema>(db: Kysely<Schema>): Promise<string[]> {
  const results = await migratorFor(db).migrateToLatest();
  assertOk(results, 'migrateToLatest');
  return (results.results ?? []).map((r) => r.migrationName);
}

export async function migrateAllTheWayDown<Schema>(db: Kysely<Schema>): Promise<string[]> {
  const results = await migratorFor(db).migrateTo(NO_MIGRATIONS);
  assertOk(results, 'migrateTo(NO_MIGRATIONS)');
  return (results.results ?? []).map((r) => r.migrationName);
}

/**
 * Drops and recreates `public`, so a run starts from genuinely nothing — no leftover tables,
 * no leftover enum types, no half-applied migration row from a crashed previous run.
 */
export async function resetSchemaOn<Schema>(db: Kysely<Schema>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS public CASCADE`.execute(db);
  await sql`CREATE SCHEMA public`.execute(db);
}

export async function resetSchema(config: AppConfig): Promise<void> {
  const { db, pool } = createDatabase(config);
  try {
    await resetSchemaOn(db);
  } finally {
    await db.destroy();
    await pool.end().catch(() => undefined);
  }
}

export async function listTables<Schema>(db: Kysely<Schema>): Promise<string[]> {
  const result = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `.execute(db);
  return result.rows.map((r) => r.table_name);
}
