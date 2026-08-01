import { Throttle } from '@nestjs/throttler';
import { config } from '../config';

/**
 * Shared throttler decorator bundles. Each named tier is configured in `config.throttling.*`
 * and read once at module load; the throttler module is constructed from the same source.
 *
 * - `AuthenticatedThrottle` — the default for any authenticated route that doesn't declare a
 *   stricter tier. Applied at the controller class level so every handler inherits it.
 * - `authThrottle` — for credential-bearing endpoints (login, refresh, password change, …
 *   the auth controller wraps it). Login adds `loginBurst` on top via a second decorator key.
 * - `publicThrottle` — for routes reachable without a session (`/health`, BOM PDF download).
 *   These still get a ceiling; `@Public()` is about authentication, not absence of limits.
 *
 * Why class-level decorators: keeps the throttle declaration next to the existing `@Roles`
 * pattern and avoids 70+ per-handler duplications. A handler-level `@Throttle(...)` overrides
 * the class-level for that one route, so the BOM controller can mix `public` (PDF download)
 * and `authenticated` (everything else) without splitting controllers.
 */

const ms = (s: number): number => s * 1000;

/**
 * The default authenticated ceiling. Decoration order in Nest does not matter for metadata —
 * the handler-level `@Throttle` overrides the class-level by name.
 */
export const AuthenticatedThrottle = Throttle({
  authenticated: {
    limit: config.throttling.authenticated.limit,
    ttl: ms(config.throttling.authenticated.ttlSeconds),
  },
});

/** Strict tier for credential-bearing endpoints. */
export const authThrottle = Throttle({
  auth: { limit: config.throttling.auth.limit, ttl: ms(config.throttling.auth.ttlSeconds) },
});

/** Moderate tier for routes reachable without a session. */
export const publicThrottle = Throttle({
  public: { limit: config.throttling.public.limit, ttl: ms(config.throttling.public.ttlSeconds) },
});

/**
 * The login-specific decorator: `auth` ceiling layered with `loginBurst`. Both are evaluated
 * per request; either tripping produces its own `Retry-After-{name}` header.
 */
export const loginBurstThrottle = Throttle({
  auth: { limit: config.throttling.auth.limit, ttl: ms(config.throttling.auth.ttlSeconds) },
  loginBurst: {
    limit: config.throttling.loginBurst.limit,
    ttl: ms(config.throttling.loginBurst.ttlSeconds),
  },
});
