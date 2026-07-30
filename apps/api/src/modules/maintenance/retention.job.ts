import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SettingKey } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { LoginThrottleService } from '../auth/login-throttle.service';
import { RefreshTokenRepository } from '../auth/refresh-token.repository';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Closes gap G-01 from the Phase 00 handoff: `login_attempts` and expired `refresh_tokens`
 * were growing forever because the cleanup methods existed but nothing called them.
 *
 * Neither table affects correctness — expiry is checked in code — but retaining dead token
 * hashes and every failed login attempt indefinitely only enlarges the blast radius of a
 * database dump.
 */
/** A genuinely universal constant, so it is named rather than inline (rules/10 exceptions). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Rows the purge never deletes, whatever the cutoff. The record of a deletion has to outlive
 * the rows it deleted, otherwise the gap it leaves has no explanation — which is precisely the
 * thing an audit log exists to prevent.
 */
const AUDIT_PURGE_EXEMPT_ACTIONS = ['audit.purge'] as const;

@Injectable()
export class RetentionJob {
  private readonly logger = new Logger(RetentionJob.name);

  constructor(
    private readonly throttle: LoginThrottleService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly idempotency: IdempotencyService,
    private readonly auditRepo: AuditRepository,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'retention' })
  async run(): Promise<void> {
    await this.prune();
  }

  /**
   * Deletes audit rows older than the configured retention window.
   *
   * Opt-in by design: `AUDIT_RETENTION_DAYS` defaults to 0, which means keep forever and skips
   * this entirely. This system's standing constraint is that no data is lost, so history is
   * only ever removed because an admin deliberately asked for a window — and the registry
   * refuses any non-zero value under 30 days so a typo cannot erase the trail an investigation
   * is running on.
   *
   * The deletion is itself audited, with the cutoff and the row count, and `audit.purge` rows
   * are exempt from their own cutoff — a gap in the history must always carry its explanation.
   */
  private async pruneAuditLog(): Promise<number> {
    const retentionDays = await this.settings.get(SettingKey.AUDIT_RETENTION_DAYS);
    if (retentionDays === 0) return 0;

    const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY);
    const removed = await this.auditRepo.deleteOlderThan(cutoff, AUDIT_PURGE_EXEMPT_ACTIONS);
    if (removed === 0) return 0;

    this.logger.log(
      `Retention: purged ${removed} audit row(s) older than ${cutoff.toISOString()} ` +
        `(${retentionDays} day window)`,
    );
    await this.audit.record({
      action: 'audit.purge',
      entityType: 'system',
      entityRef: 'audit_log',
      summary: `Purged ${removed} audit entries older than ${retentionDays} days`,
      metadata: { retentionDays, cutoff: cutoff.toISOString(), removed },
    });
    return removed;
  }

  async prune(): Promise<{
    attempts: number;
    tokens: number;
    idempotencyKeys: number;
    auditRows: number;
  }> {
    // Attempts older than the rate-limit window can never influence a decision again.
    const attemptCutoff = new Date(
      Date.now() - this.config.auth.loginRateLimit.windowSeconds * 1000,
    );
    const attempts = await this.throttle.deleteOlderThan(attemptCutoff);

    // Expired refresh rows are already refused; keeping the hashes buys nothing.
    const tokens = await this.refreshTokens.deleteExpiredBefore(new Date());

    // A day is far longer than any client would still be retrying, and keeping the keys that
    // long means a repeated submit is still recognised across an overnight outage.
    const idempotencyCutoff = new Date(Date.now() - MS_PER_DAY);
    const idempotencyKeys = await this.idempotency.deleteOlderThan(idempotencyCutoff);

    if (attempts > 0 || tokens > 0 || idempotencyKeys > 0) {
      this.logger.log(
        `Retention: removed ${attempts} login attempt(s), ${tokens} expired token(s), ` +
          `${idempotencyKeys} idempotency key(s)`,
      );
    }

    // Last, and isolated: purging audit history must never be the reason the cheap, always-safe
    // cleanups above did not run.
    let auditRows = 0;
    try {
      auditRows = await this.pruneAuditLog();
    } catch (error) {
      this.logger.error(`Audit purge failed, other retention completed: ${String(error)}`);
    }

    return { attempts, tokens, idempotencyKeys, auditRows };
  }
}
