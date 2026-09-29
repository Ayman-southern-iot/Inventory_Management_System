import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user';
import type { AuthenticatedApiKey } from '../api-keys/api-keys.service';
import { auditContextFromRequest, type AuditContext } from './audit-context';

/**
 * Extracts a sanitised `AuditContext` from the current request. Use this in handlers that
 * need to pass actor + HTTP context to a service. Behind the global JWT guard the request
 * already has a `user`; failed-login handlers use `auditContextForFailedLogin` directly.
 *
 * For a key bound to a service account, `request.user` is that account and `request.apiKey` the
 * key it presented (ADR-0002), so the row names the account as the actor *and* records the key.
 */
export const CurrentAuditContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuditContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser; apiKey?: AuthenticatedApiKey }>();
    return auditContextFromRequest(request, request.user ?? null, request.apiKey?.id ?? null);
  },
);
