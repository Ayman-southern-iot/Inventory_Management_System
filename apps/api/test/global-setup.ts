import 'reflect-metadata';
import { applyTestEnv, TEST_ENV } from './config/test-env';

// Before anything imports `src/config`, which reads process.env at module load.
applyTestEnv();

/**
 * Runs once, in the vitest main process, before any worker forks.
 *
 * Migrates the throwaway database from empty on every run. Not "migrate if needed": a suite
 * that inherits yesterday's schema will pass against a migration that no longer applies
 * cleanly, which is the exact failure the migration rules exist to prevent.
 */
export async function setup(): Promise<void> {
  const { buildConfig } = await import('../src/config/config.schema');
  const { createDatabase } = await import('../src/database/create-db');
  const { resetSchema, migrateUp } = await import('./config/migrate');

  // Built from the literal record, not process.env, so this cannot be redirected at the dev
  // database by a stray shell variable.
  const config = buildConfig(TEST_ENV);

  await resetSchema(config);

  const { db, pool } = createDatabase(config);
  try {
    const applied = await migrateUp(db);
    if (applied.length === 0) {
      throw new Error('No migrations were applied — the migration provider found nothing to run.');
    }
    console.warn(
      `[integration] ${config.db.database}@${config.db.host}:${config.db.port} migrated (${applied.length} migrations)`,
    );
  } finally {
    await db.destroy();
    await pool.end().catch(() => undefined);
  }
}
