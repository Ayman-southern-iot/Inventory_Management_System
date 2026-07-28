import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * `process.env` is allowed in exactly one place in the backend (rules/10-no-hardcoding.md).
 * The guard hook catches this too, but a lint rule fails the build rather than printing a warning.
 */
const NO_PROCESS_ENV = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    'process.env is only allowed in apps/api/src/config/. Import the typed config object instead.',
};

/** Catches `status === "APPROVED"` style literals where an enum member is meant. */
const NO_MAGIC_STATUS = {
  selector:
    "BinaryExpression[operator=/^[!=]==$/] > Literal.right[value=/^(APPROVED|REJECTED|PENDING|DRAFT|SUBMITTED|ISSUED|RETURNED|ADMIN|APPROVER|GENERAL|INVENTORY_MANAGER)$/]",
  message: 'Compare against the enum member, not a string literal (rules/10-no-hardcoding.md).',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/vite.config.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': ['error', NO_PROCESS_ENV, NO_MAGIC_STATUS],
    },
  },

  /**
   * NestJS resolves constructor dependencies from `design:paramtypes`, which the compiler only
   * emits for VALUE imports. Rewriting a constructor parameter's import to `import type` erases
   * it at compile time and the container fails to resolve the provider — at boot, not at build.
   * The rule cannot tell a DI parameter from an ordinary type, so it is off for backend source.
   */
  {
    files: ['apps/api/src/**/*.ts', 'apps/api/scripts/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },

  // The single sanctioned home of process.env.
  {
    files: ['apps/api/src/config/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', NO_MAGIC_STATUS] },
  },

  // Scripts and migrations run outside Nest's DI container, so they read config directly.
  {
    files: ['apps/api/scripts/**/*.ts', 'apps/api/src/database/migrations/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Vite exposes import.meta.env; process.env does not exist in the browser at all.
      'no-restricted-syntax': ['error', NO_PROCESS_ENV, NO_MAGIC_STATUS],
    },
  },

  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },
);
