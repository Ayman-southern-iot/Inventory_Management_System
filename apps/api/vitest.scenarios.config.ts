/**
 * Scenario-seed runner. Pointed at the **dev** database (port 5433, db `ims`),
 * not the throwaway test database, because the point of the scenario seed is
 * the data landing in a database the developer can open a UI against.
 *
 * Reuses the same decorator-metadata plugin the integration config uses, so
 * `tsx`'s stripped `design:paramtypes` does not blow up Nest's DI.
 *
 * No `globalSetup`: this must not reset the schema, only append scenario rows.
 */
import { defineConfig } from 'vitest/config';
import { decoratorMetadata } from './test/config/decorator-metadata-plugin';

export default defineConfig({
  esbuild: false,
  plugins: [decoratorMetadata()],
  test: {
    environment: 'node',
    globals: true,
    include: ['test/scripts/seed-scenarios.spec.ts'],
    setupFiles: ['./test/config/setup-file.ts'],
    // Single fork so the scenario file's DB client and HTTP requests share state
    // cleanly. Parallel workers would each open their own DB pool and we'd
    // double-spend sequence values.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
