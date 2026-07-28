import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { AuthUser, LoginInput, LoginResponse } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import {
  AccountDeactivatedError,
  InvalidCredentialsError,
  SessionRevokedError,
  TokenExpiredError,
  TokenReuseDetectedError,
} from '../../common/errors';
import { PasswordService } from '../../security/password.service';
import { RefreshRevocationReason } from '../../database/schema';
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
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: LoginInput, context: LoginContext): Promise<LoginResponse> {
    await this.throttle.assertNotThrottled(input.email, context.ip);

    const user = await this.users.findAuthRecordByEmail(input.email);

    // Verify against a dummy hash when the email is unknown, so a missing account and a wrong
    // password take the same time. Otherwise the response latency enumerates valid emails.
    const passwordOk = user
      ? await this.passwords.verify(user.password_hash, input.password)
      : await this.burnTime(input.password);

    if (!user || !passwordOk) {
      await this.throttle.record(input.email, context.ip, false);
      throw new InvalidCredentialsError();
    }

    if (!user.is_active) {
      await this.throttle.record(input.email, context.ip, false);
      throw new AccountDeactivatedError();
    }

    await this.throttle.record(input.email, context.ip, true);
    await this.throttle.clearFailures(input.email, context.ip);
    await this.users.touchLastLogin(user.id);

    const familyId = this.refreshTokens.newFamilyId();
    const tokens = await this.issueTokens(user, familyId, context.userAgent);

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
      // An administrator ending a session is routine; telling that user they may have been
      // compromised would be alarming and wrong. Every other revocation reason means a token
      // that should be dead is being presented, which is the theft signal.
      if (stored.revoked_reason === RefreshRevocationReason.ADMIN_REVOKED) {
        throw new SessionRevokedError();
      }

      await this.refreshTokens.revokeFamily(
        stored.family_id,
        RefreshRevocationReason.REUSE_DETECTED,
      );
      this.logger.warn(`Refresh token reuse detected for user ${stored.user_id}; family revoked`);
      throw new TokenReuseDetectedError();
    }

    if (stored.expires_at.getTime() <= Date.now()) throw new TokenExpiredError();

    const user = await this.users.findAuthRecordById(payload.sub);
    if (!user) throw new TokenExpiredError();
    if (!user.is_active) {
      await this.refreshTokens.revokeAllForUser(user.id, RefreshRevocationReason.ADMIN_REVOKED);
      throw new AccountDeactivatedError();
    }

    const tokens = await this.issueTokens(user, stored.family_id, context.userAgent, stored.id);
    return { ...tokens, user: toAuthUser(user) };
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

  async me(userId: string): Promise<AuthUser> {
    const user = await this.users.findAuthRecordById(userId);
    if (!user) throw new TokenExpiredError();
    if (!user.is_active) throw new AccountDeactivatedError();
    return toAuthUser(user);
  }

  private async issueTokens(
    user: UserWithRoles,
    familyId: string,
    userAgent: string | null,
    replacesId?: string,
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
    const jti = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const refreshPayload: RefreshTokenPayload = { sub: user.id, jti, fid: familyId };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.auth.refreshSecret,
      expiresIn: refreshTtlSeconds,
    });

    await this.refreshTokens.issue({
      userId: user.id,
      token: refreshToken,
      familyId,
      expiresAt: new Date(Date.now() + refreshTtlSeconds * 1000),
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
