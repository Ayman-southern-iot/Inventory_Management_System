import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { AUDIT_ACTIONS, Role, SettingKey, type LoginResponse } from '@ims/shared';
import type { Db } from '../src/database/create-db';
import { PasswordService } from '../src/security/password.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { TEST_ENV, TEST_PASSWORD } from './config/test-env';
import type { HttpClient, TestApp } from './app';

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
 * `app_settings` is the one table that is NOT reset here beyond `updated_by`: the running
 * app caches settings and `resetData` only has the `Db`, so it cannot invalidate that cache.
 * A spec that mutates a setting must put it back itself — see `restoreSeededSettings`.
 */
export async function resetData(db: Db): Promise<void> {
  // Phase 06: the append-only trigger on audit_log blocks UPDATE, which means a SET NULL
  // ON DELETE foreign-key cascade would fail. The reset path temporarily disables the
  // trigger in the isolated test database only — production code never touches the trigger.
  // This is the documented escape hatch in the Phase 06 plan.
  await sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update`.execute(db);
  try {
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
  // Same reasoning as the `users`/`departments` guards below: `requisitions.project_id` is
  // ON DELETE RESTRICT and requisitions outlive this reset, so a project still charged by a
  // surviving requisition must be skipped rather than deleted, or every later spec's
  // `beforeEach` throws on this delete for the rest of the run.
  await db
    .deleteFrom('projects')
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('requisitions')
            .select('requisitions.id')
            .whereRef('requisitions.project_id', '=', 'projects.id'),
        ),
      ),
    )
    .execute();
  await db.deleteFrom('idempotency_keys').execute();
  // Phase 06: `audit_log.actor_id` is ON DELETE RESTRICT and the trigger is currently disabled
  // for the duration of this reset, so we can clean every audit row the previous test wrote.
  // Production code never sees the trigger disabled — only this reset path.
  await db.deleteFrom('audit_log').execute();

  /**
   * Phase 05: `stored_files.uploaded_by` is ON DELETE RESTRICT, so an uploaded signature blocks
   * the user delete below, and `requisition_approvals.signature_file_id` is RESTRICT too — and
   * requisitions deliberately survive this reset (their events are append-only), so those rows
   * are still holding references.
   *
   * Both pointers are cleared here rather than the constraints being loosened: in production
   * neither is ever nulled, which is precisely the guarantee that a printed BOM keeps rendering
   * the signature it was signed with. This is reset-only surgery, like the audit trigger above.
   */
  // Both columns together — `requisition_approvals_signature_consistent` refuses a row that
  // claims it was signed but names no file, and clearing only the pointer would trip it.
  await db
    .updateTable('requisition_approvals')
    .set({ signature_file_id: null, signed_with_signature: false })
    .execute();
  await db.updateTable('users').set({ signature_file_id: null }).execute();
  // `requisitions.supporting_document_file_id` is ON DELETE RESTRICT, so a surviving
  // requisition with a doc attached would block the `stored_files` delete below. Clear the
  // pointer first, exactly the same surgery the signature reset does above.
  await db.updateTable('requisitions').set({ supporting_document_file_id: null }).execute();
  await db.deleteFrom('stored_files').execute();

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
  } finally {
    // Re-enable the trigger so the rest of the suite still proves the append-only guarantee.
    await sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update`.execute(db);
  }
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

/**
 * Phase 05: seeds the admin-designated sub-threshold approver setting through the live
 * `SettingsService`, so the cache matches the row. Every test that exercises sub-threshold
 * submission calls this in `beforeEach`; tests that specifically want the "unassigned" path
 * should reset it back to `null` themselves.
 */
/**
 * Everything a requisition needs in order to leave DRAFT: a company-wide slot-1 approver for
 * the at-or-above path, and the sub-threshold approver for the below path.
 *
 * These are two unrelated settings and a spec that seeds only one gets a submit that 409s with
 * `APPROVER_SLOT_UNASSIGNED` or `SUBTHRESHOLD_APPROVER_UNASSIGNED`. The requisition then stays
 * DRAFT, and any assertion about a submitted requisition's state passes or fails for a reason
 * that has nothing to do with what is under test — which is exactly how the D-014 clock spec
 * first came out green. If a spec submits anything, call this rather than the two by hand.
 */
export async function seedApprovalChain(ctx: TestApp, approverId: string): Promise<void> {
  await ctx.db
    .insertInto('approver_slots')
    .values({ department_id: null, slot_no: 1, user_id: approverId })
    .execute();
  await seedSubthresholdApprover(ctx, approverId);
}

/**
 * Puts the seeded business settings back.
 *
 * `app_settings` is the only state that survives between spec files: `resetData` clears rows
 * from every other table but can only null `updated_by` here, because it holds a `Db` and
 * cache invalidation needs the running `SettingsService`. So a spec that changes a setting
 * leaks it into every spec that boots afterwards, and the damage lands somewhere else entirely.
 *
 * That is not hypothetical. `audit.int-spec` dropped EXPENSE_THRESHOLD_BDT to 9,999 and never
 * restored it; `reports.int-spec` then submitted above the threshold, needed two approvers,
 * 409'd on unassigned slots and read `.approvals` off an error body. Three failures, blamed on
 * a different file for months, and present or absent depending on how the runner happened to
 * schedule the two — which made the whole baseline a function of timing.
 *
 * Call this in `afterAll` from any spec that writes a setting. It goes through
 * `SettingsService` rather than raw SQL precisely so the cache is invalidated with the row.
 */
export async function restoreSeededSettings(ctx: TestApp): Promise<void> {
  const settings = ctx.app.get(SettingsService);
  const context = {
    actorId: null,
    actorName: null,
    actorEmail: null,
    actorRoles: [],
    requestMethod: 'TEST',
    requestPath: 'test://factories/restoreSeededSettings',
    requestIp: null,
    userAgent: 'factories.test.ts',
  };

  await settings.set(
    SettingKey.EXPENSE_THRESHOLD_BDT,
    Number(TEST_ENV.SETTING_EXPENSE_THRESHOLD_BDT),
    context,
  );
  await settings.set(
    SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD,
    Number(TEST_ENV.SETTING_APPROVER_SLOTS_BELOW_THRESHOLD),
    context,
  );
  await settings.set(
    SettingKey.APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD,
    Number(TEST_ENV.SETTING_APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD),
    context,
  );
  await settings.set(SettingKey.AUDIT_ENABLED_ACTIONS, [...AUDIT_ACTIONS], context);
}

export async function seedSubthresholdApprover(ctx: TestApp, approverId: string): Promise<void> {
  const settings = ctx.app.get(SettingsService);
  await settings.set(SettingKey.SUBTHRESHOLD_APPROVER_USER_ID, approverId, {
    actorId: approverId,
    actorName: null,
    actorEmail: null,
    actorRoles: [],
    requestMethod: 'TEST',
    requestPath: 'test://factories/seedSubthresholdApprover',
    requestIp: null,
    userAgent: 'factories.test.ts',
  });
}
