import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  PAGINATION_DEFAULT_LIMIT,
  RequisitionStatus,
  type ListRequisitionsQuery,
  type Requisition,
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
import { useRequisitions } from '../api';

type Mode = 'mine' | 'approvals' | 'all';

const STATUS_TONE: Partial<
  Record<RequisitionStatus, 'neutral' | 'success' | 'pending' | 'danger' | 'info'>
> = {
  [RequisitionStatus.DRAFT]: 'neutral',
  [RequisitionStatus.IM_REVIEW]: 'pending',
  [RequisitionStatus.AWAITING_APPROVAL]: 'pending',
  [RequisitionStatus.APPROVED]: 'success',
  [RequisitionStatus.REJECTED]: 'danger',
  [RequisitionStatus.CANCELLED]: 'neutral',
};

interface Filter {
  key: string;
  label: string;
  patch: Partial<ListRequisitionsQuery>;
}

/**
 * One screen for the requester (3.2's follow-up), the approver portal (3.7) and the IM's
 * list (3.8). The API decides what each caller may see, so the difference here is only which
 * filters make sense to offer.
 */
export function RequisitionsPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [filterKey, setFilterKey] = useState('default');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const filters = useMemo<Filter[]>(() => {
    if (mode === 'approvals') {
      return [
        { key: 'default', label: t.requisitions.filterAwaitingMe, patch: { awaitingMe: true } },
        { key: 'all', label: t.requisitions.filterAll, patch: {} },
        {
          key: 'approved',
          label: t.requisitions.filterApproved,
          // The approver's own history, not the requisition's current status: APPROVED is
          // transient, so a status filter emptied this tab as soon as the IM made a BOM.
          patch: { approvedByMe: true },
        },
        {
          key: 'rejected',
          label: t.requisitions.filterRejected,
          patch: { status: RequisitionStatus.REJECTED },
        },
      ];
    }
    return [
      { key: 'default', label: t.requisitions.filterAll, patch: {} },
      {
        key: 'drafts',
        label: t.requisitions.filterDrafts,
        patch: { status: RequisitionStatus.DRAFT },
      },
      {
        key: 'approved',
        label: t.requisitions.filterApproved,
        patch: { status: RequisitionStatus.APPROVED },
      },
      {
        key: 'rejected',
        label: t.requisitions.filterRejected,
        patch: { status: RequisitionStatus.REJECTED },
      },
    ];
  }, [mode]);

  const query = useMemo<ListRequisitionsQuery>(() => {
    const active = filters.find((filter) => filter.key === filterKey) ?? filters[0]!;
    return {
      page,
      limit: PAGINATION_DEFAULT_LIMIT,
      mine: mode === 'mine',
      awaitingMe: false,
      approvedByMe: false,
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      ...active.patch,
    };
  }, [filters, filterKey, page, mode, debouncedSearch]);

  const requisitions = useRequisitions(query);

  const heading =
    mode === 'mine'
      ? { title: t.requisitions.myTitle, subtitle: t.requisitions.mySubtitle }
      : mode === 'approvals'
        ? { title: t.requisitions.approvalsTitle, subtitle: t.requisitions.approvalsSubtitle }
        : { title: t.requisitions.title, subtitle: t.requisitions.subtitle };

  const empty =
    mode === 'approvals'
      ? { title: t.requisitions.approvalsEmptyTitle, body: t.requisitions.approvalsEmptyBody }
      : mode === 'mine'
        ? { title: t.requisitions.myEmptyTitle, body: t.requisitions.myEmptyBody }
        : { title: t.requisitions.emptyTitle, body: t.requisitions.emptyBody };

  return (
    <>
      <PageHeader
        title={heading.title}
        subtitle={heading.subtitle}
        action={
          mode === 'mine' ? (
            <Button
              icon={<Plus aria-hidden className="size-4" />}
              onClick={() => navigate(ROUTES.requisitions.new)}
            >
              {t.requisitions.newRequisition}
            </Button>
          ) : undefined
        }
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-4 border-b border-border px-4 py-3">
          <div className="min-w-56 flex-1">
            <TextField
              label={t.common.search}
              placeholder={t.requisitions.searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div role="group" aria-label={t.common.filters} className="flex flex-wrap gap-1 pb-1">
            {filters.map((filter) => (
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
          isLoading={requisitions.isPending}
          error={requisitions.error}
          data={requisitions.data}
          onRetry={() => void requisitions.refetch()}
          loadingFallback={<SkeletonRows columns={6} />}
          isEmpty={(data) => data.items.length === 0}
          emptyFallback={<EmptyState title={empty.title} body={empty.body} />}
        >
          {(data) => (
            <>
              <p className="px-5 pt-4 text-xs text-ink-subtle">{t.requisitions.sortNote}</p>
              <Table
                headers={[
                  t.requisitions.requisitionNo,
                  mode === 'mine' ? t.requisitions.project : t.requisitions.requester,
                  t.requisitions.requested,
                  t.requisitions.urgency,
                  t.requisitions.approvalDeadline,
                  t.users.status,
                ]}
              >
                {data.items.map((requisition: Requisition) => (
                  <tr
                    key={requisition.id}
                    onClick={() => navigate(ROUTES.requisitions.detail(requisition.id))}
                    className="cursor-pointer hover:bg-surface-muted/50"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">
                      {requisition.requisitionNo}
                    </td>
                    <td className="px-4 py-2.5 text-ink">
                      {mode === 'mine'
                        ? (requisition.projectName ?? t.common.none)
                        : requisition.requesterName}
                      {requisition.departmentName ? (
                        <span className="block text-xs text-ink-subtle">
                          {requisition.departmentName}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink">
                      {(requisition.requestedAmount ?? 0).toLocaleString()}
                      {requisition.approvedAmount !== null &&
                      requisition.approvedAmount !== requisition.requestedAmount ? (
                        <span className="block text-xs text-ink-subtle">
                          {t.requisitions.sanctioned}:{' '}
                          {requisition.approvedAmount.toLocaleString()}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-ink-muted">
                      {t.requisitions.urgencyLabel[requisition.urgency]}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-ink-muted">
                      {requisition.approvalDeadline ?? t.common.none}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={STATUS_TONE[requisition.status] ?? 'info'}>
                          {t.requisitions.status[requisition.status]}
                        </Badge>
                        {requisition.isOverdue ? (
                          <Badge tone="danger">{t.borrowing.overdue}</Badge>
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
