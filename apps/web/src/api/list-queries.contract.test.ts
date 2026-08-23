import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import {
  listDepartmentsQuerySchema,
  listProductsQuerySchema,
  listUsersQuerySchema,
} from '@ims/shared';
import { AUDIT_ACTOR_QUERY } from '@/features/admin/pages/AuditLogPage';
import { APPROVER_QUERY } from '@/features/admin/pages/SettingsPage';
import { ALL_DEPARTMENTS_QUERY } from '@/features/admin/pages/UsersPage';
import {
  CATALOGUE_QUERY,
  DEPARTMENTS_QUERY,
} from '@/features/requisitions/pages/RequisitionFormPage';

/**
 * A fixed query object is typed `ListProductsQuery` and type-checks, but the type is
 * `z.infer<>` of the schema — it carries the *shape*, never the bounds. `limit: 200` against a
 * `max(PAGINATION_MAX_LIMIT)` of 100 compiles clean and 400s at runtime on every single load
 * (D-002: the requisition item picker was starved from 29 July). Nothing in the repo checked a
 * client query object against the contract it is bound by; this does.
 *
 * Parse, do not "validate": `paginationQuerySchema` coerces and defaults, so a constant that
 * parses to something other than what it says would also be a defect worth seeing.
 */
const REGISTERED_QUERIES: Array<{ name: string; query: unknown; schema: ZodTypeAny }> = [
  { name: 'CATALOGUE_QUERY', query: CATALOGUE_QUERY, schema: listProductsQuerySchema },
  { name: 'DEPARTMENTS_QUERY', query: DEPARTMENTS_QUERY, schema: listDepartmentsQuerySchema },
  { name: 'ALL_DEPARTMENTS_QUERY', query: ALL_DEPARTMENTS_QUERY, schema: listDepartmentsQuerySchema },
  { name: 'APPROVER_QUERY', query: APPROVER_QUERY, schema: listUsersQuerySchema },
  // Populates the audit page's *actor* filter, so it is a users query, not an audit query.
  { name: 'AUDIT_ACTOR_QUERY', query: AUDIT_ACTOR_QUERY, schema: listUsersQuerySchema },
];

describe('client list-query constants', () => {
  it.each(REGISTERED_QUERIES)('$name satisfies the schema the endpoint parses it with', ({ query, schema }) => {
    const result = schema.safeParse(query);

    expect(result.success ? null : result.error.issues).toBeNull();
  });

  it.each(REGISTERED_QUERIES)('$name round-trips: what it declares is what the API receives', ({ query, schema }) => {
    // A coerced or defaulted difference means the constant does not say what it does.
    expect(schema.parse(query)).toMatchObject(query as Record<string, unknown>);
  });
});

/**
 * The registry above is only as good as its completeness, and a list someone has to remember to
 * append to is the gap that let D-002 live for four weeks. Every module-level `*_QUERY` constant
 * under `apps/web/src` must appear above — add it, or the endpoint it is bound by has no check.
 */
// vitest runs with the workspace package as its cwd (`apps/web`), per vitest.config.ts.
const WEB_SRC = join(process.cwd(), 'src');
const QUERY_CONSTANT = /^(?:export )?const ([A-Z][A-Z0-9_]*QUERY) =/gm;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe('the registry is complete', () => {
  it('has an entry for every `*_QUERY` constant declared under apps/web/src', () => {
    const declared = sourceFiles(WEB_SRC).flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(QUERY_CONSTANT)].map((match) => match[1]),
    );
    const registered = REGISTERED_QUERIES.map((entry) => entry.name);

    expect(declared.length).toBeGreaterThan(0);
    expect([...new Set(declared)].sort()).toEqual([...registered].sort());
  });
});
