import { useEffect, useState } from 'react';
import type { PurchaseLine, RequisitionFunding } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useCategoryTree, useZones } from '@/features/inventory/api';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useReceiveIntoStock } from './api';

/** The picker needs a flat list; the API returns the tree the categories screen renders. */
function flattenCategories(
  nodes: Array<{ id: string; name: string; children: Array<unknown> }>,
  depth = 0,
): Array<{ id: string; name: string }> {
  return nodes.flatMap((node) => [
    { id: node.id, name: depth > 0 ? `${'— '.repeat(depth)}${node.name}` : node.name },
    ...flattenCategories(
      node.children as Array<{ id: string; name: string; children: Array<unknown> }>,
      depth + 1,
    ),
  ]);
}

interface LineState {
  include: boolean;
  quantity: string;
  compartmentId: string;
  productCode: string;
  productName: string;
  categoryId: string;
  unit: string;
}

/**
 * Putting a verified purchase onto the shelf.
 *
 * Only lines with something still outstanding are offered — a fully received line has nothing
 * left to give, and showing it would invite a 409. Lines whose requisition item is still free
 * text also need product details, because receiving is what turns them into catalogue products.
 */
export function ReceiveToStockForm({
  requisitionId,
  funding,
  onClose,
}: {
  requisitionId: string;
  funding: RequisitionFunding | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const receive = useReceiveIntoStock(requisitionId);
  const categories = useCategoryTree();
  const zones = useZones();

  const outstanding: PurchaseLine[] = (funding?.purchases ?? [])
    .flatMap((purchase) => purchase.lines)
    .filter((line) => line.outstandingQuantity > 0);

  const [lines, setLines] = useState<Record<string, LineState>>({});

  useEffect(() => {
    const initial: Record<string, LineState> = {};
    for (const line of outstanding) {
      initial[line.id] = {
        include: true,
        quantity: String(line.outstandingQuantity),
        compartmentId: '',
        productCode: '',
        productName: line.itemName,
        categoryId: '',
        unit: 'pcs',
      };
    }
    setLines(initial);
    // Keyed on the ids so re-renders from an unrelated refetch do not wipe what the user typed.
  }, [outstanding.map((line) => line.id).join(',')]);

  const compartments = (zones.data ?? []).flatMap((zone) =>
    zone.compartments.map((compartment) => ({
      id: compartment.id,
      label: `${zone.name} · ${compartment.code}`,
    })),
  );

  function update(id: string, patch: Partial<LineState>) {
    setLines((previous) => ({ ...previous, [id]: { ...previous[id]!, ...patch } }));
  }

  async function onSubmit() {
    const selected = outstanding.filter((line) => lines[line.id]?.include);
    if (selected.length === 0) return;

    try {
      await receive.mutateAsync({
        note: null,
        lines: selected.map((line) => {
          const state = lines[line.id]!;
          return {
            purchaseLineId: line.id,
            compartmentId: state.compartmentId,
            quantity: Number(state.quantity),
            // Only sent when the item has no catalogue product yet; the server ignores it
            // otherwise, but sending a half-filled block would be noise in the audit metadata.
            ...(line.productId
              ? {}
              : {
                  newProduct: {
                    productCode: state.productCode.trim(),
                    name: state.productName.trim(),
                    categoryId: state.categoryId,
                    unit: state.unit.trim() || 'pcs',
                  },
                }),
          };
        }),
      });
      toast.success(t.funds.stocked);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t.funds.receiveToStock}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={receive.isPending}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void onSubmit()} isLoading={receive.isPending}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {outstanding.map((line) => {
          const state = lines[line.id];
          if (!state) return null;

          return (
            <div key={line.id} className="rounded-[--radius-control] border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={state.include}
                  onChange={(event) => update(line.id, { include: event.target.checked })}
                />
                {line.itemName}
                <span className="text-xs font-normal text-ink-subtle">
                  {t.funds.lineOutstanding(line.outstandingQuantity)}
                </span>
              </label>

              {state.include && (
                <div className="mt-3 flex flex-col gap-3">
                  <TextField
                    label={t.funds.quantity}
                    type="number"
                    min={1}
                    max={line.outstandingQuantity}
                    value={state.quantity}
                    onChange={(event) => update(line.id, { quantity: event.target.value })}
                  />

                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-ink">{t.funds.compartment}</span>
                    <select
                      value={state.compartmentId}
                      onChange={(event) => update(line.id, { compartmentId: event.target.value })}
                      className="rounded-[--radius-control] border border-border bg-surface px-2.5 py-1.5 text-sm"
                    >
                      <option value="">{t.common.none}</option>
                      {compartments.map((compartment) => (
                        <option key={compartment.id} value={compartment.id}>
                          {compartment.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* A free-text requisition line becomes a real product here, once. */}
                  {!line.productId && (
                    <div className="flex flex-col gap-3 rounded-[--radius-control] bg-surface-muted p-3">
                      <div>
                        <p className="text-sm font-medium text-ink">{t.funds.newProductTitle}</p>
                        <p className="text-xs text-ink-subtle">{t.funds.newProductHint}</p>
                      </div>
                      <TextField
                        label={t.funds.productCode}
                        value={state.productCode}
                        onChange={(event) => update(line.id, { productCode: event.target.value })}
                      />
                      <TextField
                        label={t.funds.productName}
                        value={state.productName}
                        onChange={(event) => update(line.id, { productName: event.target.value })}
                      />
                      <label className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-ink">{t.funds.category}</span>
                        <select
                          value={state.categoryId}
                          onChange={(event) => update(line.id, { categoryId: event.target.value })}
                          className="rounded-[--radius-control] border border-border bg-surface px-2.5 py-1.5 text-sm"
                        >
                          <option value="">{t.common.none}</option>
                          {flattenCategories(categories.data ?? []).map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <TextField
                        label={t.funds.unit}
                        value={state.unit}
                        onChange={(event) => update(line.id, { unit: event.target.value })}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
