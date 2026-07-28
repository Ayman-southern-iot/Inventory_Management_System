import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../../config';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { RateLimitedError } from '../../common/errors';

/**
 * Login rate limiting, counted in Postgres rather than in memory so it survives a restart and
 * still holds if the API is ever scaled to two containers. At this system's volume the extra
 * query per login attempt is free.
 *
 * Both the email and the source IP are limited: email-only lets one attacker lock a colleague
 * out at will, IP-only lets a botnet spray one password across every account.
 */
@Injectable()
export class LoginThrottleService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async assertNotThrottled(email: string, ip: string): Promise<void> {
    const { maxAttempts, windowSeconds } = this.config.auth.loginRateLimit;
    const since = new Date(Date.now() - windowSeconds * 1000);

    const row = await this.db
      .selectFrom('login_attempts')
      .where('succeeded', '=', false)
      .where('created_at', '>=', since)
      .where((eb) => eb.or([eb('email', '=', email.toLowerCase()), eb('ip', '=', ip)]))
      .select((eb) => eb.fn.countAll<number>().as('failures'))
      .executeTakeFirst();

    if ((row?.failures ?? 0) >= maxAttempts) throw new RateLimitedError(windowSeconds);
  }

  async record(email: string, ip: string, succeeded: boolean): Promise<void> {
    await this.db
      .insertInto('login_attempts')
      .values({ email: email.toLowerCase(), ip, succeeded })
      .execute();
  }

  /** A successful login clears the counter so a user who mistyped twice is not punished. */
  async clearFailures(email: string, ip: string): Promise<void> {
    await this.db
      .deleteFrom('login_attempts')
      .where('succeeded', '=', false)
      .where((eb) => eb.and([eb('email', '=', email.toLowerCase()), eb('ip', '=', ip)]))
      .execute();
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('login_attempts')
      .where('created_at', '<', cutoff)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0n);
  }
}
