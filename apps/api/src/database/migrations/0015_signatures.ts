import { sql, type Kysely } from 'kysely';

/**
 * Phase 05 task 5.2 — digital signatures on approvals.
 *
 * Two columns on `requisition_approvals`, and one on `users`, and the distinction between them is
 * the whole design:
 *
 *  - `users.signature_file_id` is the approver's **current** signature. It changes whenever they
 *    upload a new one.
 *  - `requisition_approvals.signature_file_id` is a **snapshot** taken at the instant of approval.
 *    It never changes.
 *
 * Reading the live user row at print time would mean an approver who updates their signature
 * silently alters every document they have ever signed. That is a forged document by accident.
 * The snapshot is the same freeze-for-history rule the BOM approval footprint already follows.
 *
 * `signed_with_signature` is separate from `signature_file_id IS NOT NULL` on purpose: "approved
 * without a signature" is a deliberate choice the operator asked for, and the BOM prints the name
 * and the word "Approved" either way. Encoding that as a null would make an intentional choice
 * indistinguishable from missing data.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('users')
    // SET NULL rather than RESTRICT: deleting a signature file should clear the pointer, not
    // block the cleanup. Historical approvals keep their own snapshot regardless.
    .addColumn('signature_file_id', 'uuid', (col) =>
      col.references('stored_files.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .alterTable('requisition_approvals')
    .addColumn('signed_with_signature', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();

  await db.schema
    .alterTable('requisition_approvals')
    // RESTRICT: this one is evidence. A signature file referenced by a completed approval must
    // not be deletable out from under the document that printed it.
    .addColumn('signature_file_id', 'uuid', (col) =>
      col.references('stored_files.id').onDelete('restrict'),
    )
    .execute();

  // A row claiming it was signed must say what with. Application-level checks are advisory;
  // this one is a guarantee (rules/40).
  await sql`
    ALTER TABLE requisition_approvals
    ADD CONSTRAINT requisition_approvals_signature_consistent
    CHECK (NOT signed_with_signature OR signature_file_id IS NOT NULL)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE requisition_approvals
    DROP CONSTRAINT IF EXISTS requisition_approvals_signature_consistent
  `.execute(db);
  await db.schema.alterTable('requisition_approvals').dropColumn('signature_file_id').execute();
  await db.schema.alterTable('requisition_approvals').dropColumn('signed_with_signature').execute();
  await db.schema.alterTable('users').dropColumn('signature_file_id').execute();
}
