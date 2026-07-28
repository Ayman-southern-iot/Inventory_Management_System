/**
 * Migration CLI.
 *
 *   pnpm db:migrate            apply everything outstanding
 *   pnpm db:rollback           undo the most recent migration
 *   pnpm db:make <name>        write an empty timestamp-ordered migration file
 *   pnpm db:migrate status     list what is applied and what is not
 *
 * Exit code is non-zero on any failure so the compose `migrate` service stops the deploy
 * rather than letting the API boot against a half-migrated database (rules/60-infra.md).
 */
import { writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config';
import { createDatabase } from '../src/database/create-db';
import { createMigrator } from '../src/database/migrator';

type Command = 'up' | 'down' | 'make' | 'status';

/** Kysely's own result discriminator — named so it does not read as a domain status. */
const MIGRATION_APPLIED = 'Success';
const MIGRATION_FAILED = 'Error';

// Source dir, not __dirname/dist — `make` writes TypeScript.
const SOURCE_MIGRATIONS_DIR = join(__dirname, '..', 'src', 'database', 'migrations');

const TEMPLATE = `import { sql, type Kysely } from 'kysely';

/**
 * TODO: describe *why* this change is being made.
 * Additive first: add nullable -> backfill -> enforce in a later migration.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  throw new Error('migration not implemented');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  throw new Error('rollback not implemented');
}
`;

function nextMigrationName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) throw new Error('Usage: pnpm db:make <name>');

  if (!existsSync(SOURCE_MIGRATIONS_DIR)) mkdirSync(SOURCE_MIGRATIONS_DIR, { recursive: true });

  const highest = readdirSync(SOURCE_MIGRATIONS_DIR)
    .map((f) => Number.parseInt(f.slice(0, 4), 10))
    .filter((n) => Number.isInteger(n))
    .reduce((max, n) => Math.max(max, n), 0);

  return `${String(highest + 1).padStart(4, '0')}_${slug}`;
}

function make(name: string): void {
  const filename = `${nextMigrationName(name)}.ts`;
  const path = join(SOURCE_MIGRATIONS_DIR, filename);
  writeFileSync(path, TEMPLATE, { flag: 'wx' });
  console.log(`Created ${path}`);
}

async function run(command: Command): Promise<void> {
  const { db, pool } = createDatabase(config);
  const migrator = createMigrator(db);

  try {
    if (command === 'status') {
      const all = await migrator.getMigrations();
      for (const m of all) {
        console.log(`${m.executedAt ? '[x]' : '[ ]'} ${m.name}`);
      }
      return;
    }

    const { error, results } = await (command === 'up'
      ? migrator.migrateToLatest()
      : migrator.migrateDown());

    for (const result of results ?? []) {
      const verb = command === 'up' ? 'applied' : 'reverted';
      if (result.status === MIGRATION_APPLIED) console.log(`  ok      ${result.migrationName} ${verb}`);
      else if (result.status === MIGRATION_FAILED) console.error(`  FAILED  ${result.migrationName}`);
      else console.warn(`  skipped ${result.migrationName}`);
    }

    if (error) throw error;
    if ((results ?? []).length === 0) console.log('Nothing to do — schema is up to date.');
  } finally {
    await db.destroy();
    await pool.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const [command = 'up', ...rest] = process.argv.slice(2);

  if (command === 'make') {
    make(rest.join(' '));
    return;
  }
  if (command !== 'up' && command !== 'down' && command !== 'status') {
    throw new Error(`Unknown command "${command}". Expected up | down | make | status.`);
  }

  console.log(`Migrating ${config.db.database}@${config.db.host}:${config.db.port} (${command})`);
  await run(command);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
