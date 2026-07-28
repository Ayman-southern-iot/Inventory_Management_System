import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import type { Role } from '@ims/shared';
import type { RequestUser } from './request-user';
import { RolesGuard } from './roles.guard';

export const IS_PUBLIC_KEY = 'ims:isPublic';
export const ROLES_KEY = 'ims:roles';

/** Opts an endpoint out of authentication. Everything is authenticated by default. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Coarse role gate. Ownership and state checks ("may *this* approver withdraw *now*") belong
 * in the service, not here — the guard cannot see the requisition's status.
 *
 * Only RolesGuard is attached: JwtAuthGuard is already registered globally in AuthModule and
 * global guards run first, so `req.user` is populated by the time this runs. Re-attaching it
 * here would force every feature module to import JwtModule just to satisfy the injector.
 */
export const Roles = (...roles: Role[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, roles), UseGuards(RolesGuard));

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    if (!request.user) {
      // Reaching a handler without a user means the guard was bypassed — fail loudly rather
      // than handing the service `undefined` and letting it act as nobody.
      throw new Error('CurrentUser used on a route that is not authenticated');
    }
    return request.user;
  },
);
