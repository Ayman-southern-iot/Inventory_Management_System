import { defineConfig } from 'vitest/config';
import { decoratorMetadata } from './test/config/decorator-metadata-plugin';
import { TEST_ENV } from './test/config/test-env';

export default defineConfig({
  // Off deliberately: esbuild cannot emit `design:paramtypes`, so Nest's DI would fail to
  // resolve every constructor dependency. The plugin below transpiles .ts with tsc instead.
  esbuild: false,
  plugins: [decoratorMetadata()],
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.int-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/config/setup-file.ts'],
    // The workers are forked processes; `globalSetup`'s process.env mutations are inherited,
    // but declaring them here as well means a worker cannot start against the dev database
    // even if that inheritance ever changes.
    env: TEST_ENV,
    // Integration tests share one throwaway database; running them in parallel across
    // workers would have them truncating each other's rows mid-assertion.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
