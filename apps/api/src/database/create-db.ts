import { Kysely, PostgresDialect, type LogEvent } from 'kysely';
import { Pool, types } from 'pg';
import type { AppConfig } from '../config';
import type { Database } from './schema';

/**
 * `numeric` arrives from pg as a string to avoid float rounding. Money in this system is BDT
 * integers, but a NUMERIC column added later must not silently start losing paisa — so the
 * default string behaviour is left alone deliberately. int8 (bigint) is safe to narrow because
 * every bigint here is a COUNT.
 */
const PG_INT8_OID = 20;
types.setTypeParser(PG_INT8_OID, (value) => Number(value));

export interface CreatedDatabase {
  db: Kysely<Database>;
  pool: Pool;
}

export function createDatabase(config: AppConfig, onLog?: (event: LogEvent) => void): CreatedDatabase {
  const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
    max: config.db.poolMax,
    // A query that has hung for a minute is a bug, not slow hardware. Failing it frees the
    // connection instead of letting the pool starve.
    statement_timeout: 60_000,
    idle_in_transaction_session_timeout: 30_000,
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    log: onLog,
  });

  return { db, pool };
}

export type Db = Kysely<Database>;
