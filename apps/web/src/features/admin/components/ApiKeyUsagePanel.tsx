import { useMemo } from 'react';
import { AlertTriangle, Copy } from 'lucide-react';
import type { ApiKeyUsageDoc } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

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
  const copy = useCopyToClipboard();
  const baseUrl = `${window.location.origin}${usage.basePath}`;
  /*
   * The richest endpoint, not the first one. Sorted alphabetically, `/categories` comes first
   * and makes a poor example — nobody's first question is "show me the category tree". The
   * endpoint with the most query parameters is the one worth demonstrating, and it lands on
   * the product list without naming it, so this stays right as the route list grows.
   */
  const example = useMemo(() => {
    const richest = [...usage.endpoints].sort(
      (a, b) => b.queryParams.length - a.queryParams.length || a.path.length - b.path.length,
    )[0];
    const path = richest?.path ?? '/products';
    const paged = richest?.queryParams.some((param) => param.name === 'limit');
    return `curl -H "Authorization: Bearer ${usage.tokenPrefix}your_key_here" \\\n  "${baseUrl}${path}${paged ? '?limit=100' : ''}"`;
  }, [usage.endpoints, usage.tokenPrefix, baseUrl]);

  /** The same call as a plain URL, for pasting into an address bar. */
  const browserUrl = useMemo(() => {
    const richest = [...usage.endpoints].sort(
      (a, b) => b.queryParams.length - a.queryParams.length || a.path.length - b.path.length,
    )[0];
    const path = richest?.path ?? '/products';
    return `${baseUrl}${path}?${usage.queryParam}=${usage.tokenPrefix}your_key_here`;
  }, [usage.endpoints, usage.queryParam, usage.tokenPrefix, baseUrl]);

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

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {t.apiKeys.usageExample}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            icon={<Copy aria-hidden className="size-4" />}
            onClick={() => void copy(example)}
          >
            {t.apiKeys.copy}
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-[--radius-control] bg-surface-muted p-3 font-mono text-xs text-ink">
          {example}
        </pre>
      </section>

      {/*
        Ayman chose the URL form over a header extension after the trade-off was put to him. It
        is shown with the reason it is the riskier option attached, and directly under the
        header example rather than instead of it — the warning belongs where the copy button is,
        not in a document nobody opens twice.
      */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {t.apiKeys.usageBrowser}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            icon={<Copy aria-hidden className="size-4" />}
            onClick={() => void copy(browserUrl)}
          >
            {t.apiKeys.copy}
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-[--radius-control] bg-surface-muted p-3 font-mono text-xs text-ink">
          {browserUrl}
        </pre>
        <p className="flex items-start gap-1.5 rounded-[--radius-control] bg-pending-subtle px-3 py-2 text-xs text-ink">
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0" />
          {t.apiKeys.usageBrowserBody}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          {t.apiKeys.usageEndpoints}
        </h3>
        <ul className="flex flex-col gap-2">
          {usage.endpoints.map((endpoint) => (
            <li
              key={`${endpoint.method} ${endpoint.path}`}
              className="rounded-[--radius-control] border border-border p-3"
            >
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="rounded bg-brand-subtle px-1.5 py-0.5 font-mono text-2xs font-semibold text-brand">
                  {endpoint.method}
                </span>
                <code className="font-mono text-xs text-ink">
                  {usage.basePath}
                  {endpoint.path}
                </code>
              </p>
              <p className="mt-1 text-xs text-ink-muted">{endpoint.summary}</p>
              <p className="mt-1.5 text-2xs text-ink-subtle">
                <span className="font-medium">{t.apiKeys.usageParams}: </span>
                {endpoint.queryParams.length === 0
                  ? t.apiKeys.usageNoParams
                  : endpoint.queryParams
                      .map((param) => `${param.name} (${param.type})`)
                      .join(', ')}
              </p>
            </li>
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
        </ul>
      </section>
    </div>
  );
}
