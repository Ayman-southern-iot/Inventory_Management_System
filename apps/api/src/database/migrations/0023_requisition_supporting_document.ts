import { sql, type Kysely } from 'kysely';

/**
 * Supporting document on a requisition.
 *
 * A requester may attach a single PDF/PNG/JPEG ("quote sheet", "vendor proposal",
 * "spec sheet") so approvers have the supporting evidence in front of them when
 * they decide. The document is **optional** and **only the requester can attach
 * or replace it**, and only while the requisition is in DRAFT — same freeze rule
 * as the amount figures, which `0008_requisitions.ts` established.
 *
 * Schema shape: one nullable FK column on `requisitions`. A join table is the
 * other defensible shape, but the user picked exactly one document and the
 * pattern is the same one used by `purchases.invoice_file_id`. The earlier
 * decision (DECISIONS.md, 2026-07-30, lines 288-291) that rejected a single
 * column for invoices cited a reason that does not apply here — invoices have
 * a known 1-to-many shape (one purchase, multiple vendors).
 *
 * The new value is added to the `stored_file_kind` enum so the existing upload
 * pipeline (`FileStorageService`) can recognise and validate the bytes. Adding
 * an enum value is metadata-only and PG allows it inside the same transaction
 * as the column-add it precedes, so this whole migration is one logical step.
 *
 * Postgres cannot DROP an enum value mid-transaction; the rollback drops the
 * column and leaves the enum value behind. Cleanup is a separate housekeeping
 * migration per playbook §10.5.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TYPE stored_file_kind ADD VALUE 'SUPPORTING_DOCUMENT'`.execute(db);

  await sql`
    ALTER TABLE requisitions
      ADD COLUMN supporting_document_file_id uuid
      REFERENCES stored_files(id) ON DELETE RESTRICT
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE requisitions DROP COLUMN IF EXISTS supporting_document_file_id
  `.execute(db);
  // Note: ALTER TYPE ... DROP VALUE is not supported. Leave the enum value
  // behind — a follow-up housekeeping migration can recreate the type if needed.
}