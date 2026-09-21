import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import { buildConfig } from '../src/config/config.schema';
import { createDatabase, type Db } from '../src/database/create-db';
import {
  listTables,
  migrateAllTheWayDown,
  migrateToNamed,
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

  /**
   * 0032 is the first migration in this project with a **backfill**: `current_holder_id` is
   * added nullable, filled from `requester_id`, and then made NOT NULL. Every other test in
   * this file migrates an empty schema, where that UPDATE touches zero rows and proves
   * nothing. rules/40-database.md asks for a run against data, so this is that run.
   */
  describe('0032 — custody backfill against existing rows', () => {
    const BEFORE = '0031_project_proposals';

    /** The smallest set of rows a `borrow_requests` insert will accept on a bare schema. */
    async function seedOneBorrow(): Promise<{ requesterId: string; borrowId: string }> {
      const user = await sql<{ id: string }>`
        INSERT INTO users (email, password_hash, full_name, designation)
        VALUES ('holder.backfill@ims.test', 'x', 'Backfill Borrower', 'Engineer')
        RETURNING id
      `.execute(db);
      const requesterId = user.rows[0]!.id;

      const category = await sql<{ id: string }>`
        INSERT INTO categories (name) VALUES ('Backfill Category') RETURNING id
      `.execute(db);
      const product = await sql<{ id: string }>`
        INSERT INTO products (product_code, name, category_id)
        VALUES ('BF-0001', 'Backfill Product', ${category.rows[0]!.id})
        RETURNING id
      `.execute(db);
      const zone = await sql<{ id: string }>`
        INSERT INTO storage_zones (name) VALUES ('Backfill Zone') RETURNING id
      `.execute(db);
      const compartment = await sql<{ id: string }>`
        INSERT INTO storage_compartments (zone_id, code)
        VALUES (${zone.rows[0]!.id}, 'BF1')
        RETURNING id
      `.execute(db);

      const borrow = await sql<{ id: string }>`
        INSERT INTO borrow_requests
          (borrow_no, requester_id, product_id, compartment_id, quantity, is_returnable, status)
        VALUES
          ('BR-999001', ${requesterId}, ${product.rows[0]!.id}, ${compartment.rows[0]!.id},
           2, true, 'ISSUED')
        RETURNING id
      `.execute(db);

      return { requesterId, borrowId: borrow.rows[0]!.id };
    }

    it('fills current_holder_id from requester_id on rows that already existed', async () => {
      await migrateToNamed(db, BEFORE);

      // The column does not exist yet — that is the state a real deployment is in.
      const before = await sql<{ n: string }>`
        SELECT count(*) AS n FROM information_schema.columns
        WHERE table_name = 'borrow_requests' AND column_name = 'current_holder_id'
      `.execute(db);
      expect(Number(before.rows[0]!.n)).toBe(0);

      const { requesterId, borrowId } = await seedOneBorrow();

      await migrateUp(db);

      const after = await sql<{ requester_id: string; current_holder_id: string }>`
        SELECT requester_id, current_holder_id FROM borrow_requests WHERE id = ${borrowId}
      `.execute(db);
      // The grandfathered row is held by whoever asked for it, and `requester_id` is untouched.
      expect(after.rows[0]).toEqual({
        requester_id: requesterId,
        current_holder_id: requesterId,
      });
    });

    it('refuses a borrow with no holder once the backfill has run', async () => {
      await migrateToNamed(db, BEFORE);
      const { requesterId } = await seedOneBorrow();
      await migrateUp(db);

      // NOT NULL is the point of the third step. Without it "who has this" is answerable with
      // "nobody", which is never true of equipment that has left the shelf.
      await expect(
        sql`
          UPDATE borrow_requests SET current_holder_id = NULL WHERE requester_id = ${requesterId}
        `.execute(db),
      ).rejects.toThrow();
    });

    it('keeps the custody trail append-only', async () => {
      await migrateToNamed(db, BEFORE);
      const { requesterId, borrowId } = await seedOneBorrow();
      await migrateUp(db);

      const other = await sql<{ id: string }>`
        INSERT INTO users (email, password_hash, full_name, designation)
        VALUES ('second.holder@ims.test', 'x', 'Second Holder', 'Engineer')
        RETURNING id
      `.execute(db);

      await sql`
        INSERT INTO borrow_holder_changes
          (borrow_request_id, from_user_id, to_user_id, changed_by, reason)
        VALUES (${borrowId}, ${requesterId}, ${other.rows[0]!.id}, ${requesterId}, 'handover')
      `.execute(db);

      // The trigger fails every role including the owner, exactly as stock_ledger does.
      await expect(
        sql`UPDATE borrow_holder_changes SET reason = 'rewritten'`.execute(db),
      ).rejects.toThrow();
      await expect(sql`DELETE FROM borrow_holder_changes`.execute(db)).rejects.toThrow();

      // And the two CHECKs, which are what stop an empty reason or a transfer to nobody.
      await expect(
        sql`
          INSERT INTO borrow_holder_changes
            (borrow_request_id, from_user_id, to_user_id, changed_by, reason)
          VALUES (${borrowId}, ${requesterId}, ${requesterId}, ${requesterId}, 'same person')
        `.execute(db),
      ).rejects.toThrow();
      await expect(
        sql`
          INSERT INTO borrow_holder_changes
            (borrow_request_id, from_user_id, to_user_id, changed_by, reason)
          VALUES (${borrowId}, ${requesterId}, ${other.rows[0]!.id}, ${requesterId}, '   ')
        `.execute(db),
      ).rejects.toThrow();
    });
  });

  /**
   * 0034 stamps a Storage ID on every shelf slot, including the ones that already existed
   * (Ayman, 2026-09-21). The ID is printed on a physical label, so the three things that matter
   * are: every slot gets one, no two are the same, and none of them can ever change.
   */
  describe('0034 — storage ids on existing shelves', () => {
    const BEFORE = '0033_storage_rooms';

    /** Two rooms, two zones, three shelves — enough to prove ordering and uniqueness. */
    async function seedShelves(): Promise<void> {
      await sql`INSERT INTO storage_rooms (name) VALUES ('Laboratory'), ('Store Room')`.execute(db);
      await sql`
        INSERT INTO storage_zones (name, room_id)
        SELECT 'Meta', id FROM storage_rooms WHERE name = 'Laboratory'
      `.execute(db);
      await sql`
        INSERT INTO storage_zones (name, room_id)
        SELECT 'Meta', id FROM storage_rooms WHERE name = 'Store Room'
      `.execute(db);
      await sql`
        INSERT INTO storage_compartments (zone_id, code)
        SELECT z.id, c.code
        FROM storage_zones z
        JOIN storage_rooms r ON r.id = z.room_id
        CROSS JOIN (VALUES ('1A'), ('2B')) AS c(code)
        WHERE r.name = 'Laboratory'
      `.execute(db);
      await sql`
        INSERT INTO storage_compartments (zone_id, code)
        SELECT z.id, '1A' FROM storage_zones z
        JOIN storage_rooms r ON r.id = z.room_id
        WHERE r.name = 'Store Room'
      `.execute(db);
    }

    it('gives every pre-existing shelf an id, in building order', async () => {
      await migrateToNamed(db, BEFORE);
      await seedShelves();
      await migrateUp(db);

      const rows = await sql<{ room: string; zone: string; code: string; storage_id: string }>`
        SELECT r.name AS room, z.name AS zone, c.code, c.storage_id
        FROM storage_compartments c
        JOIN storage_zones z ON z.id = c.zone_id
        JOIN storage_rooms r ON r.id = z.room_id
        ORDER BY c.storage_id
      `.execute(db);

      expect(rows.rows.map((r) => r.storage_id)).toEqual([
        'LAB-MET-1A-0001',
        'LAB-MET-2B-0002',
        'STO-MET-1A-0003',
      ]);
      // The same zone name in two rooms is exactly what rooms were added for, and the two
      // "Meta / 1A" shelves must still get different labels.
      expect(new Set(rows.rows.map((r) => r.storage_id)).size).toBe(3);
    });

    it('refuses a duplicate id, case and whitespace insensitively', async () => {
      await migrateToNamed(db, BEFORE);
      await seedShelves();
      await migrateUp(db);

      const zone = await sql<{ id: string }>`SELECT id FROM storage_zones LIMIT 1`.execute(db);
      await expect(
        sql`
          INSERT INTO storage_compartments (zone_id, code, storage_id)
          VALUES (${zone.rows[0]!.id}, 'NEW', '  lab-met-1a-0001  ')
        `.execute(db),
      ).rejects.toThrow();
    });

    /**
     * The one that protects the physical world: renaming the room must not rewrite the label
     * already stuck on the shelf underneath it.
     */
    it('refuses to change an id once assigned, including via a room rename', async () => {
      await migrateToNamed(db, BEFORE);
      await seedShelves();
      await migrateUp(db);

      await expect(
        sql`UPDATE storage_compartments SET storage_id = 'LAB-MET-1A-9999'`.execute(db),
      ).rejects.toThrow();

      // Renaming the room is allowed and simply leaves the ids alone — the room token is a
      // snapshot of the name at creation, not a view of it.
      await sql`UPDATE storage_rooms SET name = 'Big Lab' WHERE name = 'Laboratory'`.execute(db);
      const after = await sql<{ storage_id: string }>`
        SELECT storage_id FROM storage_compartments ORDER BY storage_id LIMIT 1
      `.execute(db);
      expect(after.rows[0]!.storage_id).toBe('LAB-MET-1A-0001');
    });

    it('carries on numbering past the backfilled rows', async () => {
      await migrateToNamed(db, BEFORE);
      await seedShelves();
      await migrateUp(db);

      // The sequence was moved past the backfill, so the next slot cannot collide with one.
      const next = await sql<{ n: string }>`SELECT nextval('storage_id_seq') AS n`.execute(db);
      expect(Number(next.rows[0]!.n)).toBeGreaterThan(3);
    });

    it('refuses a shelf with no id at all', async () => {
      await migrateToNamed(db, BEFORE);
      await seedShelves();
      await migrateUp(db);

      await expect(
        sql`UPDATE storage_compartments SET storage_id = NULL`.execute(db),
      ).rejects.toThrow();
    });
  });

  /**
   * 0035 makes category optional and puts the tree's two shape rules in the database. The spec
   * (§4) is explicit that a `CHECK` cannot express either: Postgres `CHECK` constraints cannot
   * reference other rows, and both depth and cycles mean walking `parent_id`.
   */
  describe('0035 — the category tree keeps its shape', () => {
    const BEFORE = '0034_compartment_storage_id';

    async function chain(): Promise<{ l1: string; l2: string; l3: string }> {
      const l1 = (
        await sql<{ id: string }>`
          INSERT INTO categories (name) VALUES ('Electronics') RETURNING id
        `.execute(db)
      ).rows[0]!.id;
      const l2 = (
        await sql<{ id: string }>`
          INSERT INTO categories (name, parent_id) VALUES ('Sensors', ${l1}) RETURNING id
        `.execute(db)
      ).rows[0]!.id;
      const l3 = (
        await sql<{ id: string }>`
          INSERT INTO categories (name, parent_id) VALUES ('Motion', ${l2}) RETURNING id
        `.execute(db)
      ).rows[0]!.id;
      return { l1, l2, l3 };
    }

    it('allows three levels and refuses a fourth', async () => {
      await migrateUp(db);
      const { l3 } = await chain();

      await expect(
        sql`INSERT INTO categories (name, parent_id) VALUES ('Too Deep', ${l3})`.execute(db),
      ).rejects.toThrow(/three levels deep/);
    });

    it('refuses to move a node underneath its own descendant', async () => {
      await migrateUp(db);
      const { l1, l3 } = await chain();

      await expect(
        sql`UPDATE categories SET parent_id = ${l3} WHERE id = ${l1}`.execute(db),
      ).rejects.toThrow(/underneath itself/);
    });

    it('allows a legal move, and the products travel with the node', async () => {
      await migrateUp(db);
      const { l1, l2 } = await chain();
      const other = (
        await sql<{ id: string }>`
          INSERT INTO categories (name) VALUES ('Mechanical') RETURNING id
        `.execute(db)
      ).rows[0]!.id;

      await sql`
        INSERT INTO products (product_code, name, category_id) VALUES ('P-1', 'IMU', ${l2})
      `.execute(db);

      await sql`UPDATE categories SET parent_id = ${other} WHERE id = ${l2}`.execute(db);

      const product = await sql<{ category_id: string }>`
        SELECT category_id FROM products WHERE product_code = 'P-1'
      `.execute(db);
      // The product points at the node's id, not its position, so a move costs it nothing.
      expect(product.rows[0]!.category_id).toBe(l2);
      expect(l1).not.toBe(other);
    });

    /** A move that would push a whole subtree past level 3 is still a depth violation. */
    it('refuses a move that would push the node itself too deep', async () => {
      await migrateUp(db);
      const { l3 } = await chain();
      const loose = (
        await sql<{ id: string }>`INSERT INTO categories (name) VALUES ('Loose') RETURNING id`.execute(
          db,
        )
      ).rows[0]!.id;

      await expect(
        sql`UPDATE categories SET parent_id = ${l3} WHERE id = ${loose}`.execute(db),
      ).rejects.toThrow(/three levels deep/);
    });

    it('lets a product exist with no category at all', async () => {
      await migrateToNamed(db, BEFORE);

      // Before 0035 the column is NOT NULL, so this is the state the migration unlocks.
      await expect(
        sql`INSERT INTO products (product_code, name) VALUES ('P-NULL', 'Mystery')`.execute(db),
      ).rejects.toThrow();

      await migrateUp(db);

      await sql`INSERT INTO products (product_code, name) VALUES ('P-NULL', 'Mystery')`.execute(db);
      const row = await sql<{ category_id: string | null }>`
        SELECT category_id FROM products WHERE product_code = 'P-NULL'
      `.execute(db);
      expect(row.rows[0]!.category_id).toBeNull();
    });
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
