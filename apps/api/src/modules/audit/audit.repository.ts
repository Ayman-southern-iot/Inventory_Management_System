import { Inject, Injectable } from '@nestjs/common';
import { sql, type Selectable, type Transaction } from 'kysely';
import type {
  AuditAction,
  AuditEntityType,
  AuditEntry,
  AuditOutcome,
  ListAuditQuery,
  Role,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { AuditLogTable, Database } from '../../database/schema';

export type Tx = Transaction<Database>;

/** A row from `audit_log` as the database returns it (Generated unwrapped to plain types). */
export type AuditRowRaw = Selectable<AuditLogTable>;

/**
 * The shape of an audit row that the application inserts. It is structurally identical to
 * the database row, with the exception of `metadata` being `unknown` (each domain supplies
 * its own shape) and `actor_roles` accepting the shared `Role` union directly.
 */
export interface AuditInsert {
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_roles: readonly Role[];
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  entity_ref: string | null;
  summary: string;
  metadata: unknown;
  request_method: string | null;
  request_path: string | null;
  request_ip: string | null;
  user_agent: string | null;
  outcome: AuditOutcome;
  error_code: string | null;
}

/** Page metadata for the admin list, identical shape to the rest of the product. */
export interface AuditPage {
  items: AuditRow[];
  page: number;
  limit: number;
  total: number;
}

/**
 * The shape returned by the repository. Mirrors the database row but with `metadata` parsed
 * as a real `unknown` value (kysely's jsonb select returns an `unknown`-typed cell).
 */
export interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_roles: Role[];
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  entity_ref: string | null;
  summary: string;
  metadata: unknown;
  request_method: string | null;
  request_path: string | null;
  request_ip: string | null;
  user_agent: string | null;
  outcome: AuditOutcome;
  error_code: string | null;
  created_at: Date;
}

/**
 * Strip the `Generated<...>` wrappers that the database-side columns are typed with.
 * Selectable does this, but the row we get back from `selectAll()` already has plain types
 * for non-generated columns; only the generated defaults still carry the wrapper. We treat
 * the row as already plain since `selectAll()` resolves those.
 */
type FlattenedAuditRow = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_roles: unknown;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  entity_ref: string | null;
  summary: string;
  metadata: unknown;
  request_method: string | null;
  request_path: string | null;
  request_ip: string | null;
  user_agent: string | null;
  outcome: AuditOutcome;
  error_code: string | null;
  created_at: Date;
};

@Injectable()
export class AuditRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The configured set of recorded actions, read straight from `app_settings`.
   *
   * Deliberately not via `SettingsService`: that service records its own `settings.update`
   * audit row through `AuditService`, so injecting it here would make AuditModule and
   * SettingsModule mutually dependent. A forwardRef would work, but circular DI is exactly the
   * kind of boot-time fragility this codebase has already been bitten by, and this is one
   * single-row read.
   *
   * `null` means "no row, or unreadable" — the caller treats that as record everything, because
   * the safe failure for an audit log is too many rows, never too few.
   */
  async readEnabledActions(): Promise<string[] | null> {
    const row = await this.db
      .selectFrom('app_settings')
      .select('value')
      .where('key', '=', 'AUDIT_ENABLED_ACTIONS')
      .executeTakeFirst();

    if (!row) return null;
    return Array.isArray(row.value) ? (row.value as string[]) : null;
  }

  /**
   * Deletes audit rows older than `cutoff` and returns how many went.
   *
   * `audit_log` is append-only by trigger for every role including the owner, so this sets the
   * `ims.audit_purge` flag the trigger checks. `SET LOCAL` scopes it to this transaction, which
   * means no other statement anywhere can inherit the permission — not even a later statement
   * on the same pooled connection.
   */
  async deleteOlderThan(cutoff: Date, keepActions: readonly string[]): Promise<number> {
    return this.db.transaction().execute(async (tx) => {
      await sql`SET LOCAL ims.audit_purge = 'on'`.execute(tx);
      const result = await tx
        .deleteFrom('audit_log')
        .where('created_at', '<', cutoff)
        // The purge's own entries survive their cutoff: the record of what was deleted must
        // outlive what it deleted, or the gap in the history has no explanation.
        .where('action', 'not in', keepActions as unknown as AuditAction[])
        .executeTakeFirst();
      return Number(result.numDeletedRows ?? 0n);
    });
  }

  /**
   * Insert one row. Always writes immediately; if the caller has a transaction in flight,
   * pass it in so a successful mutation cannot lack its audit row. The plan mandates that
   * audit-write failure inside a transaction rolls the mutation back; that's how an
   * "everything is audited" promise stays honest.
   */
async insert(tx: Tx | undefined, row: AuditInsert): Promise<void> {
    const writer = tx ?? this.db;
    // `metadata` and `actor_roles` are jsonb columns. Kysely's parameter binder does not add an
    // automatic `::jsonb` cast, so a plain string parameter lands in pg as text and is rejected
    // with "invalid input syntax for type json". A *bound* parameter with an explicit cast
    // (`$n::jsonb`) fixes that.
    //
    // It must never go back to `sql.lit()`. That helper does not escape: it emits
    // `'` + value + `'` verbatim, and JSON.stringify escapes `"` and `\` but not `'`. Any
    // apostrophe in any audited value — `note: "it's fine"` on an approval — therefore closed
    // the literal, which was both a SQL injection reachable by every authenticated user and a
    // guaranteed 500 on ordinary English text.
    await sql`
      INSERT INTO audit_log (
        actor_id, actor_name, actor_email, actor_roles,
        action, entity_type, entity_id, entity_ref,
        summary, metadata,
        request_method, request_path, request_ip, user_agent,
        outcome, error_code
      )
      VALUES (
        ${row.actor_id}, ${row.actor_name}, ${row.actor_email}, ${JSON.stringify(row.actor_roles)}::jsonb,
        ${row.action}, ${row.entity_type}, ${row.entity_id}, ${row.entity_ref},
        ${row.summary}, ${JSON.stringify(row.metadata ?? {})}::jsonb,
        ${row.request_method}, ${row.request_path}, ${row.request_ip}, ${row.user_agent},
        ${row.outcome}, ${row.error_code}
      )
    `.execute(writer);
  }

  /**
   * Paginated newest-first listing for the admin page. Filters compose — the admin can pin
   * a date range AND a single actor AND a single action, and so on.
   */
  async list(query: ListAuditQuery): Promise<AuditPage> {
    const offset = (query.page - 1) * query.limit;

    // Three filters, matching the contract: actor, entity, date range. They compose.
    const base = this.db
      .selectFrom('audit_log')
      .$if(query.actorId !== undefined, (qb) =>
        qb.where('audit_log.actor_id', '=', query.actorId as string),
      )
      .$if(query.entityType !== undefined, (qb) =>
        qb.where('audit_log.entity_type', '=', query.entityType as AuditEntityType),
      )
      .$if(query.from !== undefined, (qb) =>
        qb.where('audit_log.created_at', '>=', query.from as Date),
      )
      .$if(query.to !== undefined, (qb) =>
        qb.where('audit_log.created_at', '<=', query.to as Date),
      );

    const [rows, counted] = await Promise.all([
      base
        .selectAll()
        .orderBy('audit_log.created_at', 'desc')
        .orderBy('audit_log.id', 'desc')
        .limit(query.limit)
        .offset(offset)
        .execute(),
      base
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirst(),
    ]);

    return {
      items: rows.map(toAuditRow),
      page: query.page,
      limit: query.limit,
      total: Number(counted?.count ?? 0),
    };
  }

  /**
   * The "details" drawer endpoint. Returns a single row, or `undefined` if missing.
   * Crucially, this is the only way the admin reads the metadata; the list endpoint
   * truncates metadata for table density.
   */
  async findById(id: string): Promise<AuditRow | undefined> {
    const row = await this.db
      .selectFrom('audit_log')
      .selectAll()
      .where('audit_log.id', '=', id)
      .executeTakeFirst();
    return row ? toAuditRow(row) : undefined;
  }
}

/**
 * Project a raw database row to the typed shape the API returns. `actor_roles` arrives as a
 * parsed JSON array; we narrow the type without re-validating the values, because the
 * repository is the only thing that writes them and it always passes the shared enum.
 */
function toAuditRow(row: FlattenedAuditRow): AuditRow {
  return {
    id: row.id,
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    actor_email: row.actor_email,
    actor_roles: Array.isArray(row.actor_roles) ? (row.actor_roles as Role[]) : [],
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    entity_ref: row.entity_ref,
    summary: row.summary,
    metadata: row.metadata,
    request_method: row.request_method,
    request_path: row.request_path,
    request_ip: row.request_ip,
    user_agent: row.user_agent,
    outcome: row.outcome,
    error_code: row.error_code,
    created_at: row.created_at,
  };
}

/** Project a repository row into the shared API contract. */
export function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    actorRoles: row.actor_roles,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityRef: row.entity_ref,
    summary: row.summary,
    metadata: row.metadata,
    requestMethod: row.request_method,
    requestPath: row.request_path,
    requestIp: row.request_ip,
    userAgent: row.user_agent,
    outcome: row.outcome,
    errorCode: row.error_code,
    createdAt: row.created_at.toISOString(),
  };
}