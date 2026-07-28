import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Migrator, type Migration, type MigrationProvider, type Kysely } from 'kysely';

export const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Kysely's built-in FileMigrationProvider uses dynamic `import()`, which chokes on bare Windows
 * paths (`D:\...` is parsed as a URL scheme). We are CommonJS, so `require` both works on
 * Windows and lets `tsx` resolve `.ts` migrations in development and `.js` in the container.
 */
class RequireMigrationProvider implements MigrationProvider {
  constructor(private readonly dir: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = readdirSync(this.dir)
      .filter((f) => /^\d{4}_.+\.(ts|js)$/.test(f) && !f.endsWith('.d.ts'))
      .sort();

    const migrations: Record<string, Migration> = {};
    for (const file of files) {
      const name = file.replace(/\.(ts|js)$/, '');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require(join(this.dir, file)) as Migration;
      if (typeof loaded.up !== 'function') {
        throw new Error(`Migration ${file} does not export an \`up\` function`);
      }
      migrations[name] = loaded;
    }
    return migrations;
  }
}

export function createMigrator<Schema>(db: Kysely<Schema>, dir: string = MIGRATIONS_DIR): Migrator {
  return new Migrator({
    db,
    provider: new RequireMigrationProvider(dir),
    // Explicit names keep the two tables out of the way of the domain schema.
    migrationTableName: 'kysely_migration',
    migrationLockTableName: 'kysely_migration_lock',
  });
}
