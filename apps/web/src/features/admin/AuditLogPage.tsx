import { useEffect, useMemo, useState } from 'react';
import { Eye, RefreshCcw, Radio, X } from 'lucide-react';
import {
  AUDIT_ENTITY_TYPES,
  PAGINATION_DEFAULT_LIMIT,
  Role,
  type AuditEntry,
  type AuditEntityType,
  type AuditOutcome,
  type ListAuditQuery,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Badge, Pagination, Panel, PageHeader, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { t } from '@/i18n/en';
import { useAuditLog, useAuditLogEntry } from './api';

const ROLE_LABELS: Record<Role, string> = {
  ...t.roles,
};

/**
 * Admin-only page that shows every state-changing action taken in the system, newest first.
 * Polls every seven seconds while the page is visible; pauses in background tabs; and shows a
 * "new activity available" affordance when the user is on a paged-back view so we never move
 * their page out from under them.
 */
export function AuditLogPage() {
  const [page, setPage] = useState(1);
  // Three filters, matching the API contract: actor, entity, date range (the range is one
  // filter with two bounds). `action`, `outcome`, `ip` and free-text search were dropped —
  // see the note on `listAuditQuerySchema`.
  const [actorId, setActorId] = useState('');
  const [entityType, setEntityType] = useState<AuditEntityType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detailsFor, setDetailsFor] = useState<string | null>(null);

  const query = useMemo<ListAuditQuery>(
    () => ({
      page,
      limit: PAGINATION_DEFAULT_LIMIT,
      ...(actorId.trim() ? { actorId: actorId.trim() } : {}),
      ...(entityType ? { entityType } : {}),
      ...(from ? { from: new Date(from) } : {}),
      ...(to ? { to: new Date(to) } : {}),
    }),
    [page, actorId, entityType, from, to],
  );

  const audit = useAuditLog(query);

  // Auto-reset to page 1 whenever a filter changes — but not on page changes themselves.
  useEffect(() => {
    setPage(1);
  }, [actorId, entityType, from, to]);

  // A page-pinned user should not lose their view because new rows arrived. Detect fresh
  // entries only when the user is sitting on page 1.
  const tipNewActivity =
    page === 1 && Boolean(audit.dataUpdatedAt) && Boolean(audit.data?.items[0]);

  function clearFilters() {
    setActorId('');
    setEntityType('');
    setFrom('');
    setTo('');
  }

  const activeFilters =
    Number(Boolean(actorId.trim())) +
    Number(Boolean(entityType)) +
    Number(Boolean(from) || Boolean(to));

  return (
    <>
      <PageHeader
        title={t.auditLog.title}
        subtitle={t.auditLog.subtitle}
        action={
          <div className="flex items-center gap-2">
            <LiveIndicator />
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCcw aria-hidden className="size-4" />}
              onClick={() => void audit.refetch()}
            >
              {t.auditLog.refresh}
            </Button>
          </div>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-4 border-b border-border px-4 py-3">
          <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">{t.auditLog.filters.actor}</span>
              <input
                value={actorId}
                onChange={(event) => setActorId(event.target.value)}
                placeholder="uuid"
                className="rounded-[--radius-control] border border-border bg-surface px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">
                {t.auditLog.filters.entityType}
              </span>
              <select
                value={entityType}
                onChange={(event) => setEntityType(event.target.value as AuditEntityType | '')}
                className="rounded-[--radius-control] border border-border bg-surface px-2.5 py-1.5 text-sm"
              >
                <option value="">{t.auditLog.filters.any}</option>
                {AUDIT_ENTITY_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">{t.auditLog.filters.from}</span>
              <input
                type="datetime-local"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="rounded-[--radius-control] border border-border bg-surface px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">{t.auditLog.filters.to}</span>
              <input
                type="datetime-local"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="rounded-[--radius-control] border border-border bg-surface px-2.5 py-1.5 text-sm"
              />
            </label>
          </div>
          <div className="flex items-center gap-2 pb-1">
            <span className="text-xs text-ink-subtle">
              {t.auditLog.filters.activeFilters(activeFilters)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              disabled={activeFilters === 0}
              icon={<X aria-hidden className="size-4" />}
            >
              {t.auditLog.filters.clear}
            </Button>
          </div>
        </div>

        <QueryBoundary
          isLoading={audit.isPending}
          error={audit.error}
          data={audit.data}
          onRetry={() => void audit.refetch()}
          loadingFallback={<SkeletonRows columns={6} />}
          isEmpty={(data) => data.items.length === 0}
          emptyFallback={
            <EmptyState title={t.auditLog.emptyTitle} body={t.auditLog.emptyBody} />
          }
        >
          {(data) => (
            <>
              <Table
                headers={[
                  t.auditLog.columns.timestamp,
                  t.auditLog.columns.actor,
                  t.auditLog.columns.action,
                  t.auditLog.columns.entity,
                  t.auditLog.columns.summary,
                  t.auditLog.columns.outcome,
                  t.auditLog.columns.ip,
                  t.auditLog.columns.details,
                ]}
              >
                {data.items.map((entry) => (
                  <tr key={entry.id} className="hover:bg-surface-muted/50">
                    <td className="px-4 py-2.5 align-top">
                      <time
                        dateTime={entry.createdAt}
                        title={entry.createdAt}
                        className="whitespace-nowrap text-ink-muted"
                      >
                        {formatTimestamp(entry.createdAt)}
                      </time>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <ActorCell entry={entry} />
                    </td>
                    <td className="px-4 py-2.5 align-top text-ink-muted">{entry.action}</td>
                    <td className="px-4 py-2.5 align-top">
                      <p className="text-ink">{entry.entityType}</p>
                      {entry.entityRef ? (
                        <p className="text-xs text-ink-subtle">{entry.entityRef}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 align-top text-ink-muted">{entry.summary}</td>
                    <td className="px-4 py-2.5 align-top">
                      <OutcomeBadge outcome={entry.outcome} />
                    </td>
                    <td className="px-4 py-2.5 align-top text-ink-muted">{entry.requestIp ?? '—'}</td>
                    <td className="px-4 py-2.5 align-top">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t.auditLog.columns.details}
                        icon={<Eye aria-hidden className="size-4" />}
                        onClick={() => setDetailsFor(entry.id)}
                      />
                    </td>
                  </tr>
                ))}
              </Table>
              <Pagination
                page={data.page}
                limit={data.limit}
                total={data.total}
                onPageChange={setPage}
              />
              {tipNewActivity && page !== 1 ? (
                <div className="border-t border-border bg-brand-subtle px-4 py-2 text-sm text-brand">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setPage(1);
                    }}
                  >
                    {t.auditLog.returnToLatest}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </QueryBoundary>
      </Panel>

      <AuditDetailDialog
        entryId={detailsFor}
        onClose={() => setDetailsFor(null)}
      />
    </>
  );
}

function LiveIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-2.5 py-1 text-xs font-medium text-success">
      <Radio aria-hidden className="size-3.5" />
      {t.auditLog.live}
    </span>
  );
}

function ActorCell({ entry }: { entry: AuditEntry }) {
  const isSystem = entry.actorId === null && entry.actorName === 'System';
  const name = entry.actorName ?? (isSystem ? t.auditLog.actors.system : t.auditLog.actors.unknown);
  const email = entry.actorEmail;

  return (
    <div>
      <p className="font-medium text-ink">{name}</p>
      {email ? <p className="text-xs text-ink-subtle">{email}</p> : null}
      {entry.actorRoles.length > 0 ? (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {entry.actorRoles.map((role) => (
            <Badge key={role} tone={role === Role.ADMIN ? 'info' : 'neutral'}>
              {ROLE_LABELS[role] ?? role}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  const tone =
    outcome === 'success'
      ? 'success'
      : outcome === 'denied'
        ? 'pending'
        : outcome === 'failure'
          ? 'danger'
          : 'danger';
  return <Badge tone={tone}>{t.auditLog.outcomes[outcome]}</Badge>;
}

function AuditDetailDialog({
  entryId,
  onClose,
}: {
  entryId: string | null;
  onClose: () => void;
}) {
  const detail = useAuditLogEntry(entryId ?? '');
  if (!entryId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.auditLog.details.title}
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 md:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-t-[--radius-panel] border border-border bg-surface p-5 shadow-[--shadow-overlay] md:rounded-[--radius-panel]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-ink">{t.auditLog.details.title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X aria-hidden className="size-4" />
          </Button>
        </div>

        <QueryBoundary
          isLoading={detail.isPending}
          error={detail.error}
          data={detail.data}
          onRetry={() => void detail.refetch()}
          loadingFallback={<SkeletonRows columns={2} />}
          isEmpty={(data) => data === null}
          emptyFallback={<EmptyState title={t.auditLog.emptyTitle} />}
        >
          {(entry) => (entry ? <DetailBody entry={entry} /> : null)}
        </QueryBoundary>
      </div>
    </div>
  );
}

function DetailBody({ entry }: { entry: AuditEntry }) {
  return (
    <div className="space-y-4 text-sm">
      <DetailSection label={t.auditLog.columns.timestamp}>
        <time dateTime={entry.createdAt}>{entry.createdAt}</time>
      </DetailSection>
      <DetailSection label={t.auditLog.details.actor}>
        <p className="font-medium text-ink">{entry.actorName ?? t.auditLog.actors.unknown}</p>
        {entry.actorEmail ? (
          <p className="text-xs text-ink-subtle">{entry.actorEmail}</p>
        ) : null}
        {entry.actorRoles.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {entry.actorRoles.map((role) => (
              <Badge key={role} tone="neutral">
                {ROLE_LABELS[role] ?? role}
              </Badge>
            ))}
          </div>
        ) : null}
      </DetailSection>
      <DetailSection label={t.auditLog.columns.action}>
        <p>{entry.action}</p>
        <p className="text-xs text-ink-subtle">
          {entry.entityType}
          {entry.entityRef ? ` · ${entry.entityRef}` : ''}
        </p>
      </DetailSection>
      <DetailSection label={t.auditLog.columns.summary}>
        <p>{entry.summary}</p>
      </DetailSection>
      <DetailSection label={t.auditLog.columns.outcome}>
        <OutcomeBadge outcome={entry.outcome} />
        {entry.errorCode ? (
          <p className="text-xs text-ink-subtle">{t.auditLog.details.errorCode}: {entry.errorCode}</p>
        ) : null}
      </DetailSection>
      <DetailSection label={t.auditLog.details.request}>
        <p>
          <span className="font-mono text-ink-muted">{entry.requestMethod ?? '—'}</span>{' '}
          <span className="font-mono text-ink-muted">{entry.requestPath ?? '—'}</span>
        </p>
        <p className="text-xs text-ink-subtle">
          IP: {entry.requestIp ?? '—'}
        </p>
        {entry.userAgent ? (
          <p className="text-xs text-ink-subtle">{entry.userAgent}</p>
        ) : null}
      </DetailSection>
      <DetailSection label={t.auditLog.details.metadata}>
        <MetadataView metadata={entry.metadata} />
      </DetailSection>
    </div>
  );
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</h3>
      {children}
    </div>
  );
}

function MetadataView({ metadata }: { metadata: unknown }) {
  if (metadata === null || metadata === undefined) {
    return <p className="text-ink-muted">{t.auditLog.details.noMetadata}</p>;
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return (
      <pre className="rounded-[--radius-control] bg-surface-muted p-3 text-xs text-ink-muted">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    );
  }
  const entries = Object.entries(metadata as Record<string, unknown>);
  if (entries.length === 0) {
    return <p className="text-ink-muted">{t.auditLog.details.noMetadata}</p>;
  }
  return (
    <dl className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-3 gap-2">
          <dt className="text-xs font-medium text-ink-muted">{key}</dt>
          <dd className="col-span-2 text-xs text-ink">
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(value, null, 2)}
            </pre>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
