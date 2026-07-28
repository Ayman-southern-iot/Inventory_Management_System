import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Populates `process.env` from the repo-root `.env` before the config schema validates it.
 *
 * Imported for its side effect by `config.ts` only, and it must stay that way — this and
 * `config.ts` are the two files permitted to name `process.env` (rules/10-no-hardcoding.md).
 * In Docker the variables arrive via `env_file`, no `.env` exists, and this is a no-op.
 */
const CANDIDATES = [
  resolve(process.cwd(), '.env'), // running from the repo root
  resolve(process.cwd(), '../../.env'), // running from apps/api
  resolve(__dirname, '../../../../.env'), // running from apps/api/dist/src/config
];

for (const path of CANDIDATES) {
  if (existsSync(path)) {
    loadDotenv({ path });
    break;
  }
}
