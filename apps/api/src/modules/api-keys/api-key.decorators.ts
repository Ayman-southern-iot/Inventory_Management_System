import { SetMetadata, applyDecorators } from '@nestjs/common';
import type { z } from 'zod';
import type { ApiKeyScope } from '@ims/shared';

export const API_KEY_SCOPES_KEY = 'ims:apiKeyScopes';
/** A one-line description of the route, shown on the generated usage page. */
export const API_KEY_SUMMARY_KEY = 'ims:apiKeySummary';
/** The route's query schema, so the usage page can list its parameters. */
export const API_KEY_QUERY_KEY = 'ims:apiKeyQuery';

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
  );
