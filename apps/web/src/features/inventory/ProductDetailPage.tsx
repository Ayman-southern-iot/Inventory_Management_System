import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowLeftRight, Pencil, PackagePlus, Scale } from 'lucide-react';
import type { ListLedgerQuery, Placement } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Badge, PageHeader, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { LEDGER_PAGE_LIMIT } from './constants';
import { useLedger, useProduct, useZones } from './api';
import { zoneToneFor } from './zone-colour';
import { AdjustStockDialog } from './components/AdjustStockDialog';
import { MoveStockDialog } from './components/MoveStockDialog';
import { ProductFormDialog } from './components/ProductFormDialog';
import { ReceiveStockDialog } from './components/ReceiveStockDialog';

type OpenDialog = 'receive' | 'move' | 'adjust' | 'edit' | null;

/** One placement, coloured by zone so the card is readable by shape before it is read by text. */
function PlacementChip({ placement }: { placement: Placement }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-[--radius-control] border px-3 py-2',
        zoneToneFor(placement.zoneId),
      )}
    >
      <span className="text-xs font-medium opacity-80">
        {placement.zoneName} / {placement.compartmentCode}
      </span>
      <span className="text-lg font-semibold tabular-nums">{placement.quantity}</span>
      {placement.reservedQty > 0 ? (
        <span className="text-xs opacity-80">
          {placement.reservedQty} {t.inventory.reserved.toLowerCase()}
        </span>
      ) : null}
    </div>
  );
}

function Figure({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className={cn('mt-0.5 text-2xl font-semibold tabular-nums', muted && 'text-ink-muted')}>
        {value}
      </dd>
    </div>
  );
}

export function ProductDetailPage() {
  const { productId = '' } = useParams<{ productId: string }>();
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const product = useProduct(productId);
  const zones = useZones();

  const ledgerQuery = useMemo<ListLedgerQuery>(
    () => ({ page: 1, limit: LEDGER_PAGE_LIMIT, productId }),
    [productId],
  );
  const ledger = useLedger(ledgerQuery);

  const close = () => setDialog(null);

  return (
    <>
      <Link
        to={ROUTES.inventory.products}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.inventory.backToInventory}
      </Link>

      <QueryBoundary
        isLoading={product.isPending}
        error={product.error}
        data={product.data}
        onRetry={() => void product.refetch()}
      >
        {(detail) => (
          <>
            <PageHeader
              title={detail.name}
              subtitle={`${detail.productCode} · ${detail.categoryName} · ${detail.unit}`}
              action={
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    icon={<Pencil aria-hidden className="size-4" />}
                    onClick={() => setDialog('edit')}
                  >
                    {t.common.edit}
                  </Button>
                  {detail.isTrackable ? (
                    <>
                      <Button
                        variant="secondary"
                        icon={<Scale aria-hidden className="size-4" />}
                        onClick={() => setDialog('adjust')}
                        disabled={detail.placements.length === 0}
                      >
                        {t.inventory.adjustStock}
                      </Button>
                      <Button
                        variant="secondary"
                        icon={<ArrowLeftRight aria-hidden className="size-4" />}
                        onClick={() => setDialog('move')}
                        disabled={detail.totalAvailable === 0}
                      >
                        {t.inventory.moveStock}
                      </Button>
                      <Button
                        icon={<PackagePlus aria-hidden className="size-4" />}
                        onClick={() => setDialog('receive')}
                      >
                        {t.inventory.receiveStock}
                      </Button>
                    </>
                  ) : null}
                </div>
              }
            />

            <div className="flex flex-col gap-6">
              {!detail.isTrackable ? (
                <p className="rounded-[--radius-panel] bg-surface-muted px-4 py-3 text-sm text-ink-muted">
                  {t.inventory.notTrackedHint}
                </p>
              ) : null}

              <Panel className="p-5">
                <dl className="flex flex-wrap gap-10">
                  <Figure label={t.inventory.onHand} value={detail.totalQuantity} />
                  <Figure label={t.inventory.reserved} value={detail.totalReserved} muted />
                  <Figure label={t.inventory.available} value={detail.totalAvailable} />
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                      {t.users.status}
                    </dt>
                    <dd className="mt-1.5 flex gap-1">
                      <Badge tone={detail.isActive ? 'success' : 'danger'}>
                        {detail.isActive ? t.common.active : t.inventory.archived}
                      </Badge>
                      <Badge tone="neutral">
                        {detail.defaultReturnable
                          ? t.inventory.defaultReturnable
                          : t.inventory.consumable}
                      </Badge>
                    </dd>
                  </div>
                </dl>
              </Panel>

              {detail.isTrackable ? (
                <section>
                  <h2 className="mb-2 text-base font-semibold text-ink">{t.inventory.locations}</h2>
                  {detail.placements.length === 0 ? (
                    <Panel>
                      <EmptyState title={t.inventory.noStock} body={t.inventory.noStockBody} />
                    </Panel>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {detail.placements.map((placement) => (
                        <PlacementChip key={placement.id} placement={placement} />
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              <section>
                <h2 className="mb-2 text-base font-semibold text-ink">
                  {t.inventory.recentMovements}
                </h2>
                <Panel>
                  <QueryBoundary
                    isLoading={ledger.isPending}
                    error={ledger.error}
                    data={ledger.data}
                    onRetry={() => void ledger.refetch()}
                    loadingFallback={<SkeletonRows columns={4} rows={3} />}
                    isEmpty={(data) => data.items.length === 0}
                    emptyFallback={<EmptyState title={t.inventory.noMovements} />}
                  >
                    {(data) => (
                      <Table
                        headers={[
                          t.inventory.movement.RECEIPT,
                          t.inventory.quantity,
                          t.inventory.locations,
                          t.common.note,
                        ]}
                      >
                        {data.items.map((entry) => (
                          <tr key={entry.id}>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-ink">
                                {t.inventory.movement[entry.movementType]}
                              </p>
                              <p className="text-xs text-ink-subtle">
                                {new Date(entry.createdAt).toLocaleString()} ·{' '}
                                {entry.performedByName ?? t.common.unknown}
                              </p>
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-ink">{entry.quantity}</td>
                            <td className="px-4 py-2.5 text-sm text-ink-muted">
                              {entry.fromCompartment ?? t.common.none}
                              {' → '}
                              {entry.toCompartment ?? t.common.none}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-ink-muted">
                              {entry.note ?? t.common.none}
                            </td>
                          </tr>
                        ))}
                      </Table>
                    )}
                  </QueryBoundary>
                </Panel>
              </section>
            </div>

            <ReceiveStockDialog
              open={dialog === 'receive'}
              onClose={close}
              productId={detail.id}
              zones={zones.data ?? []}
            />
            <MoveStockDialog
              open={dialog === 'move'}
              onClose={close}
              productId={detail.id}
              placements={detail.placements}
              zones={zones.data ?? []}
            />
            <AdjustStockDialog
              open={dialog === 'adjust'}
              onClose={close}
              productId={detail.id}
              placements={detail.placements}
            />
            <ProductFormDialog open={dialog === 'edit'} onClose={close} editing={detail} />
          </>
        )}
      </QueryBoundary>
    </>
  );
}
