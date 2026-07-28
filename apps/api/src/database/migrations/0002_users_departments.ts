import { sql, type Kysely } from 'kysely';

/**
 * Departments, users, and the additive role assignment.
 *
 * Roles live in their own table rather than an array column so that "every user who is an
 * APPROVER" is an index scan, and so granting a role is an INSERT that cannot race with
 * another admin's grant and lose it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE user_role AS ENUM ('GENERAL', 'APPROVER', 'INVENTORY_MANAGER', 'ADMIN')
  `.execute(db);

  await db.schema
    .createTable('departments')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('departments_name_not_blank', sql`length(btrim(name)) > 0`)
    .execute();

  // Case-insensitive uniqueness: "Accounts" and "accounts" are the same department.
  await sql`
    CREATE UNIQUE INDEX departments_name_lower_key ON departments (lower(btrim(name)))
  `.execute(db);

  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('full_name', 'text', (col) => col.notNull())
    .addColumn('designation', 'text', (col) => col.notNull())
    .addColumn('department_id', 'uuid', (col) =>
      // A department must be emptied before it can be deleted; losing a user's department
      // silently would corrupt the BOM footprint block.
      col.references('departments.id').onDelete('restrict'),
    )
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('must_change_password', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Designation prints on the BOM, so an empty one is not a valid user (plan 0.5).
    .addCheckConstraint('users_designation_not_blank', sql`length(btrim(designation)) > 0`)
    .addCheckConstraint('users_full_name_not_blank', sql`length(btrim(full_name)) > 0`)
    .addCheckConstraint('users_email_shape', sql`email = lower(email) AND position('@' in email) > 1`)
    .execute();

  await sql`CREATE UNIQUE INDEX users_email_key ON users (email)`.execute(db);
  await sql`CREATE INDEX users_department_id_idx ON users (department_id)`.execute(db);

  await sql`
    CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);

  await sql`
    CREATE TRIGGER departments_set_updated_at
    BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);

  await db.schema
    .createTable('user_roles')
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('role', sql`user_role`, (col) => col.notNull())
    .addColumn('granted_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('user_roles_pkey', ['user_id', 'role'])
    .execute();

  // "Who are the approvers?" runs on every requisition submit.
  await sql`CREATE INDEX user_roles_role_idx ON user_roles (role, user_id)`.execute(db);

  // Deferred from 0001 — `users` only exists now.
  await sql`
    ALTER TABLE app_settings
    ADD CONSTRAINT app_settings_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_updated_by_fkey`.execute(
    db,
  );
  await db.schema.dropTable('user_roles').ifExists().execute();
  await db.schema.dropTable('users').ifExists().execute();
  await db.schema.dropTable('departments').ifExists().execute();
  await sql`DROP TYPE IF EXISTS user_role`.execute(db);
}
