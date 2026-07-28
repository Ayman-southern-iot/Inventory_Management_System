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
