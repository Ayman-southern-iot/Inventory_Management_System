import {
  SetMetadata,
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { z } from 'zod';
import type { ApiKeyScope } from '@ims/shared';
import type { AppConfig } from '../../config';

export const API_KEY_SCOPES_KEY = 'ims:apiKeyScopes';
/** A one-line description of the route, shown on the generated usage page. */
export const API_KEY_SUMMARY_KEY = 'ims:apiKeySummary';
/** The route's query schema, so the usage page can list its parameters. */
export const API_KEY_QUERY_KEY = 'ims:apiKeyQuery';
/** The route's JSON body schema, so the usage page can list its fields (ADR-0002). */
export const API_KEY_BODY_KEY = 'ims:apiKeyBody';
/** The route refuses a request without an `Idempotency-Key` header. */
export const API_KEY_IDEMPOTENT_KEY = 'ims:apiKeyIdempotent';
/** A feature-flag predicate; the usage page leaves the route out while it is false. */
export const API_KEY_ENABLED_KEY = 'ims:apiKeyEnabled';

export interface ApiKeyRouteOptions {
  /**
   * Not decoration. This is rendered on the admin panel's usage page, which is generated from
   * these decorators rather than written by hand, so integrating against this API never means
   * reading the codebase. Write it for somebody who has never seen the system.
   */
  summary: string;
  scopes: ApiKeyScope[];
  /**
   * The same zod schema the route validates with. Passing it lets the usage page list the real
   * query parameters; leaving it out simply lists none. It is never a second declaration — the
   * schema is written once and referenced here.
   */
  query?: z.ZodObject<z.ZodRawShape>;
  /** The body schema the route validates with, for the same reason. Refined schemas are fine. */
  body?: z.ZodTypeAny;
  /**
   * Documentation only: tells the integrator the route demands an `Idempotency-Key`. The route
   * itself is what refuses a request without one — this does not enforce anything.
   */
  requiresIdempotencyKey?: boolean;
  /**
   * For a route behind a release flag. The usage page omits the route while this returns false,
   * so it never advertises what the API would refuse. Read against the injected config, so a
   * test app built with a different CONFIG sees its own answer. Does not gate the route.
   */
  isEnabled?: (config: AppConfig) => boolean;
}

/**
 * Opens a route to API keys holding any of the named scopes.
 *
 * **Default-deny: a route without this decorator is unreachable by a key**, exactly as a route
 * without `@Public()` is unreachable without authentication. That is the whole safety property
 * of this feature — forgetting the decorator produces a 403, never an exposure — so there is
 * deliberately no "allow all" variant and no wildcard scope.
 *
 * Metadata only, no guard attached. The check lives inside `JwtAuthGuard`, immediately after
 * the key is authenticated, for one reason: a second global guard would have to run *after*
 * the authenticating one to see `request.apiKey`, and the relative order of global guards is a
 * function of module registration rather than anything declared. A route left open because
 * somebody reordered an import is precisely the failure this feature cannot have. One guard,
 * one decision, no ordering to get wrong.
 */
export const ApiKeyScopes = (options: ApiKeyRouteOptions) =>
  applyDecorators(
    SetMetadata(API_KEY_SCOPES_KEY, options.scopes),
    SetMetadata(API_KEY_SUMMARY_KEY, options.summary),
    SetMetadata(API_KEY_QUERY_KEY, options.query),
    SetMetadata(API_KEY_BODY_KEY, options.body),
    SetMetadata(API_KEY_IDEMPOTENT_KEY, options.requiresIdempotencyKey ?? false),
    SetMetadata(API_KEY_ENABLED_KEY, options.isEnabled),
  );

/**
 * The API key that authenticated this request, or null for a session.
 *
 * For the rare route that must answer a key differently from a person — today only
 * `GET /products/:id`, which withholds who is borrowing what (K2). Reads what `JwtAuthGuard`
 * set, which by the time a handler runs it always has.
 */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { id: string } | null =>
    ctx.switchToHttp().getRequest<{ apiKey?: { id: string } }>().apiKey ?? null,
);
