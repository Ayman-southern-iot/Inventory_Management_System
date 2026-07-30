import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ListNotificationsQuery,
  Notification,
  NotificationType,
  Paginated,
  Role,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import {
  NotificationsRepository,
  toNotification,
  type NotificationInsert,
  type Tx,
} from './notifications.repository';
import { NOTIFICATION_COPY, type NotificationCopyContext } from './notifications.copy';

/** Everything a caller supplies to raise one event for one or more people. */
export interface NotifyInput {
  type: NotificationType;
  /** Recipients. Deduplicated, and the actor is dropped — nobody is told about their own action. */
  userIds: readonly string[];
  /** Human reference used by the copy template: REQ-000123, a BOM number, a product name. */
  ref: string;
  /** App-relative route. Built by the caller because only it knows which screen owns the entity. */
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  /** Extra values the copy template may interpolate into the body. */
  context?: Omit<NotificationCopyContext, 'ref' | 'actorName'>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repo: NotificationsRepository,
    @Inject(DB) private readonly db: Db,
  ) {}

  /* ------------------------------------------------------------- writing */

  /**
   * Raise one event for a set of recipients.
   *
   * Pass `tx` — nearly every caller can. A notification written in the same transaction as the
   * mutation that caused it cannot survive a rollback, and cannot go missing after a commit. The
   * alternative (fire-and-forget after commit) drops the approver's only signal whenever the
   * insert loses a race with a restart, and "the approver was never told" is the failure this
   * whole feature exists to prevent.
   *
   * The actor is removed from the recipient list. Being told about the thing you just did is
   * noise, and noise is how a notification badge gets ignored.
   */
  async notify(input: NotifyInput, tx?: Tx): Promise<number> {
    const template = NOTIFICATION_COPY[input.type];
    const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId);
    if (recipients.length === 0) return 0;

    // The access token carries id, email and roles — no display name (see `RequestUser`), so
    // `context.actorName` is null at every controller boundary. Resolving it here rather than at
    // each call site is what makes the copy say "approved by Rana" instead of just "approved",
    // and it costs one query only once we already know there is someone to notify.
    const actorName = input.actorName ?? (await this.resolveActorName(input.actorId, tx));

    const title = template.title(input.ref, actorName);
    const body = template.body?.({ ref: input.ref, actorName, ...input.context }) ?? null;

    const rows: NotificationInsert[] = recipients.map((userId) => ({
      user_id: userId,
      type: input.type,
      severity: template.severity,
      title,
      body,
      link: input.link ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      entity_ref: input.ref,
      actor_id: input.actorId ?? null,
      actor_name: actorName,
    }));

    return this.repo.insertMany(tx, rows);
  }

  /** Null for system-generated events, which legitimately have no actor. */
  private async resolveActorName(actorId: string | null | undefined, tx?: Tx): Promise<string | null> {
    if (!actorId) return null;
    const row = await (tx ?? this.db)
      .selectFrom('users')
      .where('id', '=', actorId)
      .select('full_name')
      .executeTakeFirst();
    return row?.full_name ?? null;
  }

  /**
   * The same thing, for callers with no transaction to join and no way to roll back — a
   * scheduled job, or a step that runs after commit. Logs and swallows: a reminder that failed
   * to be written must not take down the job that was writing it for everyone else.
   */
  async notifyBestEffort(input: NotifyInput): Promise<number> {
    try {
      return await this.notify(input);
    } catch (error) {
      this.logger.error(
        `Notification ${input.type} for ${input.ref} was not written: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  /* -------------------------------------------------- recipient resolution */

  /** Everyone holding a role, active only. A deactivated user has no queue to add to. */
  async usersWithRole(role: Role, tx?: Tx): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .selectFrom('user_roles')
      .innerJoin('users', 'users.id', 'user_roles.user_id')
      .where('user_roles.role', '=', role)
      .where('users.is_active', '=', true)
      .select('users.id')
      .execute();
    return rows.map((row) => row.id);
  }

  /**
   * The people who still owe a decision on this requisition, plus anyone currently standing in
   * for them. A delegate who is not told is a delegation that does nothing.
   */
  async pendingApproversFor(requisitionId: string, tx?: Tx): Promise<string[]> {
    const executor = tx ?? this.db;
    const assigned = await executor
      .selectFrom('requisition_approvals')
      .where('requisition_id', '=', requisitionId)
      .where('action', '=', 'PENDING')
      .select('assigned_user_id')
      .execute();

    const assignees = assigned.map((row) => row.assigned_user_id);
    if (assignees.length === 0) return [];

    const delegates = await executor
      .selectFrom('delegations')
      .where('approver_user_id', 'in', assignees)
      .where('is_active', '=', true)
      .where('starts_at', '<=', new Date())
      .where('ends_at', '>=', new Date())
      .select('delegate_user_id')
      .execute();

    return [...new Set([...assignees, ...delegates.map((row) => row.delegate_user_id)])];
  }

  /* ------------------------------------------------------------- reading */

  async list(userId: string, query: ListNotificationsQuery): Promise<Paginated<Notification>> {
    const page = await this.repo.list(userId, query);
    return {
      items: page.items.map(toNotification),
      page: page.page,
      limit: page.limit,
      total: page.total,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.repo.countUnread(userId);
  }

  async markRead(userId: string, ids: string[]): Promise<number> {
    return this.repo.markRead(userId, ids);
  }

  async markAllRead(userId: string): Promise<number> {
    return this.repo.markAllRead(userId);
  }
}
