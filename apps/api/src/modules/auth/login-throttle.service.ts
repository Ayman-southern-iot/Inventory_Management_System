import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
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

  /**
   * Counted separately per dimension, not with an OR.
   *
   * An OR across email and IP means anyone who knows a colleague's address can lock them out
   * of their own account from anywhere, which is a denial of service handed to any passer-by.
   * Keeping them apart lets the caller enforce the IP ceiling unconditionally while treating
   * the email ceiling as something a correct password is allowed through.
   */
  async countRecentFailures(email: string, ip: string): Promise<{ byEmail: number; byIp: number }> {
    const { windowSeconds } = this.config.auth.loginRateLimit;
    const since = new Date(Date.now() - windowSeconds * 1000);

    const row = await this.db
      .selectFrom('login_attempts')
      .where('succeeded', '=', false)
      .where('created_at', '>=', since)
      .where((eb) => eb.or([eb('email', '=', email.toLowerCase()), eb('ip', '=', ip)]))
      .select((eb) => [
        eb.fn
          .count<number>(sql`CASE WHEN email = ${email.toLowerCase()} THEN 1 END`)
          .as('by_email'),
        eb.fn.count<number>(sql`CASE WHEN ip = ${ip} THEN 1 END`).as('by_ip'),
      ])
      .executeTakeFirst();

    return { byEmail: Number(row?.by_email ?? 0), byIp: Number(row?.by_ip ?? 0) };
  }

  /** The ceiling a single source address may not exceed, whatever credentials it presents. */
  async assertIpNotThrottled(ip: string): Promise<void> {
    const { maxAttempts, windowSeconds } = this.config.auth.loginRateLimit;
    const { byIp } = await this.countRecentFailures('', ip);
    if (byIp >= maxAttempts) throw new RateLimitedError(windowSeconds);
  }

  isEmailThrottled(failuresByEmail: number): boolean {
    return failuresByEmail >= this.config.auth.loginRateLimit.maxAttempts;
  }

  get windowSeconds(): number {
    return this.config.auth.loginRateLimit.windowSeconds;
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
