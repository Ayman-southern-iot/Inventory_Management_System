import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { CONFIG, type AppConfig } from '../../config';
import { UnauthenticatedError } from '../../common/errors';
import { IS_PUBLIC_KEY } from './auth.decorators';
import type { AccessTokenPayload, RequestUser } from './request-user';

const BEARER_PREFIX = 'Bearer ';

/**
 * Registered globally in AuthModule, so every route is authenticated unless it opts out with
 * `@Public()`. Defaulting to closed means a forgotten decorator leaks a 401, not the data.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
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

    // The access token carries the role set so the hot path is signature-verify only. It is
    // short-lived by design; a role change takes effect at the next refresh, at most 15 minutes.
    request.user = { id: payload.sub, email: payload.email, roles: payload.roles ?? [] };
    return true;
  }
}
