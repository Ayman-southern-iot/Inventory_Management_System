import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ArrowLeft, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import {
  RequisitionEventType,
  type BomDetail,
  type RequisitionDetail,
  type RequisitionEvent,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Badge, PageHeader, Panel } from '@/components/ui/primitives';
import { QueryBoundary } from '@/components/ui/states';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { ROUTES } from '@/routes/paths';
import { useBom } from '../api';
import { BomDownloadButton } from '../components/BomDownloadButton';
import { BomRenderButton } from '../components/BomRenderButton';
import { BomSourceSection } from '../components/BomSourceSection';
import { BomVoidDialog } from '../components/BomVoidDialog';

/**
 * The IM's view of one BOM.
 *
 *  - Header: bomNo, generated at/by, source requisitions, totals, badges.
 *  - Action bar: Render PDF (when live + not bounced), Download PDF (when
 *    hasPdf), Void BOM (when live + not bounced). Bounced and Voided BOMs
 *    never get a Render/Download button — the API rejects both with 409.
 *  - Sources panel: one read-only `BomSourceSection` per source requisition
 *    (lines + frozen approval chain).
 *  - History: BOM_GENERATED / BOM_RENDERED / BOM_VOIDED events from each
 *    source requisition's event log, merged and sorted newest-first.
 */
export function BomDetailPage() {
  const params = useParams<{ bomId: string }>();
  const id = params.bomId ?? '';

  const bom = useBom(id);
  const [voidOpen, setVoidOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to={ROUTES.boms.all}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.boms.title}
      </Link>

      <QueryBoundary
        isLoading={bom.isPending}
        error={bom.error}
        data={bom.data}
        onRetry={() => void bom.refetch()}
      >
        {(detail) => <BomDetailView detail={detail} onVoid={() => setVoidOpen(true)} />}
      </QueryBoundary>

      <BomVoidDialog bomId={bom.data?.id ?? null} open={voidOpen} onClose={() => setVoidOpen(false)} />
    </div>
  );
}

function BomDetailView({
  detail,
  onVoid,
}: {
  detail: BomDetail;
  onVoid: () => void;
}) {
  // The action bar is the IM's power zone.
  //  - Voided: nothing to do (the row is the audit trail).
  //  - Bounced: Void is still available so the IM can free its sources;
  //    Render and Download are 409s because the API already kicked the
  //    sources back to the approver queue.
  //  - Live: full bar.
  const showActions = !detail.isVoid;
  const showRenderAndDownload = !detail.isVoid && !detail.overBudgetBounced;

  const sourceQueries = useSourceEvents(detail);

  /**
   * Merge the BOM-related events from each source into one ordered stream, each tagged with the
   * requisition it came from.
   *
   * D-029: a BOM batched from three requisitions showed three identical BOM_GENERATED rows, same
   * timestamp, same actor, nothing to tell them apart. The rows are not duplicates and nothing is
   * collapsed or deleted here — `requisition_events` is append-only and one event per source is
   * the correct record. They were simply rendered without the one field that distinguishes them.
   */
  const events = useMemo<Array<RequisitionEvent & { requisitionNo: string }>>(
    () =>
      sourceQueries
        .flatMap((query, index) => {
          const requisitionNo = detail.sources[index]?.requisitionNo ?? '';
          return (query.data?.events ?? []).map((event) => ({ ...event, requisitionNo }));
        })
        .filter((event) => BOM_EVENT_TYPES.has(event.eventType))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sourceQueries, detail.sources],
  );

  return (
    <>
      <PageHeader
        title={detail.bomNo}
        subtitle={`${t.boms.generatedAt} ${formatDateTime(detail.generatedAt)} · ${t.boms.generatedBy} ${detail.generatedByName}`}
      />

      <Panel>
        <header className="flex flex-wrap items-start gap-4 border-b border-border px-4 py-4">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide text-ink-subtle">
              {t.boms.sources}
            </p>
            <p className="mt-1 text-sm text-ink">
              {detail.requisitionNos.length === 0
                ? t.boms.noSources
                : detail.requisitionNos.join(', ')}
            </p>
          </div>
          <TotalsBlock detail={detail} />
          <StatusBadges detail={detail} />
        </header>

        {showActions ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border px-4 py-3">
            {showRenderAndDownload && detail.hasPdf ? (
              <BomDownloadButton id={detail.id} />
            ) : null}
            {showRenderAndDownload ? (
              <BomRenderButton id={detail.id} hasPdf={detail.hasPdf} />
            ) : null}
            <Button
              type="button"
              variant="danger"
              icon={<XCircle aria-hidden className="size-4" />}
              onClick={onVoid}
            >
              {t.boms.void}
            </Button>
          </div>
        ) : null}

        {detail.isVoid ? (
          <div className="border-b border-border bg-danger-subtle px-4 py-3 text-xs text-danger">
            <p className="font-semibold uppercase tracking-wide">
              {t.boms.voidBanner}
            </p>
            <p className="mt-1 text-ink">
              {t.boms.voidedAt} {detail.voidedAt ? formatDateTime(detail.voidedAt) : t.common.dash}
              {' · '}
              {t.boms.voidedBy} {detail.voidedByName ?? '—'}
              {detail.voidReason ? ` · ${detail.voidReason}` : null}
            </p>
          </div>
        ) : null}

        <div>
          {detail.sources.map((source) => (
            <BomSourceSection
              key={source.requisitionId}
              source={source}
              // A BOM line carries the parent requisition's `requisitionNo` (the
              // human ref, not the UUID — same convention as the printed PDF).
              // We use it to slice the flat lines bucket into one section per
              // source.
              lines={detail.lines.filter((line) => line.requisitionNo === source.requisitionNo)}
            />
          ))}
        </div>
      </Panel>

      <Panel className="mt-6">
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{t.boms.historyHeading}</h2>
        </header>
        {events.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-subtle">—</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => (
              <li key={event.id} className="px-4 py-2.5 text-sm text-ink">
                <span className="font-mono text-xs text-ink-muted">
                  {formatDateTime(event.createdAt)}
                </span>
                {' · '}
                <span className="font-medium">{event.actorName ?? '—'}</span>
                {' · '}
                <span className="text-ink-muted">{event.eventType}</span>
                {/* D-029: which source requisition this event belongs to. Without it a batched
                    BOM's three BOM_GENERATED rows are indistinguishable. */}
                {event.requisitionNo ? (
                  <>
                    {' · '}
                    <span className="font-mono text-xs text-ink-subtle">
                      {event.requisitionNo}
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function TotalsBlock({ detail }: { detail: BomDetail }) {
  // The header carries four (or five, when transportation is non-zero) figures so the
  // IM/Accounts can reconcile on one screen:
  //   Approved total   — sanctioned across all sources (includes transportation).
  //   Items subtotal   — items-only sum (what `POST /boms` line totals wrote).
  //   Transportation   — rolled-up travel cost per source. Hidden when zero.
  //   BOM subtotal     — items + transportation, matching the printed PDF's Grand total.
  //   Variance         — BOM subtotal − Approved total. Zero on a clean BOM.
  // For a voided or bounced BOM the same labels still apply; we never hide the math
  // because the IM needs to see what they submitted.
  const approvedTotal = (detail.sources ?? []).reduce(
    (sum, source) => sum + (source.approvedAmount ?? 0),
    0,
  );
  const transportationTotal = (detail.sources ?? []).reduce(
    (sum, source) => sum + (source.transportationCost ?? 0),
    0,
  );
  const itemsSubtotal = detail.subtotal;
  const bomSubtotal = itemsSubtotal + transportationTotal;
  const variance = bomSubtotal - approvedTotal;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-5">
      <Cell label={t.boms.approvedTotal} value={approvedTotal.toLocaleString()} />
      <Cell label={t.boms.itemsSubtotal} value={itemsSubtotal.toLocaleString()} />
      {transportationTotal > 0 ? (
        <Cell label={t.boms.transportation} value={transportationTotal.toLocaleString()} />
      ) : null}
      <Cell label={t.boms.bomSubtotal} value={bomSubtotal.toLocaleString()} emphasis />
      <Cell label={t.boms.variance} value={variance.toLocaleString()} />
    </div>
  );
}

function StatusBadges({ detail }: { detail: BomDetail }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {detail.overBudgetBounced ? (
        <Badge tone="danger">{t.boms.bouncedBanner}</Badge>
      ) : null}
      {detail.hasPdf ? (
        <Badge tone="success">{t.boms.pdfReady}</Badge>
      ) : (
        <Badge tone="pending">{t.boms.pdfPending}</Badge>
      )}
      {detail.isVoid ? <Badge tone="danger">{t.boms.voidedLabel}</Badge> : null}
    </div>
  );
}

function Cell({
  label,
  value,
  emphasis = false,
  mono = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </p>
      <p
        className={
          emphasis
            ? 'text-lg font-semibold tabular-nums text-ink'
            : mono
              ? 'text-sm font-mono text-ink-muted'
              : 'text-base tabular-nums text-ink'
        }
      >
        {value}
      </p>
    </div>
  );
}

/** Events the detail page's history strip is interested in. */
const BOM_EVENT_TYPES: Set<string> = new Set<string>([
  RequisitionEventType.BOM_GENERATED,
  RequisitionEventType.BOM_RENDERED,
  RequisitionEventType.BOM_VOIDED,
  RequisitionEventType.BOM_BOUNCED,
]);

/**
 * Fetch each source requisition in parallel so the IM sees the events that
 * already touched the BOM (`BOM_GENERATED`, `BOM_RENDERED`, `BOM_VOIDED`).
 * The result is a one-line history strip below the sources panel.
 */
function useSourceEvents(detail: BomDetail) {
  return useQueries({
    queries: detail.sources.map((source) => ({
      queryKey: queryKeys.requisitions.detail(source.requisitionId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<RequisitionDetail>(
          `/requisitions/${source.requisitionId}`,
          signal,
        ),
      enabled: detail.sources.length > 0,
      staleTime: 60_000,
    })),
  });
}