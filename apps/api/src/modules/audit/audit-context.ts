import type { Request } from 'express';
import type { Role } from '@ims/shared';
import type { RequestUser } from '../auth/request-user';
import { sanitiseRequestPath, sanitiseUserAgent } from './audit-sanitizer';

/**
 * Phase 06 — request/actor context the audit log needs.
 *
 * Mutating services receive a small `AuditContext` rather than the whole Express request.
 * That keeps services pure (they can be called from a CLI, a job, or a test) while still
 * giving the audit row its actor, IP, and method/path. The HTTP controller is the only
 * thing that knows about `Request`; the rest of the codebase just passes primitives.
 */
export interface AuditContext {
  /** Null for system jobs or unauthenticated failed-login attempts. */
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRoles: readonly Role[];
  requestMethod: string | null;
  requestPath: string | null;
  requestIp: string | null;
  userAgent: string | null;
}

/** For scheduled jobs and the seeder — no actor, no HTTP. */
export const SYSTEM_AUDIT_CONTEXT: AuditContext = {
  actorId: null,
  actorName: 'System',
  actorEmail: null,
  actorRoles: [],
  requestMethod: null,
  requestPath: null,
  requestIp: null,
  userAgent: null,
};

/**
 * Build an `AuditContext` from a logged-in request. Use this for every mutation handler that
 * already has `req.user` populated by the global JWT guard.
 */
export function auditContextFromRequest(
  req: Request,
  user: RequestUser | null,
): AuditContext {
  return {
    actorId: user?.id ?? null,
    // Not on RequestUser — the JWT carries sub/email/roles and no name. Left null on
    // purpose: the audit insert resolves it from `actor_id` (see audit.repository.ts).
    // Do NOT "fix" this by passing whatever name happens to be in scope at the call site;
    // thirteen services did exactly that and wrote the *subject's* name into the actor column.
    actorName: null,
    actorEmail: user?.email ?? null,
    actorRoles: user?.roles ?? [],
    requestMethod: req.method ?? null,
    requestPath: sanitiseRequestPath(req.originalUrl ?? req.url ?? null),
    requestIp: extractRequestIp(req),
    userAgent: sanitiseUserAgent(
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    ),
  };
}

/**
 * Build an `AuditContext` for a failed login. There is no authenticated user yet — the
 * "actor" is whoever tried. We deliberately keep the *attempted* email so a brute-force
 * pattern is auditable, but never the password, and the row never gets an `actor_id`.
 */
export function auditContextForFailedLogin(
  req: Request,
  attemptedEmail: string | null,
): AuditContext {
  return {
    actorId: null,
    actorName: null,
    actorEmail: attemptedEmail,
    actorRoles: [],
    requestMethod: req.method ?? null,
    requestPath: sanitiseRequestPath(req.originalUrl ?? req.url ?? null),
    requestIp: extractRequestIp(req),
    userAgent: sanitiseUserAgent(
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    ),
  };
}

/**
 * IPv4/IPv6 shapes that Postgres `inet` will accept. Deliberately conservative: anything this
 * does not recognise is stored as NULL rather than handed to the database.
 */
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

/**
 * The client's IP, as resolved by Express.
 *
 * We do NOT read `x-forwarded-for` here. `main.ts` already sets `trust proxy: 1`, which makes
 * `req.ip` the rightmost untrusted entry — the address the single TLS-terminating proxy
 * actually saw. Reading the raw header and taking the *leftmost* entry undid that: Caddy
 * appends to the chain, so the leftmost value is whatever the caller typed.
 *
 * That was worse than a wrong log line. `request_ip` is an `inet` column, so a header of
 * `X-Forwarded-For: x` made the INSERT fail with 22P02, and because an audit failure inside a
 * transaction rolls the mutation back, one header turned every audited mutation in the system
 * into a 500. Hence the validation below: a value we cannot vouch for is NULL, never an error.
 */
function extractRequestIp(req: Request): string | null {
  const candidate = (req.ip ?? req.socket?.remoteAddress ?? '').trim();
  if (!candidate) return null;

  // Express reports IPv4-mapped IPv6 for local sockets; `inet` accepts the unwrapped form.
  const unmapped = candidate.startsWith('::ffff:') ? candidate.slice('::ffff:'.length) : candidate;
  if (IPV4.test(unmapped) || IPV6.test(unmapped)) return unmapped;
  return null;
}
