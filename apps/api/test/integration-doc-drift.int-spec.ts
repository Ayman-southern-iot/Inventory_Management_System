import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiKeyDocsService } from '../src/modules/api-keys/api-key-docs.service';
import { createTestApp, type TestApp } from './app';

/**
 * `docs/reference/15-integration-api.md` tells integrators "if this document and the admin page
 * disagree, the page is right". That is only honest if they cannot drift unnoticed. This test
 * reads the scope → route table in §15.4 and compares it, pair by pair, with what the admin usage
 * page is generated from — `ApiKeyDocsService`, which walks the live route table for
 * `@ApiKeyScopes`. Open a route to keys, or move it to another scope, and this fails until the
 * doc says so too.
 *
 * Built with `ALLOW_DIRECT_TAKE` on: the usage page hides a switched-off route, and the table
 * documents `POST /stock/take` (marked "only while ALLOW_DIRECT_TAKE=true").
 */
const DOC = resolve(__dirname, '..', '..', '..', 'docs', 'reference', '15-integration-api.md');

/** Every `scope METHOD /path` the §15.4 table claims. */
function documentedPairs(): string[] {
  const doc = readFileSync(DOC, 'utf8');
  const start = doc.indexOf('### 15.4');
  const end = doc.indexOf('### 15.5');
  expect(start, '§15.4 heading not found').toBeGreaterThan(-1);
  expect(end, '§15.5 heading not found').toBeGreaterThan(start);

  const pairs: string[] = [];
  for (const line of doc.slice(start, end).split('\n')) {
    const row = /^\|\s*`([a-z]+:[a-z]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (!row) continue;
    for (const route of row[2]!.matchAll(/`(GET|POST|PATCH|PUT|DELETE) (\/[^`]*)`/g)) {
      pairs.push(`${row[1]} ${route[1]} ${route[2]}`);
    }
  }
  return pairs.sort();
}

describe('integration doc §15.4 matches the routes keys can reach', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp({ directTake: { isEnabled: true } });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('lists exactly the scope → route pairs the admin usage page is generated from', () => {
    const registered = ctx.app
      .get(ApiKeyDocsService, { strict: false })
      .build()
      .endpoints.map((e) => `${e.scope} ${e.method} ${e.path}`)
      .sort();

    const documented = documentedPairs();
    // Sanity: the parser found the table rather than an empty section.
    expect(documented.length).toBeGreaterThan(10);
    expect(documented).toEqual(registered);
  });
});
