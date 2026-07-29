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

/* ------------------------------------------------------------------ inventory */

export interface CategoriesTable {
  id: Generated<string>;
  name: string;
  parent_id: string | null;
  /** requirements §11 — untracked categories exist in the catalogue but hold no stock. */
  is_trackable: Generated<boolean>;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ProductsTable {
  id: Generated<string>;
  /** The Storage ID on the shelf label. */
  product_code: string;
  name: string;
  category_id: string;
  unit: Generated<string>;
  /** OQ-08 — the borrow form's default, overridable per line. */
  default_returnable: Generated<boolean>;
  /** OQ-03 answered "no". Dormant so switching it on stays additive. */
  is_serialised: Generated<boolean>;
  description: string | null;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface StorageZonesTable {
  id: Generated<string>;
  name: string;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface StorageCompartmentsTable {
  id: Generated<string>;
  zone_id: string;
  code: string;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

/** Product × compartment × quantity. Written only by StockService. */
export interface StockPlacementsTable {
  id: Generated<string>;
  product_id: string;
  compartment_id: string;
  quantity: Generated<number>;
  reserved_qty: Generated<number>;
  /** Optimistic lock for the IM screen; a stale version is a 409, not a silent overwrite. */
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export const StockMovementType = {
  RECEIPT: 'RECEIPT',
  MOVE: 'MOVE',
  ISSUE: 'ISSUE',
  RETURN: 'RETURN',
  ADJUST: 'ADJUST',
  DISPOSE: 'DISPOSE',
} as const;

export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

/**
 * Append-only, enforced by a trigger. `quantity` is always positive; direction comes from the
 * compartment columns, so a MOVE is net-zero for the product and net-correct per compartment.
 */
export interface StockLedgerTable {
  id: Generated<string>;
  product_id: string;
  from_compartment_id: string | null;
  to_compartment_id: string | null;
  quantity: number;
  movement_type: StockMovementType;
  ref_type: string | null;
  ref_id: string | null;
  performed_by: string | null;
  note: string | null;
  created_at: CreatedAt;
}

/* ------------------------------------------------------------------ borrowing */

export const BorrowStatusValue = {
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
  ISSUED: 'ISSUED',
  PARTIALLY_RETURNED: 'PARTIALLY_RETURNED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const;

export type BorrowStatusValue = (typeof BorrowStatusValue)[keyof typeof BorrowStatusValue];

export interface ProjectsTable {
  id: Generated<string>;
  name: string;
  created_by: string | null;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BorrowRequestsTable {
  id: Generated<string>;
  borrow_no: string;
  requester_id: string;
  product_id: string;
  /** The exact placement the reservation is held against. */
  placement_id: string | null;
  compartment_id: string;
  quantity: number;
  project_id: string | null;
  /** OQ-08 — defaults from the product, overridable per borrow. */
  is_returnable: boolean;
  expected_return_date: ColumnType<Date | string | null, string | null, string | null>;
  purpose: string | null;
  status: Generated<BorrowStatusValue>;
  decided_by: string | null;
  decision_note: string | null;
  decided_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  issued_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  returned_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  /** Running total, so "still out" never needs a sum over borrow_returns. */
  returned_qty: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BorrowReturnsTable {
  id: Generated<string>;
  borrow_request_id: string;
  quantity: number;
  compartment_id: string;
  received_by: string | null;
  condition_note: string | null;
  returned_at: Generated<Date>;
}

/** Makes a mutating endpoint safe to repeat (rules/20-backend.md). */
export interface IdempotencyKeysTable {
  id: Generated<string>;
  key: string;
  user_id: string;
  scope: string;
  response: ColumnType<unknown, string | null, string | null>;
  created_at: CreatedAt;
}

/* --------------------------------------------------------------- requisitions */

/** Money is NUMERIC in Postgres and arrives as a string, so it is never a float in transit. */
type Money = ColumnType<string, string | number | null, string | number | null>;

export interface RequisitionsTable {
  id: Generated<string>;
  requisition_no: string;
  requester_id: string;
  department_id: string | null;
  project_id: string | null;
  urgency: Generated<string>;
  approval_deadline: ColumnType<Date | string | null, string | null, string | null>;
  reason: string | null;
  /** Frozen at submit. Never recomputed, so a later settings change cannot rewrite history. */
  requested_amount: Money | null;
  approved_amount: Money | null;
  required_approver_count: number | null;
  threshold_at_submit: Money | null;
  status: Generated<string>;
  submitted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  decided_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface RequisitionItemsTable {
  id: Generated<string>;
  requisition_id: string;
  product_id: string | null;
  item_name: string;
  quantity: number;
  estimated_unit_price: Money;
  /** GENERATED ALWAYS in the database — never written by the application. */
  estimated_line_total: ColumnType<string, never, never>;
  in_stock_qty_at_submit: number | null;
  note: string | null;
  created_at: CreatedAt;
}

export interface RequisitionApprovalsTable {
  id: Generated<string>;
  requisition_id: string;
  stage: string;
  slot: number;
  assigned_user_id: string;
  /** The delegate, when someone acted on the assignee's behalf. */
  acted_by_user_id: string | null;
  action: Generated<string>;
  note: string | null;
  acted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  /** When this assignee was last nudged about an overdue approval (task 3.9). */
  last_reminded_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: CreatedAt;
}

/** Append-only, enforced by trigger. The live tracker is driven from this, not from `status`. */
export interface RequisitionEventsTable {
  id: Generated<string>;
  requisition_id: string;
  event_type: string;
  actor_id: string | null;
  payload: ColumnType<unknown, string | undefined, never>;
  created_at: CreatedAt;
}

export interface DelegationsTable {
  id: Generated<string>;
  approver_user_id: string;
  delegate_user_id: string;
  starts_at: ColumnType<Date, Date | string, Date | string>;
  ends_at: ColumnType<Date, Date | string, Date | string>;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface Database {
  app_settings: AppSettingsTable;
  requisitions: RequisitionsTable;
  requisition_items: RequisitionItemsTable;
  requisition_approvals: RequisitionApprovalsTable;
  requisition_events: RequisitionEventsTable;
  delegations: DelegationsTable;
  projects: ProjectsTable;
  borrow_requests: BorrowRequestsTable;
  borrow_returns: BorrowReturnsTable;
  idempotency_keys: IdempotencyKeysTable;
  categories: CategoriesTable;
  products: ProductsTable;
  storage_zones: StorageZonesTable;
  storage_compartments: StorageCompartmentsTable;
  stock_placements: StockPlacementsTable;
  stock_ledger: StockLedgerTable;
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
