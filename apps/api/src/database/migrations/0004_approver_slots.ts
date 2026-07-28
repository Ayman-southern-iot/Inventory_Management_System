import { sql, type Kysely } from 'kysely';

/**
 * OPEN QUESTION: OQ-02 — whether Approver 1 and Approver 2 are fixed company-wide or set per
 * department is undecided. This models the working assumption (global default, per-department
 * override) as the *smallest* structure that satisfies either answer: if the answer turns out
 * to be "company-wide only", the department rows are simply never created.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('approver_slots')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // NULL = the company-wide default slot.
    .addColumn('department_id', 'uuid', (col) =>
      col.references('departments.id').onDelete('cascade'),
    )
    .addColumn('slot_no', 'smallint', (col) => col.notNull())
    // NULL = the slot exists but nobody is assigned yet; submitting a requisition that needs
    // it will fail loudly rather than silently skipping an approval.
    .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('updated_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('approver_slots_slot_no_range', sql`slot_no IN (1, 2)`)
    .execute();

  // Two partial indexes rather than one: in Postgres, NULL never equals NULL, so a plain
  // UNIQUE (department_id, slot_no) would allow unlimited duplicate global rows.
  await sql`
    CREATE UNIQUE INDEX approver_slots_global_key
    ON approver_slots (slot_no) WHERE department_id IS NULL
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX approver_slots_department_key
    ON approver_slots (department_id, slot_no) WHERE department_id IS NOT NULL
  `.execute(db);

  await sql`
    CREATE TRIGGER approver_slots_set_updated_at
    BEFORE UPDATE ON approver_slots
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('approver_slots').ifExists().execute();
}
