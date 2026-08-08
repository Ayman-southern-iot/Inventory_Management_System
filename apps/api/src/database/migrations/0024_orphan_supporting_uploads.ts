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
 * Index: a partial index on `created_at` filtered to `kind = 'SUPPORTING_DOCUMENT'
 * AND pending_claim_by IS NOT NULL` so the daily sweep is O(orphan count) rather
 * than O(all stored_files). The index excludes every claimed file, every
 * non-supporting-doc file, and every row older than the first orphan — i.e. it
 * stays small even as the table grows.
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

  await sql`
    CREATE INDEX stored_files_pending_claim_idx
      ON stored_files (created_at)
      WHERE kind = 'SUPPORTING_DOCUMENT' AND pending_claim_by IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS stored_files_pending_claim_idx`.execute(db);
  await sql`
    ALTER TABLE stored_files DROP COLUMN IF EXISTS pending_claim_by
  `.execute(db);
}
