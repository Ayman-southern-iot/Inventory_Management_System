import { z } from 'zod';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  paginationQuerySchema,
  uuidSchema,
} from './common.js';
import { roleSchema } from '../enums/role.js';

/**
 * Phase 06 — single, immutable, admin-readable history of every state-changing action in
 * the system. Domain-specific append-only tables (`requisition_events`, `stock_ledger`,
 * `borrow_returns`, `login_attempts`) remain authoritative for their workflows; this audit
 * log is the unified administrative feed.
 *
 * Vocabulary lives in code, not in free-form strings, so the API cannot store an action
 * the admin panel has never heard of. Adding an action here is one file change and a UI
 * translation; doing the same at the controller level is a silent drop.
 */

/* ------------------------------------------------------------------ enums */

/**
 * Every state-changing action the system knows how to record. Each value is a dotted path
 * so the admin filter can group by prefix (`user.*`, `requisition.*`, ...).
 */
export const AUDIT_ACTIONS = [
  // Auth / session
  'auth.login.success',
  'auth.login.failure',
  'auth.refresh.success',
  'auth.refresh.failure',
  'auth.logout',
  'auth.password.change',
  'session.revoke',
  'session.revoke.all_for_user',
  // Users
  'user.create',
  'user.update',
  'user.set_active',
  'user.reset_password',
  // Departments
  'department.create',
  'department.update',
  // Settings
  'settings.update',
  'approver_slot.assign',
  'approver_slot.clear',
  // Catalogue
  'category.create',
  'category.update',
  'category.set_active',
  'product.create',
  'product.update',
  'product.set_active',
  'zone.create',
  'zone.update',
  'zone.set_active',
  'compartment.create',
  'compartment.update',
  'compartment.set_active',
  // Projects
  'project.create',
  'project.update',
  // Stock
  'stock.receive',
  'stock.move',
  'stock.adjust',
  // Borrowing
  'borrowing.create',
  'borrowing.approve',
  'borrowing.reject',
  'borrowing.revert',
  'borrowing.cancel',
  'borrowing.return',
  // Requisitions
  'requisition.create',
  'requisition.update',
  'requisition.submit',
  /**
   * Approve and reject are separate actions rather than one `requisition.decide` carrying the
   * outcome in `metadata`. The admin filter is "approved approvals / rejected approvals", and
   * a filter on `action` uses `audit_log_action_idx`; a filter on a jsonb field inside
   * `metadata` cannot.
   */
  'requisition.approve',
  'requisition.reject',
  'requisition.withdraw',
  'requisition.cancel',
  // Delegations
  'delegation.create',
  'delegation.revoke',
  // BOMs
  'bom.generate',
  'bom.over_budget_bounce',
  'bom.render',
  'bom.void',
  // System
  'system.reminder_run',
  /**
   * Recorded by the retention job when it removes expired rows. Always enabled and never
   * purged away by its own cutoff — deleting audit history without leaving a trace of the
   * deletion would defeat the point of having an audit log.
   */
  'audit.purge',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const auditActionSchema = z.enum(AUDIT_ACTIONS as readonly [AuditAction, ...AuditAction[]]);

export const AUDIT_ENTITY_TYPES = [
  'auth',
  'session',
  'user',
  'department',
  'settings',
  'approver_slot',
  'category',
  'product',
  'zone',
  'compartment',
  'project',
  'stock',
  'borrowing',
  'requisition',
  'delegation',
  'bom',
  'system',
] as const;

/**
 * Actions an admin may **not** switch off.
 *
 * Making the recorded action set configurable is a legitimate noise control, but an audit log
 * whose subject can disable the entries about themselves is not an audit log. These are the
 * ones that describe who got in, who changed what an approval is worth, and who changed the
 * audit configuration itself — precisely the entries someone covering their tracks would turn
 * off first. `SettingsService` rejects any attempt to remove one.
 */
export const AUDIT_ALWAYS_ON_ACTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'auth.password.change',
  'session.revoke',
  'session.revoke.all_for_user',
  'user.create',
  'user.update',
  'user.set_active',
  'user.reset_password',
  'settings.update',
  'approver_slot.assign',
  'approver_slot.clear',
  'audit.purge',
] as const satisfies readonly AuditAction[];

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
export const auditEntityTypeSchema = z.enum(
  AUDIT_ENTITY_TYPES as readonly [AuditEntityType, ...AuditEntityType[]],
);

/* -------------------------------------------------------- decision filter */

/**
 * The admin's third filter: "approved approvals" / "rejected approvals".
 *
 * A decision is an approval outcome wherever it happens — a requisition approval and an IM's
 * borrow approval are the same question to whoever is reading the log. Each option therefore
 * maps to a *set* of actions rather than one, and the repository turns it into a single
 * `action IN (...)` predicate against `audit_log_action_idx`.
 */
export const AUDIT_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type AuditDecision = (typeof AUDIT_DECISIONS)[number];
export const auditDecisionSchema = z.enum(AUDIT_DECISIONS as readonly [AuditDecision, ...AuditDecision[]]);

export const AUDIT_DECISION_ACTIONS: Record<AuditDecision, readonly AuditAction[]> = {
  APPROVED: ['requisition.approve', 'borrowing.approve'],
  REJECTED: ['requisition.reject', 'borrowing.reject'],
};

export const AUDIT_OUTCOMES = ['success', 'failure', 'denied', 'error'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
export const auditOutcomeSchema = z.enum(AUDIT_OUTCOMES as readonly [AuditOutcome, ...AuditOutcome[]]);

/* --------------------------------------------------------------- entry */

/**
 * The shape returned by the audit list endpoint. The `metadata` blob is intentionally typed
 * as `unknown` — each domain supplies its own documented shape, and the admin page renders
 * a generic formatted JSON. The auditor's promise is what is NOT here (no secrets — see the
 * backend sanitiser for the redaction list).
 */
export const auditEntrySchema = z.object({
  id: uuidSchema,
  actorId: uuidSchema.nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().email().nullable(),
  actorRoles: z.array(roleSchema),
  action: auditActionSchema,
  entityType: auditEntityTypeSchema,
  entityId: z.string().nullable(),
  entityRef: z.string().nullable(),
  summary: z.string(),
  metadata: z.unknown(),
  requestMethod: z.string().nullable(),
  requestPath: z.string().nullable(),
  requestIp: z.string().nullable(),
  userAgent: z.string().nullable(),
  outcome: auditOutcomeSchema,
  errorCode: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/* ------------------------------------------------------------ query */

/**
 * Filter / paginate the audit feed. `page`/`limit` inherit the existing pagination defaults
 * so the admin page matches every other list in the product.
 */
/**
 * Filter / paginate the audit feed.
 *
 * Deliberately three filters and no more: **user, date range, and approval decision**. The
 * first cut shipped nine (`action`, `entityId`, `outcome`, `ip`, free-text `search`, ...), and
 * every one of them cost an index — including a GIN index — on a table written on *every*
 * mutation in the system, to serve combinations an admin of a twelve-person tool never reaches
 * for. The date range is one filter with two bounds, not two filters.
 *
 * `page`/`limit` inherit the existing pagination defaults so the admin page matches every
 * other list in the product.
 */
export const listAuditQuerySchema = paginationQuerySchema.extend({
  /**
   * Filter 1 — the user. A user id rather than a name string: the admin page picks from a real
   * user list, so the filter stays exact when two people share a first name, survives a rename
   * (the row keeps its own `actor_name` snapshot for display), and uses `audit_log_actor_idx`.
   */
  actorId: uuidSchema.optional(),
  /** Filter 2 — date range. Inclusive of `from`, exclusive of `to`. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Filter 3 — approved or rejected approvals. See `AUDIT_DECISION_ACTIONS`. */
  decision: auditDecisionSchema.optional(),
  /** A real-world backend exposes `limit` 1..100; the audit feed inherits the same ceiling. */
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;