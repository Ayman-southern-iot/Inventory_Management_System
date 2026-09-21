import { Inject, Injectable, RequestMethod } from '@nestjs/common';
// Not re-exported from the package root, only from this subpath. Importing the constants beats
// hardcoding 'path' and 'method' — if Nest ever changes them, this breaks at build rather than
// silently returning an empty endpoint list.
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import {
  API_KEY_TOKEN_PREFIX,
  PAGINATION_MAX_LIMIT,
  type ApiEndpointDoc,
  type ApiKeyScope,
  type ApiKeyUsageDoc,
} from '@ims/shared';
import type { z } from 'zod';
import { CONFIG, type AppConfig } from '../../config';
import {
  API_KEY_QUERY_KEY,
  API_KEY_SCOPES_KEY,
  API_KEY_SUMMARY_KEY,
} from './api-key.decorators';

/**
 * Builds the "how to use this key" document from the **live route table**.
 *
 * Ayman's ask, in his words: "there should be also a instruction auto generated ... so that we
 * dont have to search codebase again". Hand-written integration docs are wrong the first time
 * somebody renames a query parameter, and nobody notices until an integration breaks. These are
 * derived: decorate a route with `@ApiKeyScopes` and it appears here; remove the decorator and
 * it disappears. The document and the guard read the same metadata, so they cannot disagree
 * about what a key can reach.
 *
 * The host is deliberately absent — the admin page composes it from the browser's own origin,
 * which is always right for whoever is reading the page and costs no config key.
 */
@Injectable()
export class ApiKeyDocsService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  build(): ApiKeyUsageDoc {
    return {
      basePath: `/${this.config.http.globalPrefix}`.replace(/\/+/g, '/').replace(/\/$/, ''),
      authHeader: 'Authorization: Bearer <key>',
      tokenPrefix: API_KEY_TOKEN_PREFIX,
      rateLimitPerMinute: this.config.throttling.apiKey.limit,
      maxPageSize: PAGINATION_MAX_LIMIT,
      endpoints: this.collect(),
    };
  }

  private collect(): ApiEndpointDoc[] {
    const endpoints: ApiEndpointDoc[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      const { instance } = wrapper;
      if (!instance) continue;

      const controllerPath = Reflect.getMetadata(PATH_METADATA, wrapper.metatype ?? {}) as
        | string
        | undefined;

      const prototype = Object.getPrototypeOf(instance) as object;
      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const handler = (instance as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;

        const scopes = Reflect.getMetadata(API_KEY_SCOPES_KEY, handler) as
          | ApiKeyScope[]
          | undefined;
        if (!scopes || scopes.length === 0) continue;

        const summary = (Reflect.getMetadata(API_KEY_SUMMARY_KEY, handler) as string) ?? '';
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        const routePath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const query = Reflect.getMetadata(API_KEY_QUERY_KEY, handler) as
          | z.ZodObject<z.ZodRawShape>
          | undefined;

        for (const scope of scopes) {
          endpoints.push({
            method: RequestMethod[verb ?? RequestMethod.GET],
            path: joinPath(controllerPath, routePath),
            scope,
            summary,
            queryParams: describeQuery(query),
          });
        }
      }
    }

    return endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  }
}

/**
 * The route's query parameters, read off the same zod schema the route validates with.
 *
 * `_def.typeName` rather than `instanceof`: zod is resolved through pnpm and a schema built in
 * `@ims/shared` is not necessarily an instance of the `ZodOptional` this file imported. Reading
 * the discriminant is version-proof where an identity check is not.
 */
function describeQuery(
  schema: z.ZodObject<z.ZodRawShape> | undefined,
): ApiEndpointDoc['queryParams'] {
  if (!schema) return [];
  return Object.entries(schema.shape).map(([name, field]) => ({
    name,
    type: zodTypeName(field),
    // A field with a default is not something the caller has to send.
    required: !field.isOptional() && !hasDefault(field),
  }));
}

function unwrap(field: z.ZodTypeAny): z.ZodTypeAny {
  const typeName = (field._def as { typeName?: string }).typeName;
  if (
    typeName === 'ZodOptional' ||
    typeName === 'ZodNullable' ||
    typeName === 'ZodDefault' ||
    typeName === 'ZodEffects'
  ) {
    const inner = (field._def as { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny });
    const next = inner.innerType ?? inner.schema;
    return next ? unwrap(next) : field;
  }
  return field;
}

function hasDefault(field: z.ZodTypeAny): boolean {
  return (field._def as { typeName?: string }).typeName === 'ZodDefault';
}

/** `ZodString` becomes `string` — the name an integrator recognises, not zod's. */
function zodTypeName(field: z.ZodTypeAny): string {
  const inner = unwrap(field);
  const typeName = (inner._def as { typeName?: string }).typeName ?? 'ZodUnknown';

  /*
   * `queryBoolean` is `union([boolean, string])` with a transform, because a query string
   * arrives as text and `z.coerce.boolean()` reads "false" as true. Reporting that union
   * verbatim — "boolean | string" — is accurate and useless: the caller sends
   * `?includeInactive=true` and needs to be told "boolean", not shown the shape of our parser.
   */
  if (typeName === 'ZodUnion') {
    const options = ((inner._def as { options?: z.ZodTypeAny[] }).options ?? []).map(zodTypeName);
    if (options.includes('boolean')) return 'boolean';
    return [...new Set(options)].join(' | ');
  }

  return typeName.replace(/^Zod/, '').toLowerCase();
}

/** `products` + `:id` becomes `/products/:id`; an empty segment contributes nothing. */
function joinPath(controllerPath: string | undefined, routePath: string | undefined): string {
  const segments = [controllerPath, routePath]
    .map((segment) => (segment ?? '').replace(/^\/+|\/+$/g, ''))
    .filter((segment) => segment.length > 0);
  return `/${segments.join('/')}`;
}
