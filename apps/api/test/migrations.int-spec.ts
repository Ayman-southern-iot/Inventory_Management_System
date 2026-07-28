import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import { buildConfig } from '../src/config/config.schema';
import { createDatabase, type Db } from '../src/database/create-db';
import {
  listTables,
  migrateAllTheWayDown,
  migrateUp,
  migratorFor,
  resetSchemaOn,
} from './config/migrate';
import { MIGRATION_SCRATCH_DB_NAME, TEST_ENV } from './config/test-env';

/**
 * Plan 0.3's acceptance criterion, on its own database so it cannot roll the schema out from
 * under the specs that are using it.
 *
 * The list is written out rather than derived from the migrations, on purpose: a migration that
 * quietly stops creating a table should fail here, and a check derived from the same source it
 * is checking would not notice.
 */
const EXPECTED_TABLES = [
  'app_settings',
  'approver_slots',
  'departments',
  'login_attempts',
  'refresh_tokens',
  'user_roles',
  'users',
];

/** Kysely's own bookkeeping. `down` does not remove these and is not expected to. */
const MIGRATOR_TABLES = ['kysely_migration', 'kysely_migration_lock'];

const scratchConfig = buildConfig({ ...TEST_ENV, POSTGRES_DB: MIGRATION_SCRATCH_DB_NAME });
const serverConfig = buildConfig(TEST_ENV);

describe('migrations', () => {
  let db: Db;
  let pool: Pool;

  beforeAll(async () => {
    const server = createDatabase(serverConfig);
    try {
      // CREATE DATABASE cannot run inside a transaction, so these are two separate statements.
      await sql.raw(`DROP DATABASE IF EXISTS ${MIGRATION_SCRATCH_DB_NAME}`).execute(server.db);
      await sql.raw(`CREATE DATABASE ${MIGRATION_SCRATCH_DB_NAME}`).execute(server.db);
    } finally {
      await server.db.destroy();
      await server.pool.end().catch(() => undefined);
    }

    ({ db, pool } = createDatabase(scratchConfig));
  });

  // Every test starts from a genuinely empty schema and migrates whatever it needs itself.
  // Nothing here may depend on a previous test having left the schema in some state.
  beforeEach(async () => {
    await resetSchemaOn(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await pool?.end().catch(() => undefined);

    const server = createDatabase(serverConfig);
    try {
      await sql.raw(`DROP DATABASE IF EXISTS ${MIGRATION_SCRATCH_DB_NAME}`).execute(server.db);
    } finally {
      await server.db.destroy();
      await server.pool.end().catch(() => undefined);
    }
  });

  it('applies from empty, rolls all the way back, and applies again cleanly', async () => {
    expect(await listTables(db)).toEqual([]);

    const applied = await migrateUp(db);
    expect(applied.length).toBeGreaterThan(0);
    expect(await listTables(db)).toEqual(
      expect.arrayContaining([...EXPECTED_TABLES, ...MIGRATOR_TABLES]),
    );

    const reverted = await migrateAllTheWayDown(db);
    expect(reverted).toEqual([...applied].reverse());
    // Nothing of the domain schema survives a full rollback — a leftover table or enum type is
    // what makes the *next* deploy fail instead of this one.
    expect(await listTables(db)).toEqual(MIGRATOR_TABLES);

    const reapplied = await migrateUp(db);
    expect(reapplied).toEqual(applied);
    expect(await listTables(db)).toEqual(
      expect.arrayContaining([...EXPECTED_TABLES, ...MIGRATOR_TABLES]),
    );
  });

  it('records every migration as executed', async () => {
    await migrateUp(db);

    const migrator = migratorFor(db);
    const all = await migrator.getMigrations();

    expect(all.length).toBeGreaterThan(0);
    for (const migration of all) {
      expect({ name: migration.name, executed: migration.executedAt !== undefined }).toEqual({
        name: migration.name,
        executed: true,
      });
    }
  });

  it('leaves the extensions later phases depend on in place', async () => {
    await migrateUp(db);

    const result = await sql<{ extname: string }>`
      SELECT extname FROM pg_extension ORDER BY extname
    `.execute(db);

    expect(result.rows.map((r) => r.extname)).toEqual(
      expect.arrayContaining(['pg_trgm', 'pgcrypto']),
    );
  });

  it('enforces the invariants the application relies on as database constraints', async () => {
    await migrateUp(db);

    // A comment or a service check would not survive a bad backfill; a CHECK constraint does.
    await expect(
      sql`INSERT INTO departments (name) VALUES ('   ')`.execute(db),
    ).rejects.toThrow();

    await expect(
      sql`
        INSERT INTO users (email, password_hash, full_name, designation)
        VALUES ('Mixed@Case.test', 'x', 'Someone', 'Engineer')
      `.execute(db),
    ).rejects.toThrow();

    await expect(
      sql`
        INSERT INTO users (email, password_hash, full_name, designation)
        VALUES ('blank@designation.test', 'x', 'Someone', '   ')
      `.execute(db),
    ).rejects.toThrow();
  });

  it('allows only one company-wide row per approver slot', async () => {
    await migrateUp(db);
    await sql`INSERT INTO approver_slots (department_id, slot_no) VALUES (NULL, 1)`.execute(db);

    // NULL never equals NULL, so a plain UNIQUE (department_id, slot_no) would let this through.
    await expect(
      sql`INSERT INTO approver_slots (department_id, slot_no) VALUES (NULL, 1)`.execute(db),
    ).rejects.toThrow();
  });
});
