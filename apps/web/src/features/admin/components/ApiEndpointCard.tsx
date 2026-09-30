import { IDEMPOTENCY_HEADER, type ApiEndpointDoc, type ApiParamDoc } from '@ims/shared';
import { t } from '@/i18n/en';
import { CopyableSnippet } from './CopyableSnippet';

interface ApiEndpointCardProps {
  endpoint: ApiEndpointDoc;
  basePath: string;
  /** The copy-paste call for an endpoint that changes data; null for a read. */
  example: string | null;
}

/** `name (type)`, with required fields marked — the example body is built from those. */
function describeParams(params: readonly ApiParamDoc[]): string {
  return params
    .map(
      (param) =>
        `${param.name} (${param.type}${param.required ? `, ${t.apiKeys.usageRequired}` : ''})`,
    )
    .join(', ');
}

/** One endpoint a key can call, as the server's route table reported it. */
export function ApiEndpointCard({ endpoint, basePath, example }: ApiEndpointCardProps) {
  return (
    <li className="rounded-[--radius-control] border border-border p-3">
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-brand-subtle px-1.5 py-0.5 font-mono text-2xs font-semibold text-brand">
          {endpoint.method}
        </span>
        <code className="font-mono text-xs text-ink">
          {basePath}
          {endpoint.path}
        </code>
        <span className="text-2xs text-ink-subtle">
          {t.apiKeys.usageScope}: <code className="font-mono">{endpoint.scope}</code>
        </span>
      </p>
      <p className="mt-1 text-xs text-ink-muted">{endpoint.summary}</p>
      <p className="mt-1.5 text-2xs text-ink-subtle">
        <span className="font-medium">{t.apiKeys.usageParams}: </span>
        {endpoint.queryParams.length === 0
          ? t.apiKeys.usageNoParams
          : describeParams(endpoint.queryParams)}
      </p>
      {endpoint.bodyParams.length > 0 ? (
        <p className="mt-1 text-2xs text-ink-subtle">
          <span className="font-medium">{t.apiKeys.usageBodyParams}: </span>
          {describeParams(endpoint.bodyParams)}
        </p>
      ) : null}
      {endpoint.requiresIdempotencyKey ? (
        <p className="mt-1.5 rounded-[--radius-control] bg-info-subtle px-2 py-1.5 text-2xs text-info">
          {t.apiKeys.usageIdempotency.replace('{header}', IDEMPOTENCY_HEADER)}
        </p>
      ) : null}
      {example ? (
        <div className="mt-2">
          <CopyableSnippet
            title={t.apiKeys.usageWriteExample}
            text={example}
            headingLevel={4}
            copyLabel={`${t.apiKeys.copy} ${endpoint.method} ${endpoint.path}`}
          />
        </div>
      ) : null}
    </li>
  );
}
