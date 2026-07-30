import { z } from 'zod';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT, paginationQuerySchema, uuidSchema } from './common.js';

/**
 * Phase 06 — per-user in-app notifications.
 *
 * Distinct from the audit log, and the difference matters. The audit log answers "who did what"
 * for an admin reading history; a notification answers "something needs *your* attention now"
 * for one specific person. One action produces exactly one audit row and zero-to-many
 * notifications — a submitted requisition notifies whoever has to approve it, not the person who
 * submitted it.
 *
 * Delivery is in-app only. OQ-10 recorded that there is no SMTP relay, and `DECISIONS.md` rules
 * out Redis and a websocket at this scale, so the client polls. That is why `unreadCount` is its
 * own tiny endpoint rather than a field on the list: the badge polls constantly, the list does
 * not.
 */

/* ------------------------------------------------------------------ types */

/**
 * What happened. The type drives the icon and the copy in the UI, so adding one is a contract
 * change plus an i18n entry — deliberately, so a notification can never render as a raw enum.
 */
export const NOTIFICATION_TYPES = [
  // Requisitions — the requester's side
  'requisition.submitted',
  'requisition.im_approved',
  'requisition.approved',
  'requisition.rejected',
  'requisition.withdrawn',
  'requisition.cancelled',
  // Requisitions — the approver's side
  'requisition.awaiting_your_approval',
  'requisition.approval_reminder',
  // Requisitions — the money half (task 5.4), all addressed to the requester
  'requisition.sent_to_accounts',
  'requisition.funds_received',
  'requisition.purchased',
  'requisition.purchase_verified',
  // Borrowing
  'borrowing.requested',
  'borrowing.approved',
  'borrowing.rejected',
  'borrowing.reverted',
  'borrowing.cancelled',
  'borrowing.returned',
  'borrowing.due_soon',
  'borrowing.overdue',
  // BOM
  'bom.generated',
  'bom.over_budget_bounced',
  'bom.voided',
  // Stock / inventory
  'stock.low',
  // Delegation
  'delegation.granted',
  'delegation.revoked',
  // Account
  'account.password_reset',
  'account.roles_changed',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const notificationTypeSchema = z.enum(
  NOTIFICATION_TYPES as readonly [NotificationType, ...NotificationType[]],
);

/**
 * How loudly to present it. `action_required` is the only one that should ever drive a
 * persistent visual — an approver with three of these has three things blocking other people.
 */
export const NOTIFICATION_SEVERITIES = ['info', 'success', 'warning', 'action_required'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
export const notificationSeveritySchema = z.enum(
  NOTIFICATION_SEVERITIES as readonly [NotificationSeverity, ...NotificationSeverity[]],
);

/* ----------------------------------------------------------------- entry */

export const notificationSchema = z.object({
  id: uuidSchema,
  type: notificationTypeSchema,
  severity: notificationSeveritySchema,
  /** Already-rendered one-line summary. The server owns the wording so history stays stable. */
  title: z.string(),
  body: z.string().nullable(),
  /**
   * Where clicking it should go, as an app-relative path (`/requisitions/<id>`). Server-built so
   * the client never has to know which route owns which entity.
   */
  link: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  /** Human reference — REQ-000123, BRW-000045, a BOM number. */
  entityRef: z.string().nullable(),
  /** Who caused it, for "Rana approved your requisition". Null for system-generated ones. */
  actorName: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

/* ----------------------------------------------------------------- query */

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  /** Narrow to the unread ones — what the dropdown opens with. */
  unreadOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/**
 * The badge payload. Deliberately one integer and nothing else — it is polled by every signed-in
 * client on a short interval, so it must stay the cheapest query in the system.
 */
export const unreadCountSchema = z.object({
  unread: z.number().int().nonnegative(),
});
export type UnreadCount = z.infer<typeof unreadCountSchema>;

/** Mark specific notifications read. An empty list is rejected — say what you mean. */
export const markNotificationsReadSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(PAGINATION_MAX_LIMIT),
});
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;
