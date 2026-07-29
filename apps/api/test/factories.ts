import { randomUUID } from 'node:crypto';
import { Role, type LoginResponse } from '@ims/shared';
import type { Db } from '../src/database/create-db';
import { PasswordService } from '../src/security/password.service';
import { TEST_PASSWORD } from './config/test-env';
import type { HttpClient } from './app';

const passwords = new PasswordService();

/**
 * argon2 at OWASP cost is ~80ms a hash. The shared test password produces the same verifiable
 * hash every time, so hashing it once per worker keeps setup honest and the suite quick.
 */
let sharedHash: Promise<string> | undefined;
function hashOfTestPassword(): Promise<string> {
  sharedHash ??= passwords.hash(TEST_PASSWORD);
  return sharedHash;
}

/** Unique per call, so no two tests can collide on the users_email_key unique index. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@ims.test`.toLowerCase();
}

export function uniqueDepartmentName(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

export interface UserFactoryOptions {
  roles?: readonly Role[];
  email?: string;
  fullName?: string;
  designation?: string;
  departmentId?: string | null;
  isActive?: boolean;
  mustChangePassword?: boolean;
  /** Anything other than the shared password costs a fresh argon2 hash. */
  password?: string;
}

export interface CreatedUser {
  id: string;
  email: string;
  password: string;
  roles: Role[];
}

/**
 * Inserts straight through Kysely rather than through the admin API: a permissions spec must be
 * able to build an INVENTORY_MANAGER without first proving that the endpoint it is about to
 * assert 403 on works.
 */
export async function createUser(db: Db, options: UserFactoryOptions = {}): Promise<CreatedUser> {
  const roles = Array.from(new Set([Role.GENERAL, ...(options.roles ?? [])])).sort() as Role[];
  const email = (options.email ?? uniqueEmail(roles.join('-').toLowerCase())).toLowerCase();
  const password = options.password ?? TEST_PASSWORD;
  const passwordHash =
    password === TEST_PASSWORD ? await hashOfTestPassword() : await passwords.hash(password);

  const id = await db.transaction().execute(async (tx) => {
    const inserted = await tx
      .insertInto('users')
      .values({
        email,
        password_hash: passwordHash,
        full_name: options.fullName ?? `Test ${roles.join(' ')}`,
        designation: options.designation ?? 'Test Designation',
        department_id: options.departmentId ?? null,
        is_active: options.isActive ?? true,
        must_change_password: options.mustChangePassword ?? false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await tx
      .insertInto('user_roles')
      .values(roles.map((role) => ({ user_id: inserted.id, role })))
      .execute();

    return inserted.id;
  });

  return { id, email, password, roles };
}

export async function createDepartment(db: Db, name?: string): Promise<{ id: string; name: string }> {
  const departmentName = name ?? uniqueDepartmentName('Department');
  const row = await db
    .insertInto('departments')
    .values({ name: departmentName })
    .returning(['id'])
    .executeTakeFirstOrThrow();
  return { id: row.id, name: departmentName };
}

/** Logs in over HTTP so the tokens under test are the ones the API actually issues. */
export async function login(
  http: HttpClient,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<LoginResponse> {
  const response = await http.post('/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as LoginResponse;
}

/** Creates a user and returns it together with a live session. */
export async function createUserAndLogin(
  db: Db,
  http: HttpClient,
  options: UserFactoryOptions = {},
): Promise<{ user: CreatedUser; session: LoginResponse; client: HttpClient }> {
  const user = await createUser(db, options);
  const session = await login(http, user.email, user.password);
  return { user, session, client: http.as(session.accessToken) };
}

/**
 * Deletes every row the specs create, in dependency order.
 *
 * Not `TRUNCATE ... CASCADE`: `app_settings.updated_by` references `users`, so CASCADE would
 * silently truncate the settings the running application has already cached and seeded.
 * `app_settings` is owned by boot-time seeding and is therefore reset by value, not by row.
 */
export async function resetData(db: Db): Promise<void> {
  // Borrow rows first: they reference users with ON DELETE RESTRICT. Unlike the ledger these
  // are ordinary history and may be cleared between tests. The ledger rows they produced stay,
  // with a `ref_id` pointing at a request that no longer exists — deliberate, because `ref_id`
  // carries no foreign key precisely so an append-only row can outlive what caused it.
  // `requisition_events` is append-only by trigger, exactly like `stock_ledger`, and deleting
  // a requisition cascades into it — so requisitions are left in place for the same reason
  // stock is. Every spec builds its own users, so previous requisitions are invisible to them.
  await db.deleteFrom('delegations').execute();

  await db.deleteFrom('borrow_returns').execute();
  await db.deleteFrom('borrow_requests').execute();
  await db.deleteFrom('projects').execute();
  await db.deleteFrom('idempotency_keys').execute();

  await db.deleteFrom('approver_slots').execute();
  await db.deleteFrom('user_roles').execute();
  await db.deleteFrom('refresh_tokens').execute();
  await db.deleteFrom('login_attempts').execute();
  await db.updateTable('app_settings').set({ updated_by: null }).execute();

  /**
   * Users who performed a stock movement are deliberately NOT deletable: `stock_ledger` is
   * append-only and `performed_by` is ON DELETE RESTRICT, so "who moved this" keeps resolving
   * forever. That is the real product rule — such a user is deactivated, never deleted — and
   * the reset has to respect it rather than fight it, or every user spec fails as collateral
   * damage the first time a stock spec runs before it.
   */
  await db
    .deleteFrom('users')
    .where((eb) =>
      eb.and([
        eb.not(
          eb.exists(
            eb
              .selectFrom('stock_ledger')
              .select('stock_ledger.id')
              .whereRef('stock_ledger.performed_by', '=', 'users.id'),
          ),
        ),
        // Same reasoning for requisitions: they cannot be deleted, so neither can the people
        // who raised or approved them.
        eb.not(
          eb.exists(
            eb
              .selectFrom('requisitions')
              .select('requisitions.id')
              .whereRef('requisitions.requester_id', '=', 'users.id'),
          ),
        ),
        eb.not(
          eb.exists(
            eb
              .selectFrom('requisition_approvals')
              .select('requisition_approvals.id')
              .whereRef('requisition_approvals.assigned_user_id', '=', 'users.id'),
          ),
        ),
        eb.not(
          eb.exists(
            eb
              .selectFrom('requisition_approvals')
              .select('requisition_approvals.id')
              .whereRef('requisition_approvals.acted_by_user_id', '=', 'users.id'),
          ),
        ),
        eb.not(
          eb.exists(
            eb
              .selectFrom('requisition_events')
              .select('requisition_events.id')
              .whereRef('requisition_events.actor_id', '=', 'users.id'),
          ),
        ),
      ]),
    )
    .execute();

  await db
    .deleteFrom('departments')
    .where((eb) =>
      eb.and([
        eb.not(
          eb.exists(
            eb
              .selectFrom('users')
              .select('users.id')
              .whereRef('users.department_id', '=', 'departments.id'),
          ),
        ),
        eb.not(
          eb.exists(
            eb
              .selectFrom('requisitions')
              .select('requisitions.id')
              .whereRef('requisitions.department_id', '=', 'departments.id'),
          ),
        ),
      ]),
    )
    .execute();
}

export async function countRefreshTokens(
  db: Db,
  userId: string,
  onlyLive: boolean,
): Promise<number> {
  const row = await db
    .selectFrom('refresh_tokens')
    .where('user_id', '=', userId)
    .$if(onlyLive, (qb) => qb.where('revoked_at', 'is', null))
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirst();
  return row?.count ?? 0;
}
