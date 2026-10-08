import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './test/config/test-env';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Several services import `config`, which validates `process.env` the moment it loads. Without
    // this, a unit spec passes only on a machine whose root `.env` happens to be complete and
    // valid, and fails on a bare CI runner. The same pinned values the integration suite uses.
    env: TEST_ENV,
    // Unit specs only. Integration specs need a live Postgres and run via vitest.integration.config.
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
