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
import { createDatabase } from '../src/database/create-db';

const ARGON2 = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Only used outside production. The password is intentionally obvious, and so is the risk. */
const DEV_PASSWORD = 'DevPassword123';

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
    if (!config.isProduction) {
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
      ...(config.isProduction ? [] : DEV_USERS),
    ];

    for (const user of toSeed) {
      const existing = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', user.email.toLowerCase())
        .executeTakeFirst();

      if (existing) {
        console.log(`  user     ${user.email} (exists, untouched)`);
        continue;
      }

      const plaintext = user.roles.includes(Role.ADMIN)
        ? config.seedAdmin.password
        : DEV_PASSWORD;
      const passwordHash = await hash(plaintext, ARGON2);

      await db.transaction().execute(async (tx) => {
        const inserted = await tx
          .insertInto('users')
          .values({
            email: user.email.toLowerCase(),
            password_hash: passwordHash,
            full_name: user.fullName,
            designation: user.designation,
            department_id: user.department ? (departmentIds.get(user.department) ?? null) : null,
            // The seeded accounts are meant to be logged into directly during development;
            // forcing a change on first login would break every integration test.
            must_change_password: config.isProduction,
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
    if (!config.isProduction) {
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

    // --- demo inventory (development only) ------------------------------------
    // Enough of a catalogue that the inventory screens show something real on a fresh
    // checkout. Never in production: invented products in a live stock register are worse
    // than an empty one, because someone will eventually trust them.
    if (!config.isProduction) {
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
      for (const zone of zones) {
        await db
          .insertInto('storage_zones')
          .values({ name: zone.name })
          .onConflict((oc) => oc.doNothing())
          .execute();
        const zoneRow = await db
          .selectFrom('storage_zones')
          .select('id')
          .where('name', '=', zone.name)
          .executeTakeFirst();
        if (!zoneRow) continue;

        for (const code of zone.compartments) {
          await db
            .insertInto('storage_compartments')
            .values({ zone_id: zoneRow.id, code })
            .onConflict((oc) => oc.doNothing())
            .execute();
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
