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

/**
 * `date` columns stay strings — QA round 2, D-014.
 *
 * By default pg parses `date` into a JS `Date` at the *server's* local midnight. Every reader
 * then formatted it with `.toISOString().slice(0, 10)`, which is UTC, so on a UTC+6 box
 * 2027-03-18 came back as 2027-03-17. The API's own zone is what decides this, and it is only
 * pinned for the demo stack (`x-api-env` in the root compose); production takes it from
 * `infra/.env`, which is not in version control — so whether this bug fired at all depended on
 * an unversioned variable. The edit forms repopulate from the stored value and send it straight
 * back, so each save lost another day: a deadline entered as the 27th reached the 25th after
 * two saves, on the deployed instance.
 *
 * A `date` has no time and no zone — it is a calendar day — so turning it into an instant is
 * the error, and formatting that instant is only where the error becomes visible. Handing the
 * text back untouched removes the whole class rather than fixing seven call sites, each of
 * which already has a `typeof value === 'string'` branch that now becomes the only one taken.
 *
 * Writes are unaffected: they already bind `YYYY-MM-DD` strings. SQL-side comparisons against
 * `current_date` are unaffected too, and were always right — Postgres resolves those in the
 * session's timezone, which is the calendar the user is actually in.
 */
const PG_DATE_OID = 1082;
types.setTypeParser(PG_DATE_OID, (value) => value);

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
