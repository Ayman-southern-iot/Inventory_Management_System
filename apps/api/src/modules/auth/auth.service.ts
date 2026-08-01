import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { AuthUser, LoginInput, LoginResponse } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import {
  AccountDeactivatedError,
  InvalidCredentialsError,
  RateLimitedError,
  SessionRevokedError,
  TokenExpiredError,
  TokenReuseDetectedError,
} from '../../common/errors';
import { PasswordService } from '../../security/password.service';
import { RefreshRevocationReason } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { UsersService } from '../users/users.service';
import type { UserWithRoles } from '../users/users.repository';
import { LoginThrottleService } from './login-throttle.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import type { AccessTokenPayload, RefreshTokenPayload } from './request-user';

const REFRESH_TOKEN_BYTES = 48;

export interface LoginContext {
  ip: string;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: LoginInput, context: LoginContext): Promise<LoginResponse> {
    // The source address is capped unconditionally — that is what stops brute force.
    await this.throttle.assertIpNotThrottled(context.ip);
    const failures = await this.throttle.countRecentFailures(input.email, context.ip);

    const user = await this.users.findAuthRecordByEmail(input.email);

    // Verify against a dummy hash when the email is unknown, so a missing account and a wrong
    // password take the same time. Otherwise the response latency enumerates valid emails.
    const passwordOk = user
      ? await this.passwords.verify(user.password_hash, input.password)
      : await this.burnTime(input.password);

    if (!user || !passwordOk) {
      await this.throttle.record(input.email, context.ip, false);
      // Only report the per-account lockout to someone who failed. Checking the password first
      // means a third party spraying wrong passwords at a colleague's address can no longer
      // lock that colleague out of their own account. The Retry-After grows exponentially with
      // the failure count for this address, so a persistent attacker recovers less and less.
      const retryAfter = this.throttle.emailRetryAfterSeconds(failures.byEmail);
      if (retryAfter !== null) {
        throw new RateLimitedError(retryAfter);
      }
      await this.audit.recordFailure(
        {
          action: 'auth.login.failure',
          entityType: 'auth',
          entityRef: input.email,
          summary: `Failed login attempt for ${input.email}`,
          outcome: 'failure',
          errorCode: 'INVALID_CREDENTIALS',
          metadata: { attemptedEmail: input.email },
        },
        this.auditContextForLogin(context, input.email),
      );
      throw new InvalidCredentialsError();
    }

    if (!user.is_active) {
      await this.throttle.record(input.email, context.ip, false);
      await this.audit.recordFailure(
        {
          action: 'auth.login.failure',
          entityType: 'auth',
          entityRef: input.email,
          summary: `Deactivated account login attempt for ${input.email}`,
          outcome: 'denied',
          errorCode: 'ACCOUNT_DEACTIVATED',
          metadata: { attemptedEmail: input.email },
        },
        this.auditContextForLogin(context, input.email),
      );
      throw new AccountDeactivatedError();
    }

    await this.throttle.record(input.email, context.ip, true);
    await this.throttle.clearFailures(input.email, context.ip);
    await this.users.touchLastLogin(user.id);

    const familyId = this.refreshTokens.newFamilyId();
    const tokens = await this.issueTokens(user, familyId, context.userAgent);

    // Post-commit: the session already exists and last_login is already stamped. See
    // `AuditService.recordCommitted` for why this must not fail the request.
    await this.audit.recordCommitted(
      {
        action: 'auth.login.success',
        entityType: 'auth',
        entityId: user.id,
        entityRef: user.email,
        summary: `Signed in as ${user.email}`,
        metadata: { method: 'password' },
      },
      {
        actorId: user.id,
        actorName: user.full_name,
        actorEmail: user.email,
        actorRoles: user.roles,
        requestMethod: 'POST',
        requestPath: '/auth/login',
        requestIp: context.ip,
        userAgent: context.userAgent,
      },
    );

    this.logger.log(`Login ${user.email} from ${context.ip}`);
    return { ...tokens, user: toAuthUser(user) };
  }

  async refresh(refreshToken: string, context: LoginContext): Promise<LoginResponse> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.auth.refreshSecret,
      });
    } catch {
      throw new TokenExpiredError();
    }

    const stored = await this.refreshTokens.findByToken(refreshToken);
    if (!stored) throw new TokenExpiredError();

    if (stored.revoked_at !== null) {
      const revokedAgoMs = Date.now() - stored.revoked_at.getTime();

      // No grace window for a recently-rotated token, deliberately. The multi-tab race that
      // motivates one is a client defect — two independent refresh loops sharing a single
      // stored token — and it is fixed there, with a cross-tab lock in api/client.ts. Relaxing
      // reuse detection server-side would trade a real security control for a client bug.

      // Always record the replay: a stolen token presented after an administrator reset the
      // password is exactly the case where somebody needs to know it happened.
      this.logger.warn(
        `Revoked refresh token replayed for user ${stored.user_id} ` +
          `(reason=${stored.revoked_reason ?? 'unrecorded'}, ${Math.round(revokedAgoMs / 1000)}s ago)`,
      );

      // An administrator ending a session is routine; telling that user they may have been
      // compromised would be alarming and wrong. Every other reason is the theft signal.
      if (stored.revoked_reason === RefreshRevocationReason.ADMIN_REVOKED) {
        throw new SessionRevokedError();
      }

      await this.refreshTokens.revokeFamily(
        stored.family_id,
        RefreshRevocationReason.REUSE_DETECTED,
      );
      throw new TokenReuseDetectedError();
    }

    if (stored.expires_at.getTime() <= Date.now()) throw new TokenExpiredError();

    const user = await this.requireActiveUser(payload.sub);

    // The successor inherits this token's expiry rather than getting a fresh 14 days. Otherwise
    // a stolen family can be rotated forever and the absolute session lifetime never applies.
    const tokens = await this.issueTokens(
      user,
      stored.family_id,
      context.userAgent,
      stored.id,
      stored.expires_at,
    );
    return { ...tokens, user: toAuthUser(user) };
  }

  private async requireActiveUser(userId: string): Promise<UserWithRoles> {
    const user = await this.users.findAuthRecordById(userId);
    if (!user) throw new TokenExpiredError();
    if (!user.is_active) {
      await this.refreshTokens.revokeAllForUser(user.id, RefreshRevocationReason.ADMIN_REVOKED);
      throw new AccountDeactivatedError();
    }
    return user;
  }

  async logout(refreshToken: string | undefined, userId: string): Promise<void> {
    if (!refreshToken) {
      await this.refreshTokens.revokeAllForUser(userId, RefreshRevocationReason.LOGOUT);
      return;
    }
    const stored = await this.refreshTokens.findByToken(refreshToken);
    // Revoke the family, not just the row: logging out on a device should not leave an older
    // token from the same login still usable.
    if (stored && stored.user_id === userId) {
      await this.refreshTokens.revokeFamily(stored.family_id, RefreshRevocationReason.LOGOUT);
    } else {
      await this.refreshTokens.revokeAllForUser(userId, RefreshRevocationReason.LOGOUT);
    }
  }

  /**
   * Changing your own password ends every *other* session and starts a fresh one here.
   *
   * Revoking the caller's own session too would sign them out the instant they set a new
   * password, which reads as a failure. Issuing a new family keeps them signed in while still
   * evicting anyone who was holding a session on the old credential — which is the entire
   * reason someone changes their password in a hurry.
   */
  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    context: LoginContext & { requestMethod?: string; requestPath?: string },
  ): Promise<LoginResponse> {
    const before = await this.users.findAuthRecordById(userId);
    if (!before) throw new TokenExpiredError();

    await this.users.changeOwnPassword(userId, input.currentPassword, input.newPassword, {
      actorId: userId,
      actorName: before.full_name,
      actorEmail: before.email,
      actorRoles: before.roles,
      requestMethod: context.requestMethod ?? 'POST',
      requestPath: context.requestPath ?? '/auth/change-password',
      requestIp: context.ip,
      userAgent: context.userAgent,
    });

    const user = await this.users.findAuthRecordById(userId);
    if (!user) throw new TokenExpiredError();

    const familyId = this.refreshTokens.newFamilyId();
    const tokens = await this.issueTokens(user, familyId, context.userAgent);

    // Post-commit: the password is already replaced and every other session already evicted.
    // A 500 here would tell the user their change failed while their old password no longer works.
    await this.audit.recordCommitted(
      {
        action: 'auth.password.change',
        entityType: 'auth',
        entityId: userId,
        entityRef: user.email,
        summary: `Changed own password for ${user.email}`,
        metadata: { sessionsEvicted: true },
      },
      {
        actorId: userId,
        actorName: user.full_name,
        actorEmail: user.email,
        actorRoles: user.roles,
        requestMethod: context.requestMethod ?? 'POST',
        requestPath: context.requestPath ?? '/auth/change-password',
        requestIp: context.ip,
        userAgent: context.userAgent,
      },
    );
    return { ...tokens, user: toAuthUser(user) };
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.users.findAuthRecordById(userId);
    if (!user) throw new TokenExpiredError();
    if (!user.is_active) throw new AccountDeactivatedError();
    return toAuthUser(user);
  }

  /**
   * Build a best-effort `AuditContext` for a login attempt where the only signal we have is
   * IP, user-agent, and the email the caller typed. Used only for failure rows that record
   * the attempt — the audit row for a successful login is built from the loaded user row.
   */
  private auditContextForLogin(context: LoginContext, attemptedEmail: string): AuditContext {
    return {
      actorId: null,
      actorName: null,
      actorEmail: attemptedEmail,
      actorRoles: [],
      requestMethod: 'POST',
      requestPath: '/auth/login',
      requestIp: context.ip,
      userAgent: context.userAgent,
    };
  }

  private async issueTokens(
    user: UserWithRoles,
    familyId: string,
    userAgent: string | null,
    replacesId?: string,
    /** Inherited on rotation so the family has an absolute lifetime, not a sliding one. */
    familyExpiresAt?: Date,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const { accessTtlSeconds, refreshTtlSeconds } = this.config.auth;

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      fid: familyId,
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.auth.accessSecret,
      expiresIn: accessTtlSeconds,
    });

    // A random jti makes every refresh token unique even if two are issued in the same second,
    // which matters because the hash is the primary lookup key.
    const expiresAt = familyExpiresAt ?? new Date(Date.now() + refreshTtlSeconds * 1000);
    const remainingSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

    const jti = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const refreshPayload: RefreshTokenPayload = { sub: user.id, jti, fid: familyId };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.auth.refreshSecret,
      // The JWT's own expiry tracks the family's, so a stolen token cannot outlive it even if
      // the row is somehow missed.
      expiresIn: remainingSeconds,
    });

    await this.refreshTokens.issue({
      userId: user.id,
      token: refreshToken,
      familyId,
      expiresAt,
      userAgent,
      ...(replacesId ? { replacesId } : {}),
    });

    return { accessToken, refreshToken, expiresIn: accessTtlSeconds };
  }

  /** Constant-ish work for an unknown email. The result is always false. */
  private async burnTime(candidate: string): Promise<boolean> {
    const DUMMY_HASH =
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';
    await this.passwords.verify(DUMMY_HASH, candidate);
    return false;
  }
}

export function toAuthUser(row: UserWithRoles): AuthUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    designation: row.designation,
    departmentId: row.department_id,
    departmentName: row.department_name,
    roles: row.roles,
    mustChangePassword: row.must_change_password,
  };
}
