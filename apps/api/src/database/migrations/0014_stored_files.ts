import { sql, type Kysely } from 'kysely';

/**
 * Phase 05 task 5.1 — the one registry of uploaded files.
 *
 * Signatures (5.2) and invoices (5.5) both need somewhere to put bytes. They get one table rather
 * than a path column on each owning row, because provenance ("who uploaded this, when, how big,
 * what did they call it") is identical for both and would otherwise be duplicated and drift.
 *
 * Two properties this table is designed around:
 *
 *  1. **`relative_path` is server-generated and unique.** The client's filename is kept in
 *     `original_name` for display only and never touches the filesystem. A path is a UUID plus a
 *     validated extension, so a caller cannot influence where bytes land.
 *
 *  2. **Rows are never mutated in place.** Replacing a signature inserts a new row and repoints
 *     the owner; the old row and its file stay. A BOM printed in July must keep rendering the
 *     signature that was actually used on it, and overwriting the file would silently rewrite a
 *     signed document. The table is not trigger-protected like `audit_log` — deletion is a
 *     legitimate admin cleanup — but nothing in the application updates a row.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE stored_file_kind AS ENUM ('SIGNATURE', 'INVOICE')`.execute(db);

  await db.schema
    .createTable('stored_files')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('kind', sql`stored_file_kind`, (col) => col.notNull())
    /** Relative to FILE_STORAGE_DIR. Unique so two rows can never claim the same bytes. */
    .addColumn('relative_path', 'text', (col) => col.notNull().unique())
    /** What the uploader called it. Display only — never used to build a path. */
    .addColumn('original_name', 'text', (col) => col.notNull())
    .addColumn('mime_type', 'text', (col) => col.notNull())
    .addColumn('size_bytes', 'integer', (col) => col.notNull())
    // RESTRICT: the uploader is part of the provenance. A user who has uploaded an invoice
    // cannot be hard-deleted without someone deciding what happens to the evidence.
    .addColumn('uploaded_by', 'uuid', (col) => col.notNull().references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('stored_files_size_positive', sql`size_bytes > 0`)
    .addCheckConstraint('stored_files_path_not_blank', sql`length(btrim(relative_path)) > 0`)
    .execute();

  await sql`
    CREATE INDEX stored_files_uploader_idx ON stored_files (uploaded_by, created_at DESC)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('stored_files').ifExists().execute();
  await sql`DROP TYPE IF EXISTS stored_file_kind`.execute(db);
}
