/**
 * Idempotent reference data. Safe to run on every deploy — nothing here overwrites a value a
 * human has since changed (rules/40-database.md: seeds are idempotent, migrations hold no data).
 *
 *   pnpm db:seed
 *
 * Creates the seed admin from env, plus one user of each role in non-production so a developer
 * can log in as every persona (plan/PHASE-00 exit criteria). In production only the admin is
 * created — demo accounts with known passwords on a live system are a liability.
 */
import { hash, Algorithm } from '@node-rs/argon2';
import { Role, SETTING_KEYS, getSettingDefinition } from '@ims/shared';
import { config } from '../src/config';
import { createDatabase, type Db } from '../src/database/create-db';
import { CATEGORY_SEED_TREE, type SeedCategory } from '../src/database/category-seed-tree';
import { generateStorageId } from '../src/modules/locations/storage-id';

const ARGON2 = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * The persona accounts exist when `DEMO_ACCOUNTS_ENABLED` is on, or in any non-production
 * environment. Their password is deliberately obvious and comes from config — with demo mode
 * on it is also printed on the login page, which is the whole point and the whole risk.
 */
const demoEnabled = config.demo.accountsEnabled || !config.isProduction;
const DEMO_PASSWORD = config.demo.password;

interface SeedUser {
  email: string;
  fullName: string;
  designation: string;
  roles: Role[];
  department: string | null;
}

const DEV_USERS: SeedUser[] = [
  {
    email: 'general@ims.local',
    fullName: 'Gina General',
    designation: 'Engineer',
    roles: [Role.GENERAL],
    department: 'Engineering',
  },
  {
    email: 'im@ims.local',
    fullName: 'Imran Manager',
    designation: 'Inventory Manager',
    roles: [Role.GENERAL, Role.INVENTORY_MANAGER],
    department: 'Operations',
  },
  {
    email: 'approver1@ims.local',
    fullName: 'Ayesha Approver',
    designation: 'Head of Operations',
    roles: [Role.GENERAL, Role.APPROVER],
    department: 'Operations',
  },
  {
    email: 'approver2@ims.local',
    fullName: 'Farhan Finance',
    designation: 'Chief Financial Officer',
    roles: [Role.GENERAL, Role.APPROVER],
    department: 'Accounts',
  },
];

const DEV_DEPARTMENTS = ['Engineering', 'Operations', 'Accounts'];

/** The room the seeded zones hang under. Reference data, so a literal belongs here. */
const SEED_ROOM_NAME = 'Main Store';

/**
 * Insert the taxonomy tree, skipping anything already there.
 *
 * Look-then-insert rather than ON CONFLICT DO NOTHING: sibling uniqueness is enforced by two
 * *partial* indexes (one for roots, one for children, migration 0006), and an unqualified
 * ON CONFLICT cannot target a partial index. Re-running is a no-op, and a node an IM has since
 * renamed is left alone rather than resurrected under its old name beside the new one.
 */
async function seedCategoryTree(db: Db): Promise<number> {
  let added = 0;

  async function walk(nodes: SeedCategory[], parentId: string | null): Promise<void> {
    for (const node of nodes) {
      // `is null` rather than `= null`, which matches nothing — the root nodes would then be
      // re-inserted on every run, which is exactly the bug idempotency is meant to prevent.
      let row = await db
        .selectFrom('categories')
        .select('id')
        .where('name', '=', node.name)
        .$if(parentId === null, (qb) => qb.where('parent_id', 'is', null))
        .$if(parentId !== null, (qb) => qb.where('parent_id', '=', parentId!))
        .executeTakeFirst();

      if (!row) {
        row = await db
          .insertInto('categories')
          .values({ name: node.name, parent_id: parentId })
          .returning('id')
          .executeTakeFirst();
        added += 1;
      }
      if (!row) continue;

      if (node.children && node.children.length > 0) await walk(node.children, row.id);
    }
  }

  await walk(CATEGORY_SEED_TREE, null);
  return added;
}

async function main(): Promise<void> {
  const { db, pool } = createDatabase(config);
  console.log(`Seeding ${config.db.database}@${config.db.host}:${config.db.port}`);

  try {
    // --- app_settings ---------------------------------------------------------
    for (const key of SETTING_KEYS) {
      const definition = getSettingDefinition(key);
      const value = definition.schema.parse(config.settingSeeds[definition.seedEnvVar]);
      const result = await db
        .insertInto('app_settings')
        .values({ key, value: JSON.stringify(value) })
        .onConflict((oc) => oc.column('key').doNothing())
        .executeTakeFirst();
      if ((result.numInsertedOrUpdatedRows ?? 0n) > 0n) console.log(`  setting  ${key} = ${value}`);
    }

    // --- departments ----------------------------------------------------------
    const departmentIds = new Map<string, string>();
    if (demoEnabled) {
      for (const name of DEV_DEPARTMENTS) {
        await db
          .insertInto('departments')
          .values({ name })
          .onConflict((oc) => oc.doNothing())
          .execute();
        const row = await db
          .selectFrom('departments')
          .select('id')
          .where('name', '=', name)
          .executeTakeFirst();
        if (row) departmentIds.set(name, row.id);
      }
    }

    // --- users ----------------------------------------------------------------
    const toSeed: SeedUser[] = [
      {
        email: config.seedAdmin.email,
        fullName: config.seedAdmin.fullName,
        designation: config.seedAdmin.designation,
        roles: [Role.GENERAL, Role.ADMIN],
        department: null,
      },
      ...(demoEnabled ? DEV_USERS : []),
    ];

    for (const user of toSeed) {
      const existing = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', user.email.toLowerCase())
        .executeTakeFirst();

      // The admin keeps its own configured password unless demo mode is explicitly on, in which
      // case every listed account shares the demo password — including the admin, because the
      // login page advertises one password for the whole set.
      const plaintext =
        user.roles.includes(Role.ADMIN) && !config.demo.accountsEnabled
          ? config.seedAdmin.password
          : DEMO_PASSWORD;
      const passwordHash = await hash(plaintext, ARGON2);

      if (existing) {
        // Ordinarily a seed never overwrites what a human has changed. Demo mode is the
        // exception and has to be: switching it on against a database that already holds these
        // accounts would otherwise advertise a password that does not work.
        if (config.demo.accountsEnabled) {
          await db
            .updateTable('users')
            .set({ password_hash: passwordHash, must_change_password: false, is_active: true })
            .where('id', '=', existing.id)
            .execute();
          console.log(`  user     ${user.email} (demo password reset)`);
        } else {
          console.log(`  user     ${user.email} (exists, untouched)`);
        }
        continue;
      }

      await db.transaction().execute(async (tx) => {
        const inserted = await tx
          .insertInto('users')
          .values({
            email: user.email.toLowerCase(),
            password_hash: passwordHash,
            full_name: user.fullName,
            designation: user.designation,
            department_id: user.department ? (departmentIds.get(user.department) ?? null) : null,
            // Seeded accounts are meant to be logged into directly, and a demo whose accounts
            // all demand a password change on first use is not a demo. Outside demo mode a
            // production admin still has to change the seed password immediately.
            must_change_password: config.isProduction && !config.demo.accountsEnabled,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await tx
          .insertInto('user_roles')
          .values(user.roles.map((role) => ({ user_id: inserted.id, role })))
          .execute();
      });

      console.log(`  user     ${user.email} [${user.roles.join(', ')}]`);
    }

    // --- approver slots (OQ-02: global defaults) --------------------------------
    if (demoEnabled) {
      const approvers = await db
        .selectFrom('users')
        .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
        .where('user_roles.role', '=', Role.APPROVER)
        .select(['users.id', 'users.email'])
        .orderBy('users.email')
        .execute();

      for (const [index, approver] of approvers.slice(0, 2).entries()) {
        const slotNo = index + 1;
        const already = await db
          .selectFrom('approver_slots')
          .select('id')
          .where('department_id', 'is', null)
          .where('slot_no', '=', slotNo)
          .executeTakeFirst();
        if (already) continue;

        await db
          .insertInto('approver_slots')
          .values({ department_id: null, slot_no: slotNo, user_id: approver.id })
          .execute();
        console.log(`  slot     global #${slotNo} -> ${approver.email}`);
      }
    }

    // --- category taxonomy ------------------------------------------------------
    // Reference data for every install, not demo-only: `category-taxonomy-spec.md` §1/§9 puts
    // the tree in the seed precisely so a new subcategory never needs a deploy. Everything
    // here is renameable, movable and deletable from the management screen the moment it lands.
    const seededCategories = await seedCategoryTree(db);
    if (seededCategories > 0) console.log(`  category ${seededCategories} node(s) added`);

    // --- demo inventory (development only) ------------------------------------
    // Enough of a catalogue that the inventory screens show something real on a fresh
    // checkout. Never in production: invented products in a live stock register are worse
    // than an empty one, because someone will eventually trust them.
    if (demoEnabled) {
      const categories: Array<{ name: string; trackable: boolean }> = [
        { name: 'Laptops', trackable: true },
        { name: 'R&D Hardware', trackable: true },
        { name: 'Cables & Consumables', trackable: true },
        // requirements §11 — furniture is deliberately out of scope for stock tracking.
        { name: 'Furniture', trackable: false },
      ];

      const categoryIds = new Map<string, string>();
      for (const category of categories) {
        await db
          .insertInto('categories')
          .values({ name: category.name, is_trackable: category.trackable })
          .onConflict((oc) => oc.doNothing())
          .execute();
        const row = await db
          .selectFrom('categories')
          .select('id')
          .where('name', '=', category.name)
          .executeTakeFirst();
        if (row) categoryIds.set(category.name, row.id);
      }

      const zones = [
        { name: 'Meta', compartments: ['1A', '1B', '2A'] },
        { name: 'Nvidia', compartments: ['3C', '4D'] },
      ];
      const compartmentIds = new Map<string, string>();

      // Zones live in a room since migration 0033. Seeded idempotently like everything else
      // here, and named neutrally because a fresh install renames it on day one.
      await db
        .insertInto('storage_rooms')
        .values({ name: SEED_ROOM_NAME })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const roomRow = await db
        .selectFrom('storage_rooms')
        .select('id')
        .where('name', '=', SEED_ROOM_NAME)
        .executeTakeFirstOrThrow();

      for (const zone of zones) {
        /**
         * Look first, insert second — and look across **every** room, not just the seeded one.
         *
         * This used to lean on `ON CONFLICT DO NOTHING` against the global unique index on zone
         * name. Migration 0033 replaced that index with a per-room one, so the conflict stopped
         * matching and a second run happily created a second "Meta" in a different room. On an
         * existing database that is exactly what happens: the migration parks the real zones in
         * a backfill room, then the seed adds its own copies. The seed's intent has always been
         * "ensure a zone called Meta exists" — that intent is name-global, so the lookup has to
         * be too, even though the constraint no longer is.
         */
        let zoneRow = await db
          .selectFrom('storage_zones')
          .select('id')
          .where('name', '=', zone.name)
          .executeTakeFirst();

        if (!zoneRow) {
          zoneRow = await db
            .insertInto('storage_zones')
            .values({ name: zone.name, room_id: roomRow.id })
            .returning('id')
            .executeTakeFirst();
        }
        if (!zoneRow) continue;

        for (const code of zone.compartments) {
          const existingCompartment = await db
            .selectFrom('storage_compartments')
            .select('id')
            .where('zone_id', '=', zoneRow.id)
            .where('code', '=', code)
            .executeTakeFirst();
          if (!existingCompartment) {
            await db
              .insertInto('storage_compartments')
              .values({
                zone_id: zoneRow.id,
                code,
                storage_id: await generateStorageId(db, zoneRow.id, code, config.storageId),
              })
              .execute();
          }
          const compartment = await db
            .selectFrom('storage_compartments')
            .select('id')
            .where('zone_id', '=', zoneRow.id)
            .where('code', '=', code)
            .executeTakeFirst();
          if (compartment) compartmentIds.set(`${zone.name}/${code}`, compartment.id);
        }
      }

      const products: Array<{
        code: string;
        name: string;
        category: string;
        unit: string;
        returnable: boolean;
        stock: Array<{ at: string; qty: number }>;
      }> = [
        {
          code: 'LAP-0001',
          name: 'Lenovo ThinkPad T14',
          category: 'Laptops',
          unit: 'pcs',
          returnable: true,
          stock: [
            { at: 'Meta/1A', qty: 7 },
            { at: 'Nvidia/3C', qty: 3 },
          ],
        },
        {
          code: 'GPU-0001',
          name: 'NVIDIA RTX 4090',
          category: 'R&D Hardware',
          unit: 'pcs',
          returnable: true,
          stock: [{ at: 'Nvidia/4D', qty: 4 }],
        },
        {
          code: 'CBL-0001',
          name: 'USB-C to HDMI cable',
          category: 'Cables & Consumables',
          unit: 'pcs',
          // OQ-08: consumable by default, still overridable on the borrow form.
          returnable: false,
          stock: [
            { at: 'Meta/1B', qty: 40 },
            { at: 'Meta/2A', qty: 15 },
          ],
        },
        {
          code: 'FRN-0001',
          name: 'Office chair',
          category: 'Furniture',
          unit: 'pcs',
          returnable: true,
          stock: [],
        },
      ];

      const seedActor = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', config.seedAdmin.email)
        .executeTakeFirst();

      for (const product of products) {
        const categoryId = categoryIds.get(product.category);
        if (!categoryId) continue;

        await db
          .insertInto('products')
          .values({
            product_code: product.code,
            name: product.name,
            category_id: categoryId,
            unit: product.unit,
            default_returnable: product.returnable,
          })
          .onConflict((oc) => oc.doNothing())
          .execute();

        const productRow = await db
          .selectFrom('products')
          .select('id')
          .where('product_code', '=', product.code)
          .executeTakeFirst();
        if (!productRow) continue;

        for (const placement of product.stock) {
          const compartmentId = compartmentIds.get(placement.at);
          if (!compartmentId) continue;

          // Idempotent: only seed opening stock where none has ever been recorded, so re-running
          // the seed cannot inflate quantities.
          const existing = await db
            .selectFrom('stock_placements')
            .select('id')
            .where('product_id', '=', productRow.id)
            .where('compartment_id', '=', compartmentId)
            .executeTakeFirst();
          if (existing) continue;

          await db.transaction().execute(async (tx) => {
            await tx
              .insertInto('stock_placements')
              .values({
                product_id: productRow.id,
                compartment_id: compartmentId,
                quantity: placement.qty,
              })
              .execute();
            // Written together with the placement so the reconciliation invariant holds from
            // the very first row.
            await tx
              .insertInto('stock_ledger')
              .values({
                product_id: productRow.id,
                to_compartment_id: compartmentId,
                quantity: placement.qty,
                movement_type: 'RECEIPT',
                ref_type: 'SEED',
                performed_by: seedActor?.id ?? null,
                note: 'Opening balance from seed',
              })
              .execute();
          });

          console.log(`  stock    ${product.code} ${placement.qty} @ ${placement.at}`);
        }
      }
    }

    console.log('Seed complete.');
  } finally {
    await db.destroy();
    await pool.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
