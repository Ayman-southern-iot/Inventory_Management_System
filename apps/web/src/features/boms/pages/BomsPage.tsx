import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, FileX, Plus, XCircle } from 'lucide-react';
import {
  PAGINATION_DEFAULT_LIMIT,
  type Bom,
  type ListBomsQuery,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Badge, PageHeader, Pagination, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { ROUTES } from '@/routes/paths';
import { SEARCH_DEBOUNCE_MS } from '@/features/inventory/constants';
import { useDebouncedValue } from '@/features/inventory/hooks/useDebouncedValue';
import { useBoms } from '../api';

type FilterKey = 'all' | 'live' | 'voided';

const FILTERS: { key: FilterKey; label: string; patch: { includeVoid: boolean } }[] = [
  { key: 'live', label: t.boms.filterLive, patch: { includeVoid: false } },
  { key: 'all', label: t.boms.filterAll, patch: { includeVoid: true } },
  { key: 'voided', label: t.boms.filterVoided, patch: { includeVoid: true } },
];

/**
 * The IM's BOM index. Default is "Live" because that is what an IM acts on — Voided is
 * the audit trail, never the working set. Search is by `bomNo` only; the API filters on
 * `lower(bom_no) like %q%`.
 */
export function BomsPage() {
  const navigate = useNavigate();
  const [filterKey, setFilterKey] = useState<FilterKey>('live');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const query = useMemo<ListBomsQuery>(() => {
    const active = FILTERS.find((filter) => filter.key === filterKey) ?? FILTERS[0]!;
    return {
      page,
      limit: PAGINATION_DEFAULT_LIMIT,
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      ...active.patch,
    };
  }, [filterKey, page, debouncedSearch]);

  const boms = useBoms(query);

  return (
    <>
      <PageHeader
        title={t.boms.title}
        subtitle={t.boms.subtitle}
        action={
          <Button
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() => navigate(ROUTES.boms.new)}
          >
            {t.boms.newBom}
          </Button>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-4 border-b border-border px-4 py-3">
          <div className="min-w-56 flex-1">
            <TextField
              label={t.common.search}
              placeholder={t.boms.searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div role="group" aria-label={t.common.filters} className="flex flex-wrap gap-1 pb-1">
            {FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                aria-pressed={filterKey === filter.key}
                onClick={() => {
                  setFilterKey(filter.key);
                  setPage(1);
                }}
                className={cn(
                  'rounded-[--radius-control] px-3 py-1.5 text-sm transition-colors',
                  filterKey === filter.key
                    ? 'bg-brand-subtle font-medium text-brand'
                    : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <QueryBoundary
          isLoading={boms.isPending}
          error={boms.error}
          data={boms.data}
          onRetry={() => void boms.refetch()}
          loadingFallback={<SkeletonRows columns={5} />}
          isEmpty={(data) => data.items.length === 0}
          emptyFallback={
            <EmptyState
              title={t.boms.emptyTitle}
              body={t.boms.emptyBody}
              action={
                <Button onClick={() => navigate(ROUTES.boms.new)}>
                  {t.boms.newBom}
                </Button>
              }
            />
          }
        >
          {(data) => (
            <>
              <Table
                headers={[
                  t.boms.bomNo,
                  t.boms.sources,
                  t.boms.bomSubtotal,
                  t.boms.generatedAt,
                  t.boms.pdfStatus,
                ]}
              >
                {data.items.map((bom: Bom) => (
                  <tr
                    key={bom.id}
                    onClick={() => navigate(ROUTES.boms.detail(bom.id))}
                    className="cursor-pointer hover:bg-surface-muted/50"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">
                      {bom.bomNo}
                    </td>
                    <td className="px-4 py-2.5 text-ink">
                      {bom.requisitionNos.length === 0
                        ? t.boms.noSources
                        : bom.requisitionNos.join(', ')}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink">
                      {bom.subtotal.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-ink-muted">
                      {bom.generatedAt}
                      <span className="block text-xs text-ink-subtle">
                        {t.boms.generatedBy} {bom.generatedByName}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {bom.hasPdf ? (
                          <Badge tone="success">
                            <CheckCircle2 aria-hidden className="mr-1 inline size-3" />
                            {t.boms.pdfReady}
                          </Badge>
                        ) : (
                          <Badge tone="pending">
                            <FileX aria-hidden className="mr-1 inline size-3" />
                            {t.boms.pdfPending}
                          </Badge>
                        )}
                        {bom.isVoid ? (
                          <Badge tone="danger">
                            <XCircle aria-hidden className="mr-1 inline size-3" />
                            {t.boms.voidedLabel}
                          </Badge>
                        ) : null}
                        {bom.overBudgetBounced ? (
                          <Badge tone="danger">{t.boms.bouncedBanner}</Badge>
                        ) : null}
                      </div>
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
            </>
          )}
        </QueryBoundary>
      </Panel>
    </>
  );
}