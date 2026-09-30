import {
  IDEMPOTENCY_HEADER,
  type ApiEndpointDoc,
  type ApiKeyUsageDoc,
  type ApiParamDoc,
} from '@ims/shared';

/**
 * The copy-paste calls on the usage panel, built from the generated usage document.
 *
 * Pure, so the rules that matter are testable without rendering: a key in the URL is only ever
 * shown against a GET, and a write example carries every header the route demands.
 *
 * The API refuses `?api_key=` (API_KEY_QUERY_NOT_ALLOWED) on any method but GET, and for any key
 * holding a write scope even on a GET. The first half is enforced here; the second depends on the
 * key, which the usage panel does not have, so the panel states it beside the URL instead.
 */

/** The only method a key may be presented in the URL for. */
const READ_METHOD = 'GET';
const AUTH_HEADER_NAME = 'Authorization: Bearer';
const JSON_CONTENT_TYPE_HEADER = 'Content-Type: application/json';
/** Stands in for the secret. Recognisably not a real key, and it keeps the real prefix. */
const KEY_PLACEHOLDER = 'your_key_here';
/** Stands in for the fresh UUID the caller generates once per operation. */
const IDEMPOTENCY_PLACEHOLDER = '<uuid>';
/** The pagination parameter the read example demonstrates, when the endpoint has one. */
const PAGE_LIMIT_PARAM = 'limit';
/** Line continuation for a multi-line shell command. */
const CONTINUATION = ' \\\n  ';

/**
 * Example values by the type names the server's docs builder emits (`zodTypeName`). A `Map`, not
 * an object literal, so a type name can never resolve to something on `Object.prototype`.
 * Anything not listed — string, enum, uuid-as-string — is shown as `"<fieldName>"`.
 */
const EXAMPLE_BY_TYPE: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['number', 1],
  ['boolean', true],
  ['array', []],
  ['object', {}],
]);

export const isReadEndpoint = (endpoint: ApiEndpointDoc): boolean =>
  endpoint.method === READ_METHOD;

/**
 * The richest GET endpoint, not the first one. Sorted alphabetically, `/categories` comes first
 * and makes a poor example — nobody's first question is "show me the category tree". The one
 * with the most query parameters lands on the product list without naming it, so this stays
 * right as the route list grows. Undefined only if the API exposes no GET to keys at all.
 */
export function richestReadEndpoint(
  endpoints: readonly ApiEndpointDoc[],
): ApiEndpointDoc | undefined {
  return endpoints
    .filter(isReadEndpoint)
    .sort((a, b) => b.queryParams.length - a.queryParams.length || a.path.length - b.path.length)[0];
}

function bearer(usage: ApiKeyUsageDoc): string {
  return `-H "${AUTH_HEADER_NAME} ${usage.tokenPrefix}${KEY_PLACEHOLDER}"`;
}

/** A GET with the key in the header — the right way for anything automated. */
export function readExample(usage: ApiKeyUsageDoc, baseUrl: string, endpoint: ApiEndpointDoc) {
  const paged = endpoint.queryParams.some((param) => param.name === PAGE_LIMIT_PARAM);
  const query = paged ? `?${PAGE_LIMIT_PARAM}=${usage.maxPageSize}` : '';
  return `curl ${bearer(usage)}${CONTINUATION}"${baseUrl}${endpoint.path}${query}"`;
}

/** The same GET as a plain URL for an address bar. Never built for any other method. */
export function browserExample(usage: ApiKeyUsageDoc, baseUrl: string, endpoint: ApiEndpointDoc) {
  if (!isReadEndpoint(endpoint)) return null;
  return `${baseUrl}${endpoint.path}?${usage.queryParam}=${usage.tokenPrefix}${KEY_PLACEHOLDER}`;
}

/**
 * The fields the example body carries: the required ones. A PATCH whose fields are all optional
 * ("send only the fields you are changing") gets its first field instead, because `{}` would
 * demonstrate a request that changes nothing.
 */
function exampleFields(params: readonly ApiParamDoc[]): readonly ApiParamDoc[] {
  const required = params.filter((param) => param.required);
  return required.length > 0 ? required : params.slice(0, 1);
}

export function exampleBody(params: readonly ApiParamDoc[]): string {
  const body = Object.fromEntries(
    exampleFields(params).map((param) => [
      param.name,
      EXAMPLE_BY_TYPE.has(param.type) ? EXAMPLE_BY_TYPE.get(param.type) : `<${param.name}>`,
    ]),
  );
  return JSON.stringify(body);
}

/** A call that changes data: the method, the JSON body, and the idempotency header if demanded. */
export function writeExample(usage: ApiKeyUsageDoc, baseUrl: string, endpoint: ApiEndpointDoc) {
  const parts = [`curl -X ${endpoint.method}`, bearer(usage), `-H "${JSON_CONTENT_TYPE_HEADER}"`];
  if (endpoint.requiresIdempotencyKey) {
    parts.push(`-H "${IDEMPOTENCY_HEADER}: ${IDEMPOTENCY_PLACEHOLDER}"`);
  }
  parts.push(`-d '${exampleBody(endpoint.bodyParams)}'`, `"${baseUrl}${endpoint.path}"`);
  return parts.join(CONTINUATION);
}
