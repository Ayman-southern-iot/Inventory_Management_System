import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@ims/shared';
import { ForbiddenError, UnauthenticatedError } from '../../common/errors';
import { ROLES_KEY } from './auth.decorators';
import type { RequestUser } from './request-user';

/** Roles are additive, so holding *any* of the required roles is enough. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    if (!request.user) throw new UnauthenticatedError();

    if (!required.some((role) => request.user!.roles.includes(role))) throw new ForbiddenError();
    return true;
  }
}
