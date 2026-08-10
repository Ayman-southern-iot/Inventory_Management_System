import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowLeftRight, HandCoins, Pencil, PackagePlus, Scale } from 'lucide-react';
import type { ActiveProductBorrow, ListLedgerQuery, Placement, ProductDetail } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Badge, PageHeader, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { Role, ReturnCondition } from '@ims/shared';
import { useAuth } from '@/features/auth/auth-context';
import { BorrowDialog } from '@/features/borrowing/components/BorrowDialog';
import { LEDGER_PAGE_LIMIT } from '../constants';
import { useLedger, useProduct, useZones } from '../api';
import { zoneToneFor } from '../zone-colour';
import { AdjustStockDialog } from '../components/AdjustStockDialog';
import { MoveStockDialog } from '../components/MoveStockDialog';
import { ProductFormDialog } from '../components/ProductFormDialog';
import { QuarantineDialog } from '../components/QuarantineDialog';
import { ReceiveStockDialog } from '../components/ReceiveStockDialog';

type OpenDialog =
  | { kind: 'receive' }
  | { kind: 'move' }
  | { kind: 'adjust' }
  | { kind: 'edit' }
  | { kind: 'borrow' }
  | { kind: 'quarantine'; placement: Placement }
  | null;

/**
 * One placement, coloured by zone so the card is readable by shape before it is read by text.
 * Shows reserved *and* quarantined when either is non-zero — both are subtractions the IM
 * needs to see when reconciling the shelf against the figures above.
 */
function PlacementChip({
  placement,
  canManageStock,
  onQuarantine,
}: {
  placement: Placement;
  canManageStock: boolean;
  onQuarantine: (placement: Placement) => void;
}) {
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
      {placement.quarantinedQty > 0 ? (
        <span className="flex items-center justify-between gap-2 text-xs opacity-90">
          <span>
            {placement.quarantinedQty} {t.inventory.quarantined.toLowerCase()}
          </span>
          {canManageStock ? (
            <button
              type="button"
              onClick={() => onQuarantine(placement)}
              className="rounded bg-surface/60 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide opacity-90 hover:bg-surface"
            >
              {t.common.manage}
            </button>
          ) : null}
        </span>
      ) : null}
      <span className="text-2xs opacity-70">
        {placement.availableQty} {t.inventory.availableShort}
      </span>
    </div>
  );
}

type FigureTone = 'success' | 'info' | 'pending' | 'danger' | 'empty';

const FIGURE_TONE_CLASSES: Record<FigureTone, string> = {
  success: 'bg-success-subtle text-success',
  info: 'bg-info-subtle text-info',
  pending: 'bg-pending-subtle text-pending',
  danger: 'bg-danger-subtle text-danger',
  // "empty" stays surface-coloured with a border so all four boxes keep the same baseline
  // height when there is nothing reserved or quarantined to call out.
  empty: 'bg-surface text-ink-muted border border-border',
};

const FIGURE_TONE_LABEL: Record<FigureTone, string> = {
  success: 'text-success',
  info: 'text-info',
  pending: 'text-pending',
  danger: 'text-danger',
  empty: 'text-ink-subtle',
};

/**
 * One of the four colour-coded boxes on the product detail header. Carries a primary number
 * and an optional secondary number (e.g., "Total owned" with "On hand" beneath). Tone drives
 * the background so the stock story is read by colour first.
 */
function FigureBox({
  tone,
  primary,
  secondary,
}: {
  tone: FigureTone;
  primary: { label: string; value: number };
  secondary?: { label: string; value: number };
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-[--radius-control] px-4 py-3',
        FIGURE_TONE_CLASSES[tone],
      )}
    >
      <p className={cn('text-xs font-medium uppercase tracking-wide', FIGURE_TONE_LABEL[tone])}>
        {primary.label}
      </p>
      <p className="text-2xl font-semibold tabular-nums">{primary.value.toLocaleString()}</p>
      {secondary ? (
        <p className={cn('text-xs', FIGURE_TONE_LABEL[tone], 'opacity-80')}>
          <span className="font-medium uppercase tracking-wide">{secondary.label}:</span>{' '}
          <span className="tabular-nums">{secondary.value.toLocaleString()}</span>
        </p>
      ) : null}
    </div>
  );
}

const CONDITION_TONE: Record<
  ReturnCondition,
  { tone: 'success' | 'pending' | 'danger' | 'neutral'; label: string }
> = {
  [ReturnCondition.GOOD]: { tone: 'success', label: t.borrowing.conditionLabels.GOOD },
  [ReturnCondition.PARTIALLY_DAMAGED_USABLE]: {
    tone: 'pending',
    label: t.borrowing.conditionLabels.PARTIALLY_DAMAGED_USABLE,
  },
  [ReturnCondition.DAMAGED]: { tone: 'danger', label: t.borrowing.conditionLabels.DAMAGED },
  [ReturnCondition.NOT_WORKING]: {
    tone: 'danger',
    label: t.borrowing.conditionLabels.NOT_WORKING,
  },
};

function ActiveBorrowRow({ borrow }: { borrow: ActiveProductBorrow }) {
  const condition = borrow.lastReturnCondition
    ? CONDITION_TONE[borrow.lastReturnCondition]
    : null;
  return (
    <tr>
      <td className="px-4 py-2.5">
        <p className="font-medium text-ink">{borrow.borrowerName}</p>
        <p className="text-xs text-ink-subtle">{borrow.borrowNo}</p>
      </td>
      <td className="px-4 py-2.5 text-sm text-ink-muted">
        {borrow.projectName ?? t.borrowing.noProject}
      </td>
      <td className="px-4 py-2.5 tabular-nums text-ink">
        {borrow.returnedQty > 0 ? (
          <span>
            <span className="text-ink-muted line-through">{borrow.quantity}</span>{' '}
            <span className="font-medium">{borrow.outstandingQty}</span>{' '}
            <span className="text-xs text-ink-subtle">
              ({borrow.returnedQty}/{borrow.quantity})
            </span>
          </span>
        ) : (
          borrow.outstandingQty
        )}
      </td>
      <td className="px-4 py-2.5 text-sm text-ink-muted">
        {borrow.expectedReturnDate ? (
          <span className={cn(borrow.isOverdue && 'font-medium text-danger')}>
            {borrow.expectedReturnDate}
            {borrow.isOverdue ? ` · ${t.borrowing.overdue}` : ''}
          </span>
        ) : (
          t.common.none
        )}
      </td>
      <td className="px-4 py-2.5 text-sm">
        {condition ? <Badge tone={condition.tone}>{condition.label}</Badge> : t.common.dash}
      </td>
    </tr>
  );
}

function ActiveBorrowsSection({ borrows }: { borrows: ActiveProductBorrow[] }) {
  if (borrows.length === 0) {
    return (
      <Panel>
        <EmptyState
          title={t.borrowing.currentlyInUse}
          body={t.borrowing.currentlyInUseEmpty}
        />
      </Panel>
    );
  }
  return (
    <Panel className="overflow-x-auto p-0">
      <Table
        headers={[
          t.borrowing.borrowedBy,
          t.borrowing.project,
          t.borrowing.outstanding,
          t.borrowing.expectedReturn,
          t.borrowing.lastReturnCondition,
        ]}
      >
        {borrows.map((borrow) => (
          <ActiveBorrowRow key={borrow.borrowId} borrow={borrow} />
        ))}
      </Table>
    </Panel>
  );
}

export function ProductDetailPage() {
  const { productId = '' } = useParams<{ productId: string }>();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const { hasRole } = useAuth();
  const canManageStock = hasRole(Role.INVENTORY_MANAGER, Role.ADMIN);

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
          <ProductDetailBody
            detail={detail}
            dialog={dialog}
            setDialog={setDialog}
            close={close}
            canManageStock={canManageStock}
            zones={zones.data ?? []}
            ledger={ledger}
          />
        )}
      </QueryBoundary>
    </>
  );
}

interface BodyProps {
  detail: ProductDetail;
  dialog: OpenDialog;
  setDialog: (next: OpenDialog) => void;
  close: () => void;
  canManageStock: boolean;
  zones: ReturnType<typeof useZones>['data'] extends infer T ? T : never;
  ledger: ReturnType<typeof useLedger>;
}

function ProductDetailBody({
  detail,
  dialog,
  setDialog,
  close,
  canManageStock,
  zones,
  ledger,
}: BodyProps) {
  const activePlacement = dialog?.kind === 'quarantine' ? dialog.placement : null;
  return (
    <>
      <PageHeader
        title={detail.name}
        subtitle={`${detail.productCode} · ${detail.categoryName} · ${detail.unit}`}
        action={
          <div className="flex flex-wrap gap-2">
            {detail.isTrackable && detail.isActive && detail.totalAvailable > 0 ? (
              <Button
                icon={<HandCoins aria-hidden className="size-4" />}
                onClick={() => setDialog({ kind: 'borrow' })}
              >
                {t.borrowing.borrow}
              </Button>
            ) : null}
            {canManageStock ? (
              <Button
                variant="secondary"
                icon={<Pencil aria-hidden className="size-4" />}
                onClick={() => setDialog({ kind: 'edit' })}
              >
                {t.common.edit}
              </Button>
            ) : null}
            {canManageStock && detail.isTrackable ? (
              <>
                <Button
                  variant="secondary"
                  icon={<Scale aria-hidden className="size-4" />}
                  onClick={() => setDialog({ kind: 'adjust' })}
                  disabled={detail.placements.length === 0}
                >
                  {t.inventory.adjustStock}
                </Button>
                <Button
                  variant="secondary"
                  icon={<ArrowLeftRight aria-hidden className="size-4" />}
                  onClick={() => setDialog({ kind: 'move' })}
                  disabled={detail.totalAvailable === 0}
                >
                  {t.inventory.moveStock}
                </Button>
                <Button
                  icon={<PackagePlus aria-hidden className="size-4" />}
                  onClick={() => setDialog({ kind: 'receive' })}
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
          {/*
           * Four colour-coded boxes carry the six stock figures. The colour tells the stock
           * story before any text is read: green is what we own, blue is what is free to use
           * right now, ash flags pending reservations, red flags quarantined stock. Reserved
           * and Quarantined stay quiet (white box) when there is nothing to call out.
           */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FigureBox
              tone="success"
              primary={{ label: t.inventory.totalOwned, value: detail.totalOwned }}
              secondary={{ label: t.inventory.onHand, value: detail.totalOnHand }}
            />
            <FigureBox
              tone="info"
              primary={{ label: t.inventory.available, value: detail.totalAvailable }}
              secondary={{ label: t.inventory.inProjectUse, value: detail.totalInUse }}
            />
            <FigureBox
              tone={detail.totalReserved > 0 ? 'pending' : 'empty'}
              primary={{ label: t.inventory.reserved, value: detail.totalReserved }}
            />
            <FigureBox
              tone={detail.totalQuarantined > 0 ? 'danger' : 'empty'}
              primary={{ label: t.inventory.quarantined, value: detail.totalQuarantined }}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
            <span className="font-medium uppercase tracking-wide text-ink-subtle">
              {t.users.status}
            </span>
            <Badge tone={detail.isActive ? 'success' : 'danger'}>
              {detail.isActive ? t.common.active : t.inventory.archived}
            </Badge>
            <Badge tone="neutral">
              {detail.defaultReturnable
                ? t.inventory.defaultReturnable
                : t.inventory.consumable}
            </Badge>
          </div>
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
                  <PlacementChip
                    key={placement.id}
                    placement={placement}
                    canManageStock={canManageStock}
                    onQuarantine={(p) => setDialog({ kind: 'quarantine', placement: p })}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {detail.isTrackable ? (
          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">
              {t.borrowing.currentlyInUse}
            </h2>
            <ActiveBorrowsSection borrows={detail.activeBorrows} />
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
              loadingFallback={<SkeletonRows columns={5} rows={3} />}
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
                    t.borrowing.returnCondition,
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
                      <td className="px-4 py-2.5 text-sm text-ink-muted">
                        {entry.condition
                          ? t.borrowing.conditionLabels[entry.condition]
                          : t.common.dash}
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
        open={dialog?.kind === 'receive'}
        onClose={close}
        productId={detail.id}
        zones={zones ?? []}
      />
      <MoveStockDialog
        open={dialog?.kind === 'move'}
        onClose={close}
        productId={detail.id}
        placements={detail.placements}
        zones={zones ?? []}
      />
      <AdjustStockDialog
        open={dialog?.kind === 'adjust'}
        onClose={close}
        productId={detail.id}
        placements={detail.placements}
      />
      {activePlacement ? (
        <QuarantineDialog
          open
          onClose={close}
          productId={detail.id}
          placement={activePlacement}
        />
      ) : null}
      <ProductFormDialog open={dialog?.kind === 'edit'} onClose={close} editing={detail} />
      <BorrowDialog open={dialog?.kind === 'borrow'} onClose={close} product={detail} />
    </>
  );
}