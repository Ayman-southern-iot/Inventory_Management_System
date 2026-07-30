import { Injectable, Logger } from '@nestjs/common';
import { AUDIT_ALWAYS_ON_ACTIONS } from '@ims/shared';
import type {
  AuditAction,
  AuditEntityType,
  AuditEntry,
  AuditOutcome,
  ListAuditQuery,
  Paginated,
  Role,
} from '@ims/shared';
import { AuditRepository, type AuditInsert, type AuditRow, type Tx } from './audit.repository';
import { toAuditEntry } from './audit.repository';
import type { AuditContext } from './audit-context';
import { SYSTEM_AUDIT_CONTEXT } from './audit-context';
import { sanitiseMetadata } from './audit-sanitizer';

/**
 * What the rest of the codebase needs in order to record one audit row. Kept narrow on
 * purpose: anything else (HTTP context, IP, UA, ...) comes from the `AuditContext`, which
 * the service fills from the request or `SYSTEM_AUDIT_CONTEXT`.
 */
export interface AuditRecordInput {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  entityRef?: string | null;
  summary: string;
  /**
   * Optional structured payload. Will be sanitised before it touches the database — secret
   * keys, JWT-shaped strings, and over-long strings are redacted or capped. Callers can pass
   * a domain object directly; the redactor handles depth.
   */
  metadata?: unknown;
  outcome?: AuditOutcome;
  errorCode?: string | null;
}

/**
 * Outcome variants to express in the audit row. Centralised here so a controller can record
 * a `denied` for an authorisation failure with one line rather than hand-build a row each
 * time.
 */
/**
 * How long a resolved enabled-action set is reused. The gate runs on every audited mutation, so
 * it must not add a query per write; 30s matches `SettingsService`'s own cache TTL, so an
 * admin's change takes effect within the same window everywhere else in the product.
 */
const ENABLED_ACTIONS_TTL_MS = 30_000;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private enabledActions: { value: Set<string> | null; expiresAt: number } | null = null;

  constructor(private readonly repo: AuditRepository) {}

  /**
   * Whether this action is currently recorded.
   *
   * `AUDIT_ALWAYS_ON_ACTIONS` bypasses the setting entirely. `SettingsService` already refuses
   * to save a set that omits one, but enforcing it here too means a row edited directly in the
   * database — or written by an older build — still cannot silence a login or a settings change.
   */
  private async isRecorded(action: AuditAction): Promise<boolean> {
    if ((AUDIT_ALWAYS_ON_ACTIONS as readonly string[]).includes(action)) return true;

    const now = Date.now();
    if (!this.enabledActions || this.enabledActions.expiresAt <= now) {
      let value: Set<string> | null = null;
      try {
        const configured = await this.repo.readEnabledActions();
        value = configured ? new Set(configured) : null;
      } catch (error) {
        // Record everything rather than nothing if the setting cannot be read.
        this.logger.warn(`Could not read AUDIT_ENABLED_ACTIONS, recording all: ${String(error)}`);
        value = null;
      }
      this.enabledActions = { value, expiresAt: now + ENABLED_ACTIONS_TTL_MS };
    }

    const configured = this.enabledActions.value;
    return configured === null ? true : configured.has(action);
  }

  /** Test seam, and the hook for an immediate refresh after an admin saves the setting. */
  clearEnabledActionsCache(): void {
    this.enabledActions = null;
  }

  /**
   * Record one audit row. If `tx` is supplied the write joins the caller's transaction; if
   * the write fails the mutation rolls back. The plan explicitly favours this over
   * silent-accept — a successful mutation without an audit entry is the worst possible
   * failure mode for an audit log.
   *
   * `context` may be omitted only from jobs that legitimately have no actor — those pass
   * `SYSTEM_AUDIT_CONTEXT`. Anything user-initiated must pass a populated context.
   */
  async record(
    input: AuditRecordInput,
    context: AuditContext = SYSTEM_AUDIT_CONTEXT,
    tx?: Tx,
  ): Promise<void> {
    if (!(await this.isRecorded(input.action))) return;

    const insert: AuditInsert = {
      actor_id: context.actorId,
      actor_name: context.actorName,
      actor_email: context.actorEmail,
      actor_roles: context.actorRoles as Role[],
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_ref: input.entityRef ?? null,
      summary: input.summary,
      metadata: sanitiseMetadata(input.metadata ?? {}),
      request_method: context.requestMethod,
      request_path: context.requestPath,
      request_ip: context.requestIp,
      user_agent: context.userAgent,
      outcome: input.outcome ?? 'success',
      error_code: input.errorCode ?? null,
    };

    try {
      await this.repo.insert(tx, insert);
    } catch (error) {
      // We rethrow on purpose: the caller's transaction (if any) rolls back. The only time
      // we log-and-swallow is for the explicit "best-effort denied/failure logging" path
      // (see `recordFailure`).
      this.logger.error(
        `Audit write failed for ${input.action} on ${input.entityType}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Record an action whose mutation is **already committed** and cannot be undone — a session
   * that has been issued, a password that has already been replaced.
   *
   * `record` is fail-closed so that a mutation and its audit row live or die together, which
   * only works while the caller still holds an open transaction to roll back. Past the commit
   * there is nothing left to roll back, so rethrowing does not protect the audit trail; it just
   * reports a completed action as a 500, and the client retries something that already happened.
   * Worse, on the login path it makes authentication unavailable whenever `audit_log` is —
   * one unmigrated table locked every user out of this system once already.
   *
   * So: log at ERROR (this is never routine) and let the caller succeed.
   */
  async recordCommitted(input: AuditRecordInput, context: AuditContext): Promise<void> {
    try {
      await this.record(input, context);
    } catch {
      // `record` has already logged the cause at ERROR with the action and entity type.
      this.logger.error(
        `Post-commit audit row lost for ${input.action} on ${input.entityType} — ` +
          `the action itself succeeded and was NOT rolled back`,
      );
    }
  }

  /**
   * Best-effort audit for HTTP denials and failures. These happen *outside* the
   * transaction that the would-be mutation never opened, so a write failure cannot roll a
   * mutation back. We log and continue so a transient audit-write problem cannot break the
   * HTTP error path that an admin is using to debug a production incident.
   */
  async recordFailure(input: AuditRecordInput, context: AuditContext): Promise<void> {
    const insert: AuditInsert = {
      actor_id: context.actorId,
      actor_name: context.actorName,
      actor_email: context.actorEmail,
      actor_roles: context.actorRoles as Role[],
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_ref: input.entityRef ?? null,
      summary: input.summary,
      metadata: sanitiseMetadata(input.metadata ?? {}),
      request_method: context.requestMethod,
      request_path: context.requestPath,
      request_ip: context.requestIp,
      user_agent: context.userAgent,
      outcome: input.outcome ?? 'failure',
      error_code: input.errorCode ?? null,
    };

    try {
      await this.repo.insert(undefined, insert);
    } catch (error) {
      this.logger.warn(
        `Best-effort audit write failed for ${input.action} on ${input.entityType}: ${(error as Error).message}`,
      );
    }
  }

  /* ----------------------------------------------------------- admin queries */

  /**
   * Admin list endpoint. Newest-first pagination, filterable. The shared `Paginated<T>`
   * envelope is what every other list in this codebase already returns; matching it keeps the
   * admin page's pagination primitives reusable.
   */
  async list(query: ListAuditQuery): Promise<Paginated<AuditEntry>> {
    const page = await this.repo.list(query);
    return {
      items: page.items.map(toAuditEntry),
      page: page.page,
      limit: page.limit,
      total: page.total,
    };
  }

  /** Detail drawer endpoint. Returns `null` (controller turns into 404) if missing. */
  async findById(id: string): Promise<AuditEntry | null> {
    const row: AuditRow | undefined = await this.repo.findById(id);
    return row ? toAuditEntry(row) : null;
  }
}
