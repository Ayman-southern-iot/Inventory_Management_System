import { defineConfig } from 'vitest/config';
import { decoratorMetadata } from './test/config/decorator-metadata-plugin';
import { TEST_ENV } from './test/config/test-env';

/**
 * Benchmarks. Same database, same Nest application, same plugin — deliberately **not** in the
 * integration suite's `include`.
 *
 * A twenty-thousand-shelf apply takes minutes and creates tens of thousands of permanent rows
 * (`stock_ledger` is append-only and products cannot be deleted), so running it on every gate
 * would make the suite slower and dirtier every time. This is run by hand when a number in
 * `importing_data.md` §11.2 needs to stop being arithmetic:
 *
 *   pnpm --filter @ims/api exec vitest run --config vitest.bench.config.ts
 */
export default defineConfig({
  esbuild: false,
  plugins: [decoratorMetadata()],
  test: {
    environment: 'node',
    globals: true,
    include: ['test/bench/**/*.bench-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/config/setup-file.ts'],
    env: TEST_ENV,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // Minutes, not seconds — that is the whole point of the exercise.
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
