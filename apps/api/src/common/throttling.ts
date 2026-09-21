import { applyDecorators, type ExecutionContext } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { API_KEY_TOKEN_PREFIX } from '@ims/shared';
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
 * Every tier named in `ThrottlerModule.forRoot` is evaluated on EVERY route unless that route
 * skips it by name. `@Throttle({ authenticated: … })` replaces the limit of the `authenticated`
 * tier for this route; it says nothing about the other three, which keep counting.
 *
 * That is how the 10/60s credential ceiling came to apply to ordinary reads: an authenticated
 * route declared its own `authenticated` limit of 300 and was still refused on the eleventh
 * request of the minute by `auth`. It was never visible in a test because the only coverage
 * fired a single request.
 *
 * So each tier below names the ones it is NOT. A route belongs to exactly one ceiling, and
 * adding a tier to `throttlerOptions` without adding it here silently applies it everywhere —
 * which is the trap this helper now exists to close.
 */
const only = (...active: readonly string[]) =>
  SkipThrottle(
    Object.fromEntries(
      (['auth', 'public', 'authenticated', 'apiKey', 'loginBurst'] as const)
        .filter((tier) => !active.includes(tier))
        .map((tier) => [tier, true]),
    ),
  );

/**
 * Is this request presenting an API key rather than a session?
 *
 * Decided from the **raw header**, not from `request.apiKey`, and that is deliberate. Both the
 * throttler and the auth guard are global guards, and their relative order is a function of
 * module registration rather than anything declared — reading state the auth guard may not have
 * written yet would work until someone reorders an import. The prefix is syntax; it needs no
 * validation to read, and a string that merely *looks* like a key is exactly what we want held
 * to the tighter ceiling, since that is what a brute-force against key values looks like.
 */
export const isApiKeyRequest = (context: ExecutionContext): boolean => {
  const request = context.switchToHttp().getRequest<{ headers?: { authorization?: string } }>();
  return request.headers?.authorization?.startsWith(`Bearer ${API_KEY_TOKEN_PREFIX}`) ?? false;
};

/**
 * The default authenticated ceiling. Decoration order in Nest does not matter for metadata —
 * the handler-level `@Throttle` overrides the class-level by name.
 */
export const AuthenticatedThrottle = applyDecorators(
  Throttle({
    authenticated: {
      limit: config.throttling.authenticated.limit,
      ttl: ms(config.throttling.authenticated.ttlSeconds),
    },
    apiKey: {
      limit: config.throttling.apiKey.limit,
      ttl: ms(config.throttling.apiKey.ttlSeconds),
    },
  }),
  /**
   * Both ceilings are declared; exactly one applies. The tiers carry `skipIf` in
   * `app.module.ts`, so a session is measured against `authenticated` and a key against the
   * lower `apiKey` — a per-caller limit, which a per-route tier alone cannot express.
   */
  only('authenticated', 'apiKey'),
);

/** Strict tier for credential-bearing endpoints. */
export const authThrottle = applyDecorators(
  Throttle({
    auth: { limit: config.throttling.auth.limit, ttl: ms(config.throttling.auth.ttlSeconds) },
  }),
  only('auth'),
);

/** Moderate tier for routes reachable without a session. */
export const publicThrottle = applyDecorators(
  Throttle({
    public: { limit: config.throttling.public.limit, ttl: ms(config.throttling.public.ttlSeconds) },
  }),
  only('public'),
);

/**
 * The login-specific decorator: `auth` ceiling layered with `loginBurst`. Both are evaluated
 * per request; either tripping produces its own `Retry-After-{name}` header.
 */
export const loginBurstThrottle = applyDecorators(
  Throttle({
    auth: { limit: config.throttling.auth.limit, ttl: ms(config.throttling.auth.ttlSeconds) },
    loginBurst: {
      limit: config.throttling.loginBurst.limit,
      ttl: ms(config.throttling.loginBurst.ttlSeconds),
    },
  }),
  only('auth', 'loginBurst'),
);
