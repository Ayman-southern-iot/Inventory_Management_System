import type { NotificationSeverity, NotificationType } from '@ims/shared';

/**
 * Every word the notification system shows a user, in one file.
 *
 * `rules/10-no-hardcoding.md` puts user-facing copy in `apps/web/src/i18n/en.ts` so that wording
 * changes are one file. Notification copy cannot live there: the title is rendered when the event
 * happens and stored on the row, so the record keeps saying what the user was actually told even
 * after the requisition is renamed or the approver is deactivated. This file is the server-side
 * half of that rule — one file, all wording, no literals scattered through the domain services.
 *
 * The severity lives here too, next to the sentence, because the two are the same editorial
 * decision: if the copy says "needs your approval", the severity is `action_required`.
 */

export interface NotificationTemplate {
  severity: NotificationSeverity;
  /** `ref` is the human reference — REQ-000123, BRW-000045, a BOM number, a product name. */
  title: (ref: string, actorName?: string | null) => string;
  body?: (context: NotificationCopyContext) => string | null;
}

export interface NotificationCopyContext {
  ref: string;
  actorName?: string | null;
  note?: string | null;
  amount?: string | null;
  dueDate?: string | null;
  quantity?: number | null;
}

const by = (actorName?: string | null): string => (actorName ? ` by ${actorName}` : '');

export const NOTIFICATION_COPY: Record<NotificationType, NotificationTemplate> = {
  /* ------------------------------------------------- requisitions: requester */
  'requisition.submitted': {
    severity: 'info',
    title: (ref) => `Requisition ${ref} submitted for approval`,
  },
  'requisition.im_approved': {
    severity: 'info',
    title: (ref, actor) => `Requisition ${ref} cleared inventory review${by(actor)}`,
  },
  'requisition.approved': {
    severity: 'success',
    title: (ref) => `Requisition ${ref} is fully approved`,
  },
  'requisition.rejected': {
    severity: 'warning',
    title: (ref, actor) => `Requisition ${ref} was rejected${by(actor)}`,
    body: (c) => (c.note ? `Reason: ${c.note}` : null),
  },
  'requisition.withdrawn': {
    severity: 'warning',
    title: (ref, actor) => `An approval on requisition ${ref} was withdrawn${by(actor)}`,
    body: (c) => (c.note ? `Reason: ${c.note}` : null),
  },
  'requisition.cancelled': {
    severity: 'info',
    title: (ref, actor) => `Requisition ${ref} was cancelled${by(actor)}`,
  },

  /* ------------------------------------------------- requisitions: approver */
  'requisition.awaiting_your_approval': {
    severity: 'action_required',
    title: (ref) => `Requisition ${ref} needs your approval`,
    body: (c) => (c.amount ? `Requested amount: ${c.amount}` : null),
  },
  'requisition.approval_reminder': {
    severity: 'action_required',
    title: (ref) => `Reminder: requisition ${ref} is still waiting on you`,
  },

  /* --------------------------------------------- requisitions: the money half */
  'requisition.sent_to_accounts': {
    severity: 'info',
    title: (ref) => `Requisition ${ref} has gone to Accounts`,
  },
  'requisition.funds_received': {
    severity: 'success',
    title: (ref) => `Funds for requisition ${ref} have been received in full`,
    body: (c) => (c.amount ? `Total received: ${c.amount}` : null),
  },
  'requisition.purchased': {
    severity: 'success',
    title: (ref) => `The items on requisition ${ref} have been purchased`,
    body: (c) => (c.amount ? `Purchase total: ${c.amount}` : null),
  },
  'requisition.purchase_verified': {
    severity: 'success',
    title: (ref) => `The purchase on requisition ${ref} has been verified`,
    // Only mentioned when something actually went back, so the ordinary case stays quiet.
    body: (c) => (c.amount ? `${c.amount} was returned to Accounts` : null),
  },
  'requisition.stocked': {
    severity: 'success',
    title: (ref) => `Everything on requisition ${ref} is now in stock`,
  },

  /* ------------------------------------------------------------- borrowing */
  'borrowing.requested': {
    severity: 'action_required',
    title: (ref, actor) => `Borrow request ${ref}${by(actor)} needs a decision`,
  },
  'borrowing.approved': {
    severity: 'success',
    title: (ref, actor) => `Borrow request ${ref} was approved${by(actor)}`,
  },
  'borrowing.rejected': {
    severity: 'warning',
    title: (ref, actor) => `Borrow request ${ref} was rejected${by(actor)}`,
    body: (c) => (c.note ? `Reason: ${c.note}` : null),
  },
  'borrowing.reverted': {
    severity: 'warning',
    title: (ref, actor) => `Borrow ${ref} was put back to pending${by(actor)}`,
    body: (c) => (c.note ? `Reason: ${c.note}` : null),
  },
  'borrowing.cancelled': {
    severity: 'info',
    title: (ref, actor) => `Borrow request ${ref} was cancelled${by(actor)}`,
  },
  'borrowing.returned': {
    severity: 'success',
    title: (ref) => `Borrow ${ref} was returned`,
    body: (c) => (c.quantity ? `${c.quantity} unit(s) returned` : null),
  },
  'borrowing.issued_to_you': {
    severity: 'info',
    title: (ref, actor) => `${actor ?? 'The Inventory Manager'} issued ${ref} to you`,
    body: (c) => {
      const parts = [
        c.quantity ? `${c.quantity} unit(s)` : null,
        c.dueDate ? `due back on ${c.dueDate}` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : null;
    },
  },
  'borrowing.due_soon': {
    severity: 'warning',
    title: (ref) => `Borrow ${ref} is due back soon`,
    body: (c) => (c.dueDate ? `Expected back on ${c.dueDate}` : null),
  },
  'borrowing.overdue': {
    severity: 'action_required',
    title: (ref) => `Borrow ${ref} is overdue`,
    body: (c) => (c.dueDate ? `Was due on ${c.dueDate}` : null),
  },

  /* ------------------------------------------------------------------- BOM */
  'bom.generated': {
    severity: 'success',
    title: (ref, actor) => `BOM ${ref} was generated${by(actor)}`,
  },
  'bom.over_budget_bounced': {
    severity: 'action_required',
    title: (ref) => `BOM ${ref} is over budget and went back for approval`,
    body: (c) => (c.amount ? `Total: ${c.amount}` : null),
  },
  'bom.voided': {
    severity: 'warning',
    title: (ref, actor) => `BOM ${ref} was voided${by(actor)}`,
    body: (c) => (c.note ? `Reason: ${c.note}` : null),
  },

  /* ----------------------------------------------------------------- stock */
  'stock.low': {
    severity: 'warning',
    title: (ref) => `${ref} is running low`,
    body: (c) => (c.quantity === null || c.quantity === undefined ? null : `${c.quantity} left`),
  },

  /* --------------------------------------------------------------- system */
  'system.check_failed': {
    severity: 'action_required',
    title: (ref) => `System check failed: ${ref}`,
    body: (c) => c.note ?? null,
  },

  /* ------------------------------------------------------------ delegation */
  'delegation.granted': {
    severity: 'info',
    title: (_ref, actor) => `${actor ?? 'An approver'} delegated their approvals to you`,
  },
  'delegation.revoked': {
    severity: 'info',
    title: (_ref, actor) => `${actor ?? 'An approver'} ended your approval delegation`,
  },

  /* --------------------------------------------------------------- account */
  'account.password_reset': {
    severity: 'warning',
    title: (_ref, actor) => `Your password was reset${by(actor)}`,
  },
  'account.roles_changed': {
    severity: 'info',
    title: (_ref, actor) => `Your roles were changed${by(actor)}`,
  },
};
