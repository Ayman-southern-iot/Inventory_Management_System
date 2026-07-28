import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Unit specs only. Integration specs need a live Postgres and run via vitest.integration.config.
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
