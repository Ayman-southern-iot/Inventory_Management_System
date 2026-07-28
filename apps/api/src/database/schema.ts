import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { Role } from '@ims/shared';

/**
 * Hand-maintained mirror of the migrated schema. It is not generated, because a generator
 * would happily follow the database into whatever shape a bad migration left it in — this
 * file is a second pair of eyes that has to be updated deliberately alongside the migration.
 */

/**
 * `created_at` is written by the database default and must never be updated afterwards —
 * `never` on the update side makes "backdate this row" a compile error rather than a review
 * comment (rules/00: make illegal states unrepresentable).
 */
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
/** Maintained by the `set_updated_at` trigger; the application does not set it. */
type UpdatedAt = ColumnType<Date, Date | string | undefined, Date | string | undefined>;
/** An ordinary timestamptz the application does write. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface AppSettingsTable {
  key: string;
  value: ColumnType<unknown, string, string>;
  updated_by: string | null;
  updated_at: UpdatedAt;
}

export interface DepartmentsTable {
  id: Generated<string>;
  name: string;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  full_name: string;
  /** Prints on the BOM footprint block — see docs/reference/09-bom.md. */
  designation: string;
  department_id: string | null;
  is_active: Generated<boolean>;
  must_change_password: Generated<boolean>;
  last_login_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

/** Roles are additive: one row per role a user holds. */
export interface UserRolesTable {
  user_id: string;
  role: Role;
  granted_at: CreatedAt;
}

/**
 * Why a refresh token stopped being valid. `ROTATED` is the normal path; `REUSE_DETECTED`
 * means the family was killed after a replay; `ADMIN_REVOKED` is a deactivation or password
 * reset. The distinction decides what the user is told on their next refresh.
 */
export const RefreshRevocationReason = {
  ROTATED: 'ROTATED',
  REUSE_DETECTED: 'REUSE_DETECTED',
  ADMIN_REVOKED: 'ADMIN_REVOKED',
  LOGOUT: 'LOGOUT',
  /** Backfilled onto rows revoked before the reason was recorded. Never written by new code. */
  UNKNOWN: 'UNKNOWN',
} as const;

export type RefreshRevocationReason =
  (typeof RefreshRevocationReason)[keyof typeof RefreshRevocationReason];

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  /** SHA-256 of the token. A database leak must not yield usable refresh tokens. */
  token_hash: string;
  /** All descendants of one login. Reuse of any member revokes the whole family. */
  family_id: string;
  expires_at: Timestamp;
  revoked_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  revoked_reason: ColumnType<
    RefreshRevocationReason | null,
    RefreshRevocationReason | null | undefined,
    RefreshRevocationReason | null
  >;
  replaced_by_id: string | null;
  user_agent: string | null;
  created_at: CreatedAt;
}

export interface LoginAttemptsTable {
  id: Generated<string>;
  email: string;
  ip: string;
  succeeded: boolean;
  created_at: CreatedAt;
}

/**
 * OPEN QUESTION: OQ-02 — `department_id IS NULL` is the company-wide default slot;
 * a row with a department overrides it for that department only.
 */
export interface ApproverSlotsTable {
  id: Generated<string>;
  department_id: string | null;
  slot_no: number;
  user_id: string | null;
  updated_by: string | null;
  updated_at: UpdatedAt;
}

export interface Database {
  app_settings: AppSettingsTable;
  departments: DepartmentsTable;
  users: UsersTable;
  user_roles: UserRolesTable;
  refresh_tokens: RefreshTokensTable;
  login_attempts: LoginAttemptsTable;
  approver_slots: ApproverSlotsTable;
}

export type UserRow = Selectable<UsersTable>;
export type NewUserRow = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type DepartmentRow = Selectable<DepartmentsTable>;
export type RefreshTokenRow = Selectable<RefreshTokensTable>;
export type ApproverSlotRow = Selectable<ApproverSlotsTable>;
