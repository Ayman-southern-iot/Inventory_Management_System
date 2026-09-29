import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ApiKeyUsageDoc } from '@ims/shared';
import { t } from '@/i18n/en';
import { ApiEndpointCard } from './ApiEndpointCard';
import { CopyableSnippet } from './CopyableSnippet';
import {
  browserExample,
  isReadEndpoint,
  readExample,
  richestReadEndpoint,
  writeExample,
} from './api-key-usage-examples';

/**
 * How to use a key, generated rather than written.
 *
 * Ayman's ask, verbatim: "there should be also a instruction auto generated ... so that we dont
 * have to search codebase again". The endpoint list comes from the server, which builds it by
 * walking its own route table for `@ApiKeyScopes` metadata — the same metadata the auth guard
 * enforces. The two cannot disagree, and neither can go stale.
 *
 * The host is composed here from `window.location.origin` rather than sent by the server. The
 * page is being read in a browser that reached this deployment somehow, so its own origin is by
 * definition an address that works — and it costs no configuration key that somebody would have
 * to remember to set per environment.
 */
export function ApiKeyUsagePanel({ usage }: { usage: ApiKeyUsageDoc }) {
  const baseUrl = `${window.location.origin}${usage.basePath}`;

  // Read examples come from GET endpoints only: `?api_key=` is refused on every other method.
  const readEndpoint = useMemo(() => richestReadEndpoint(usage.endpoints), [usage.endpoints]);
  const example = readEndpoint ? readExample(usage, baseUrl, readEndpoint) : null;
  const browserUrl = readEndpoint ? browserExample(usage, baseUrl, readEndpoint) : null;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-ink-muted">{t.apiKeys.usageBody}</p>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          {t.apiKeys.usageAuth}
        </h3>
        <code className="block rounded-[--radius-control] bg-surface-muted px-3 py-2 font-mono text-xs text-ink">
          {usage.authHeader}
        </code>
      </section>

      {example ? <CopyableSnippet title={t.apiKeys.usageExample} text={example} /> : null}

      {/*
        Ayman chose the URL form over a header extension after the trade-off was put to him. It
        is shown with the reason it is the riskier option attached, and directly under the
        header example rather than instead of it — the warning belongs where the copy button is,
        not in a document nobody opens twice.

        Since the 2026-09-29 security review the URL form is for a read-only key only: the API
        refuses `?api_key=` for any key holding a write scope, even on a GET. This panel is not
        tied to one key, so it cannot hide the URL for a write key — it states the rule first,
        beside the URL it restricts.
      */}
      {browserUrl ? (
        <CopyableSnippet title={t.apiKeys.usageBrowser} text={browserUrl}>
          <p className="text-xs font-medium text-ink">{t.apiKeys.usageWriteKeyHeaderOnly}</p>
          <p className="flex items-start gap-1.5 rounded-[--radius-control] bg-pending-subtle px-3 py-2 text-xs text-ink">
            <AlertTriangle aria-hidden className="mt-px size-4 shrink-0" />
            {t.apiKeys.usageBrowserBody}
          </p>
        </CopyableSnippet>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          {t.apiKeys.usageEndpoints}
        </h3>
        <ul className="flex flex-col gap-2">
          {usage.endpoints.map((endpoint) => (
            <ApiEndpointCard
              // The server lists a route once per scope it accepts, so the scope is in the key.
              key={`${endpoint.method} ${endpoint.path} ${endpoint.scope}`}
              endpoint={endpoint}
              basePath={usage.basePath}
              example={isReadEndpoint(endpoint) ? null : writeExample(usage, baseUrl, endpoint)}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          {t.apiKeys.usageLimits}
        </h3>
        <ul className="list-inside list-disc text-xs text-ink-muted">
          <li>{t.apiKeys.usageRateLimit.replace('{n}', String(usage.rateLimitPerMinute))}</li>
          <li>{t.apiKeys.usagePageSize.replace('{n}', String(usage.maxPageSize))}</li>
          <li>
            {t.apiKeys.usageWriteLifetime.replace('{n}', String(usage.writeKeyMaxLifetimeDays))}
          </li>
        </ul>
      </section>
    </div>
  );
}
