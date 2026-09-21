/**
 * Postgres error codes the catalogue modules rely on.
 *
 * Catching the constraint violation is deliberate: a pre-flight `SELECT` would still lose the
 * race against a concurrent insert, so the database index is the guarantee and this is the
 * translation layer (rules/40-database.md — application checks are advisory, constraints are not).
 */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, PG_UNIQUE_VIOLATION);
}

export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, PG_FOREIGN_KEY_VIOLATION);
}

const PG_CHECK_VIOLATION = '23514';

/**
 * A `RAISE EXCEPTION ... USING ERRCODE = 'check_violation'` from a trigger.
 *
 * The category tree's depth and cycle guards are triggers rather than constraints, because
 * Postgres `CHECK` cannot look at other rows. They already raise a sentence written for a human
 * ("Categories go three levels deep at most"), so the translation layer surfaces that message
 * rather than inventing a second, vaguer one that would drift from the trigger it describes.
 */
export function isCheckViolation(error: unknown): boolean {
  return hasCode(error, PG_CHECK_VIOLATION);
}

/** The `MESSAGE` a plpgsql `RAISE EXCEPTION` carried, when there is one. */
export function checkViolationMessage(error: unknown): string | null {
  if (!isCheckViolation(error)) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim().length > 0 ? message : null;
}
