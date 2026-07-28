import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CONFIG, type AppConfig } from '../../config';
import { LoginThrottleService } from '../auth/login-throttle.service';
import { RefreshTokenRepository } from '../auth/refresh-token.repository';

/**
 * Closes gap G-01 from the Phase 00 handoff: `login_attempts` and expired `refresh_tokens`
 * were growing forever because the cleanup methods existed but nothing called them.
 *
 * Neither table affects correctness — expiry is checked in code — but retaining dead token
 * hashes and every failed login attempt indefinitely only enlarges the blast radius of a
 * database dump.
 */
@Injectable()
export class RetentionJob {
  private readonly logger = new Logger(RetentionJob.name);

  constructor(
    private readonly throttle: LoginThrottleService,
    private readonly refreshTokens: RefreshTokenRepository,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'retention' })
  async run(): Promise<void> {
    await this.prune();
  }

  async prune(): Promise<{ attempts: number; tokens: number }> {
    // Attempts older than the rate-limit window can never influence a decision again.
    const attemptCutoff = new Date(
      Date.now() - this.config.auth.loginRateLimit.windowSeconds * 1000,
    );
    const attempts = await this.throttle.deleteOlderThan(attemptCutoff);

    // Expired refresh rows are already refused; keeping the hashes buys nothing.
    const tokens = await this.refreshTokens.deleteExpiredBefore(new Date());

    if (attempts > 0 || tokens > 0) {
      this.logger.log(`Retention: removed ${attempts} login attempt(s), ${tokens} expired token(s)`);
    }
    return { attempts, tokens };
  }
}
