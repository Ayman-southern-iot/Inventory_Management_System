import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user';
import { auditContextFromRequest, type AuditContext } from './audit-context';

/**
 * Extracts a sanitised `AuditContext` from the current request. Use this in handlers that
 * need to pass actor + HTTP context to a service. Behind the global JWT guard the request
 * already has a `user`; failed-login handlers use `auditContextForFailedLogin` directly.
 */
export const CurrentAuditContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuditContext => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    return auditContextFromRequest(request, request.user ?? null);
  },
);
