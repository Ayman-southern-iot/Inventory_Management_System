import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  AuditAction,
  AuditEntityType,
  AuditOutcome,
  NotificationSeverity,
  NotificationType,
  Role,
  StoredFileKind,
} from '@ims/shared';

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
  /** The approver's *current* signature. Approvals snapshot their own copy — see 0015. */
  signature_file_id: ColumnType<string | null, string | null | undefined, string | null>;
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
  /**
   * Whether the approver chose to sign. Distinct from `signature_file_id IS NOT NULL`: approving
   * *without* a signature is a deliberate option, and the BOM prints "Approved" either way.
   */
  signed_with_signature: Generated<boolean>;
  /**
   * Snapshot of the signature used, frozen at approval. Never re-read from the user's current
   * signature — otherwise replacing your signature would rewrite every document you ever signed.
   */
  signature_file_id: ColumnType<string | null, string | null | undefined, string | null>;
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

/* --------------------------------------------------------------------- audit */

/**
 * Phase 06 — global audit feed. Append-only by trigger, so the application never has the
 * authority to UPDATE or DELETE a row. The actor snapshot columns exist so an admin can still
 * read who did what after a user is renamed, deactivated, or removed.
 *
 * `metadata` is typed as `unknown` at the row layer because each domain supplies its own
 * documented shape; the admin page renders a generic JSON viewer.
 */
export interface AuditLogTable {
  id: Generated<string>;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_roles: ColumnType<Role[], Role[], Role[]>;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  entity_ref: string | null;
  summary: string;
  /**
   * Insert/update is `string` (caller must `JSON.stringify`) so Kysely treats it as a jsonb
   * literal and casts appropriately — passing an `unknown` would let a raw string slip through
   * to the database and trigger "invalid input syntax for type json".
   */
  metadata: ColumnType<unknown, string, never>;
  request_method: string | null;
  request_path: string | null;
  request_ip: string | null;
  user_agent: string | null;
  outcome: AuditOutcome;
  error_code: string | null;
  created_at: CreatedAt;
}

/* -------------------------------------------------------------- stored files */

/** Uploaded bytes — signatures and invoices. Rows are inserted and read, never updated. */
export interface StoredFilesTable {
  id: Generated<string>;
  kind: StoredFileKind;
  /** Server-generated, relative to FILE_STORAGE_DIR. Never derived from client input. */
  relative_path: string;
  /** What the uploader called it. Display only. */
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: CreatedAt;
}

/* -------------------------------------------------------------- notifications */

/**
 * One row per recipient per event. Unlike `audit_log` this table is mutable — `read_at` is the
 * whole point — and a user clearing their own list is a legitimate delete.
 */
export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  /** Rendered at write time so history keeps saying what the user was actually told. */
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_ref: string | null;
  actor_id: string | null;
  actor_name: string | null;
  read_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: CreatedAt;
}

/* ------------------------------------------------------------------------ BOM */

export interface BomsTable {
  id: Generated<string>;
  bom_no: string;
  generated_by: string;
  /** Money is NUMERIC in Postgres and arrives as a string, so it is never a float in transit. */
  subtotal: Money;
  /** Relative path under the files volume; served by signed URL, never listed. */
  pdf_path: string | null;
  pdf_generated_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  is_void: Generated<boolean>;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  over_budget_bounced: Generated<boolean>;
  generated_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BomRequisitionsTable {
  id: Generated<string>;
  bom_id: string;
  requisition_id: string;
  /**
   * The frozen footprints block. Never re-derived from `users` — a BOM printed in July must
   * still show July's names and designations.
   */
  approval_snapshot: ColumnType<unknown, string, string>;
  /** Mirrored from `boms.is_void` by trigger so the one-live-BOM index can be partial. */
  is_void: Generated<boolean>;
  created_at: CreatedAt;
}

export interface BomLinesTable {
  id: Generated<string>;
  bom_id: string;
  requisition_item_id: string;
  product_id: string | null;
  item_name: string;
  quantity: number;
  unit_cost: Money;
  /** GENERATED ALWAYS — never written by the application. */
  total_cost: ColumnType<string, never, never>;
  vendor: string | null;
  purpose: string | null;
  project_id: string | null;
  sort_order: Generated<number>;
  created_at: CreatedAt;
}

export interface Database {
  app_settings: AppSettingsTable;
  audit_log: AuditLogTable;
  notifications: NotificationsTable;
  stored_files: StoredFilesTable;
  boms: BomsTable;
  bom_requisitions: BomRequisitionsTable;
  bom_lines: BomLinesTable;
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
