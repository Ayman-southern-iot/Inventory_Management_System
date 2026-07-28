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
