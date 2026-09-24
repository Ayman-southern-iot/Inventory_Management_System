/**
 * How many shelves one `WHERE (…) OR (…)` may cover when the import lock looks up placement ids.
 *
 * Not a policy and not tunable: it is a property of the query builder. Kysely compiles an `OR`
 * list into a nested binary tree and walks it by recursion, so a long enough list overflows the
 * V8 stack while the SQL is still being *built* — before Postgres sees anything. Measured in
 * `test/bench/lock-or-depth.bench-spec.ts`: 20,000 terms always fails, and 5,000 to 10,000 fails
 * or passes depending on how deep the stack already is, which is not a property anything should
 * depend on. The apply path splits its lookup into runs of this size instead.
 *
 * It does not change what is locked or in what order — ids from every run are pooled and sorted
 * before a single row is locked.
 */
export const IMPORT_LOCK_LOOKUP_CHUNK = 500;

/**
 * How many placements one pre-creating `INSERT … VALUES` may carry.
 *
 * Postgres accepts at most 65,535 bind parameters in one statement and this insert binds three
 * per row, so a single statement caps out near 21,845 shelves. Chunking well below that keeps
 * the statement a normal size; ordering is preserved because the runs are taken in sorted order.
 */
export const IMPORT_LOCK_INSERT_CHUNK = 1_000;
