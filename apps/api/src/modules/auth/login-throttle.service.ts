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
 *
 * The `Retry-After` value returned with a 429 grows exponentially with the number of recent
 * failed attempts for the offending dimension (capped at `loginThrottle.maxWindowSeconds`),
 * so a persistent attacker hits an ever-longer wall instead of recovering every flat window.
 * Successful login clears the counter for the user, so a colleague who mistyped twice is not
 * punished — that is the same anti-DoS-against-colleague reasoning as the per-IP/per-email
 * split.
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

  /**
   * Capped exponential backoff: `min(2^attempts × baseWindow, maxWindow)`. `attempts` is the
   * count of recent failures (>= 1) before this one — the first failure gives 2 × base,
   * the second 4 × base, and so on, capping at `maxWindow` so an attacker can never be
   * locked out for hours.
   *
   * With the defaults (base=30s, max=900s) the lockout sequence is 60s, 120s, 240s, 480s,
   * 900s, 900s, …
   */
  computeBackoffSeconds(attempts: number): number {
    const safe = Math.max(1, Math.floor(attempts));
    const { baseWindowSeconds, maxWindowSeconds } = this.config.auth.loginThrottle;
    const raw = Math.pow(2, safe) * baseWindowSeconds;
    return Math.min(maxWindowSeconds, raw);
  }

  /** The ceiling a single source address may not exceed, whatever credentials it presents. */
  async assertIpNotThrottled(ip: string): Promise<void> {
    const { maxAttempts } = this.config.auth.loginRateLimit;
    const { byIp } = await this.countRecentFailures('', ip);
    if (byIp >= maxAttempts) {
      throw new RateLimitedError(this.computeBackoffSeconds(byIp));
    }
  }

  /**
   * Returns the `Retry-After` value to surface when the per-email ceiling trips, or `null` if
   * the caller is not yet throttled. Returning a value (rather than throwing) lets the caller
   * pass the existing failure count through to the wrong-password response so a single bad
   * guess doesn't reset the backoff.
   */
  emailRetryAfterSeconds(failuresByEmail: number): number | null {
    if (failuresByEmail < this.config.auth.loginRateLimit.maxAttempts) return null;
    return this.computeBackoffSeconds(failuresByEmail);
  }

  /**
   * Backwards-compatible boolean form used by callers that only want to know whether the email
   * has reached the ceiling. The actual `Retry-After` value is read separately via
   * {@link emailRetryAfterSeconds}.
   */
  isEmailThrottled(failuresByEmail: number): boolean {
    return this.emailRetryAfterSeconds(failuresByEmail) !== null;
  }

  /**
   * The flat window in seconds. Kept for callers (and the AllExceptionsFilter retry-after
   * fallback) that need a single representative value without a failure count.
   */
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
