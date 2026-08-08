import { sql, type Kysely } from 'kysely';

/**
 * Pre-draft supporting document uploads.
 *
 * Mirrors the orphan-upload pattern used by every file upload that has to exist
 * before its parent row does (the signature flow pre-dates this one but doesn't
 * need it because a signature is per-user, not per-row). On the requisition form,
 * the requester can now pick a supporting document **before saving the draft**;
 * the file is written to `stored_files` immediately with `kind = 'SUPPORTING_DOCUMENT'`
 * and `pending_claim_by = actor.id`. When the draft is saved (`POST /requisitions`),
 * the create service claims the file in the same transaction: it sets
 * `requisitions.supporting_document_file_id` and clears `pending_claim_by`.
 *
 * The new column is the **only** schema change. The existing DRAFT-only attach
 * endpoint, the insert-only file model, and the audit row shape are unchanged.
 *
 * **No partial index here.** A partial index on `created_at` filtered to
 * `kind = 'SUPPORTING_DOCUMENT' AND pending_claim_by IS NOT NULL` would be the
 * right shape, but it has to reference the `'SUPPORTING_DOCUMENT'` enum value
 * that migration 0023 added — and Kysely's migrator runs every migration
 * inside a single outer Postgres transaction (the Postgres adapter advertises
 * transactional DDL). Postgres refuses to evaluate a partial-index predicate
 * against a new enum value in the same transaction that added it. Adding the
 * partial index in a follow-up migration (after the outer tx has committed)
 * is the correct fix; tracked as a follow-up. For now, the daily sweep reads
 * the relevant rows with a WHERE filter at runtime, which is fine at this
 * scale (`stored_files` has tens of rows in production today).
 *
 * ON DELETE SET NULL on the user FK is intentional: the user can be deleted
 * while the orphan is still unclaimed, and the file row must stay (insert-only
 * per DECISIONS.md 2026-07-30); nulling the FK makes the row a candidate for
 * the next sweep, which then deletes the row and the bytes.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE stored_files
      ADD COLUMN pending_claim_by uuid
      REFERENCES users(id) ON DELETE SET NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE stored_files DROP COLUMN IF EXISTS pending_claim_by
  `.execute(db);
}
