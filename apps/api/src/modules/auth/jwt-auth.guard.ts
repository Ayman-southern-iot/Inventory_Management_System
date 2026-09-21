import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import {
  API_KEY_QUERY_PARAM,
  API_KEY_TOKEN_PREFIX,
  type ApiKeyScope,
} from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import {
  AccountDeactivatedError,
  ApiKeyScopeDeniedError,
  ForbiddenError,
  UnauthenticatedError,
} from '../../common/errors';
import { API_KEY_SCOPES_KEY } from '../api-keys/api-key.decorators';
import {
  ApiKeysService,
  type AuthenticatedApiKey,
} from '../api-keys/api-keys.service';
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
    private readonly apiKeys: ApiKeysService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser; apiKey?: AuthenticatedApiKey }>();
    const header = request.headers.authorization;

    /*
     * A key may also arrive as `?api_key=...`, so a URL can be pasted into a browser and read
     * (Ayman's call, over a header extension and over an expiring preview link). Only ever a
     * key, never a session token: a JWT in a URL would be strictly worse and nobody asked for
     * it. The header wins when both are present, so the safe habit stays the default.
     */
    const queryValue = request.query?.[API_KEY_QUERY_PARAM];
    const queryKey = typeof queryValue === 'string' ? queryValue.trim() : undefined;

    if (!header?.startsWith(BEARER_PREFIX)) {
      if (queryKey?.startsWith(API_KEY_TOKEN_PREFIX)) {
        request.apiKey = await this.authenticateApiKey(queryKey, context, request.method);
        return true;
      }
      throw new UnauthenticatedError();
    }

    const token = header.slice(BEARER_PREFIX.length).trim();

    // A key is not a session and takes an entirely separate path — see authenticateApiKey.
    if (token.startsWith(API_KEY_TOKEN_PREFIX)) {
      request.apiKey = await this.authenticateApiKey(token, context, request.method);
      return true;
    }

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

  /**
   * Authenticate a key and decide, in the same breath, whether it may reach this route.
   *
   * The scope check lives here rather than in a guard of its own because a second global guard
   * would have to run *after* this one to see the result, and global guard order follows module
   * registration rather than anything declared. Deciding both here means there is no ordering
   * to get wrong.
   *
   * **`request.user` is deliberately left undefined.** Populating it with a synthetic user is
   * the obvious shortcut and it is a trap: `RolesGuard` reads `request.user.roles`, so a key
   * carrying roles could satisfy `@Roles(Role.ADMIN)` and reach the endpoint that mints more
   * keys; and `auditContextFromRequest` reads the same object, so every audited action would be
   * attributed to a person who did not perform it. Leaving it undefined closes both by
   * construction — `RolesGuard` already throws when it is missing, so every `@Roles` route is
   * shut to keys with no extra code, and the audit context already tolerates a null actor.
   */
  private async authenticateApiKey(
    token: string,
    context: ExecutionContext,
    method: string,
  ): Promise<AuthenticatedApiKey> {
    const required = this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(
      API_KEY_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    /*
     * Default-deny. An undecorated route is unreachable by a key — including every route that
     * is merely "any signed-in user" and carries no `@Roles` at all, which is the gap a
     * roles-only check would leave wide open.
     *
     * Checked before the key is looked up, so an unauthorised route cannot be used as an
     * oracle for whether a given key string exists.
     */
    if (!required || required.length === 0) throw new ApiKeyScopeDeniedError();

    /*
     * Belt and braces. Every scope in the model today ends in `:read`, and the routes carrying
     * them are all GETs — but a future write scope should have to delete this line deliberately
     * rather than inherit write access by being added to an enum.
     */
    if (method !== 'GET') {
      throw new ApiKeyScopeDeniedError('API keys are read-only');
    }

    const key = await this.apiKeys.authenticate(token);
    if (!required.some((scope) => key.scopes.includes(scope))) {
      throw new ApiKeyScopeDeniedError();
    }
    return key;
  }
}
