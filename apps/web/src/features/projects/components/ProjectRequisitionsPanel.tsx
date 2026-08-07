import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PAGINATION_DEFAULT_LIMIT,
  RequisitionStatus,
  type ListRequisitionsQuery,
  type Requisition,
} from '@ims/shared';
import { Badge, Pagination, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { formatBdt } from '@/lib/format';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { useRequisitions } from '@/features/requisitions/api';

// Local copy of the status-tone map from `RequisitionsPage`. It is small, used by exactly
// two pages, and re-exporting it from the requisition feature would tie this module to a
// page's implementation details rather than to the canonical contract.
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

/**
 * The requisitions charged to this project. `mine: false` lets the IM/Admin see every
 * requester; general users fall back to "only mine" by API design, so they still get a
 * correct, narrowed list rather than an empty one.
 */
export function ProjectRequisitionsPanel({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const query: ListRequisitionsQuery = {
    page,
    limit: PAGINATION_DEFAULT_LIMIT,
    projectId,
    mine: false,
    awaitingMe: false,
  };
  const requisitions = useRequisitions(query);

  return (
    <Panel>
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-ink">{t.projects.requestedHeading}</h2>
        <p className="mt-0.5 text-sm text-ink-muted">{t.projects.requestedHint}</p>
      </header>

      <QueryBoundary
        isLoading={requisitions.isPending}
        error={requisitions.error}
        data={requisitions.data}
        onRetry={() => void requisitions.refetch()}
        loadingFallback={<SkeletonRows columns={4} />}
        isEmpty={(data) => data.items.length === 0}
        emptyFallback={<EmptyState title={t.projects.requestedEmpty} />}
      >
        {(data) => (
          <>
            <Table
              headers={[
                t.requisitions.requisitionNo,
                t.requisitions.requester,
                t.requisitions.requested,
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
                  <td className="px-4 py-2.5 text-ink">{requisition.requesterName}</td>
                  <td className="px-4 py-2.5 text-sm tabular-nums text-ink">
                    {formatBdt(requisition.requestedAmount)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[requisition.status] ?? 'info'}>
                      {t.requisitions.status[requisition.status]}
                    </Badge>
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
  );
}
