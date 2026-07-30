import { Inject, Injectable } from '@nestjs/common';
import type { Selectable, Transaction } from 'kysely';
import type {
  ListNotificationsQuery,
  Notification,
  NotificationSeverity,
  NotificationType,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database, NotificationsTable } from '../../database/schema';

export type Tx = Transaction<Database>;
export type NotificationRow = Selectable<NotificationsTable>;

/** One recipient's copy of one event. `NotificationsService` builds these; nothing else should. */
export interface NotificationInsert {
  user_id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_ref: string | null;
  actor_id: string | null;
  actor_name: string | null;
}

export interface NotificationPage {
  items: NotificationRow[];
  page: number;
  limit: number;
  total: number;
}

export function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    link: row.link,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityRef: row.entity_ref,
    actorName: row.actor_name,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Bulk insert, because one event routinely notifies several people (both approvers on a
   * submitted requisition). One statement rather than a loop keeps the fan-out off the round-trip
   * budget of whatever transaction the caller is holding open.
   */
  async insertMany(tx: Tx | undefined, rows: NotificationInsert[]): Promise<number> {
    if (rows.length === 0) return 0;
    const writer = tx ?? this.db;
    const result = await writer.insertInto('notifications').values(rows).executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0n);
  }

  async list(userId: string, query: ListNotificationsQuery): Promise<NotificationPage> {
    const offset = (query.page - 1) * query.limit;

    const base = this.db
      .selectFrom('notifications')
      .where('user_id', '=', userId)
      .$if(query.unreadOnly === true, (qb) => qb.where('read_at', 'is', null));

    const [rows, counted] = await Promise.all([
      base
        .selectAll()
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(query.limit)
        .offset(offset)
        .execute(),
      base.select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst(),
    ]);

    return {
      items: rows,
      page: query.page,
      limit: query.limit,
      total: Number(counted?.count ?? 0),
    };
  }

  /** The badge. Partial index `notifications_unread_idx` serves this exactly. */
  async countUnread(userId: string): Promise<number> {
    const row = await this.db
      .selectFrom('notifications')
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /**
   * Always scoped to `userId`. The id list comes from the client, so without that predicate a
   * user could mark someone else's notifications read by guessing ids.
   */
  async markRead(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('user_id', '=', userId)
      .where('id', 'in', ids)
      // Keep the original timestamp if it was already read — re-marking is not a new event.
      .where('read_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  /** Retention: read notifications older than the cutoff. Unread ones are never swept. */
  async deleteReadOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('notifications')
      .where('read_at', 'is not', null)
      .where('created_at', '<', cutoff)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0n);
  }
}
