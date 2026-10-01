/*
 * Borrowing-module constants that are part of the model rather than policy (rules/10).
 */

/**
 * The namespace of the transaction-scoped advisory lock that serialises one service account's
 * takes while its daily allowance is counted and spent (DIRECT_TAKE_DAILY_UNITS_PER_ACCOUNT). The
 * lock key is this plus the account id, hashed by Postgres; nothing else takes a lock in it.
 */
export const DIRECT_TAKE_ALLOWANCE_LOCK = 'direct-take-allowance';
