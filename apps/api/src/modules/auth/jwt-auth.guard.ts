import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { CONFIG, type AppConfig } from '../../config';
import {
  AccountDeactivatedError,
  ForbiddenError,
  UnauthenticatedError,
} from '../../common/errors';
import { ALLOW_PENDING_PASSWORD_KEY, IS_PUBLIC_KEY } from './auth.decorators';
import { RefreshTokenRepository } from './refresh-token.repository';
import type { AccessTokenPayload, RequestUser } from './request-user';

const BEARER_PREFIX = 'Bearer ';

/**
 * Registered globally in AuthModule, so every route is authenticated unless it opts out with
 * `@Public()`. Defaulting to closed means a forgotten decorator leaks a 401, not the data.
 *
 * A valid signature is necessary but not sufficient. The token is a 15-minute bearer credential,
 * so the session is re-checked against the database on every request: a deactivated user, a
 * logged-out session and a revoked family all stop working immediately rather than at expiry,
 * and roles come from the database rather than from whatever the token was minted with.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: RefreshTokenRepository,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const header = request.headers.authorization;
    if (!header?.startsWith(BEARER_PREFIX)) throw new UnauthenticatedError();

    const token = header.slice(BEARER_PREFIX.length).trim();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.auth.accessSecret,
      });
    } catch {
      throw new UnauthenticatedError('Session expired, please sign in again');
    }

    const session = await this.sessions.findLiveSession(payload.sub, payload.fid);
    if (!session) throw new UnauthenticatedError('Session expired, please sign in again');

    // Deactivation is checked before session liveness so the caller is told the account is
    // disabled rather than a generic "signed out" — they already held a valid token for it,
    // so this reveals nothing they did not know.
    if (!session.isActive) throw new AccountDeactivatedError();

    // No live family row means the session ended: logout, an admin action, or reuse detection.
    if (!session.hasLiveSession) {
      throw new UnauthenticatedError('Session expired, please sign in again');
    }

    // A forced password change has to bite on the API, not just in the SPA. Without this the
    // temporary password an admin hands out over chat stays valid forever for anyone willing
    // to skip the UI.
    if (session.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) throw new ForbiddenError('Set a new password before continuing');
    }

    request.user = { id: payload.sub, email: session.email, roles: session.roles };
    return true;
  }
}
