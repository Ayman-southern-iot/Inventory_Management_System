import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { moveStockSchema, type MoveStockInput, type Placement, type Zone } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { QuantityField } from './QuantityField';
import { useMoveStock } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  placements: Placement[];
  zones: Zone[];
}

export function MoveStockDialog({ open, onClose, productId, placements, zones }: Props) {
  const toast = useToast();
  const moveStock = useMoveStock();

  const form = useForm<MoveStockInput>({
    resolver: zodResolver(moveStockSchema),
    defaultValues: { productId, fromCompartmentId: '', toCompartmentId: '', quantity: undefined },
  });

  const fromCompartmentId = form.watch('fromCompartmentId');

  /** Only compartments that actually hold this product can be a source. */
  const sources = useMemo(() => placements.filter((p) => p.availableQty > 0), [placements]);
  const source = useMemo(
    () => placements.find((p) => p.compartmentId === fromCompartmentId),
    [placements, fromCompartmentId],
  );

  /**
   * The cap is `availableQty`, never `quantity`. Reserved units belong to a pending borrow, and
   * offering them here would let the IM move stock out from under a request that is already
   * promised — the API refuses it, but the form must not invite the mistake in the first place.
   */
  const maxMovable = source?.availableQty ?? 0;

  const destinations = useMemo(
    () =>
      zones
        .flatMap((zone) =>
          zone.compartments.map((compartment) => ({
            id: compartment.id,
            label: `${zone.name} / ${compartment.code}`,
            isActive: compartment.isActive,
          })),
        )
        .filter((c) => c.isActive && c.id !== fromCompartmentId),
    [zones, fromCompartmentId],
  );

  useEffect(() => {
    if (open) {
      form.reset({
        productId,
        fromCompartmentId: sources[0]?.compartmentId ?? '',
        toCompartmentId: '',
        quantity: undefined,
      });
    }
    // `sources` is derived from placements, which change after every successful move.
  }, [open, productId, sources, form]);

  async function onSubmit(values: MoveStockInput) {
    try {
      await moveStock.mutateAsync({
        ...values,
        // Sent so the server rejects a move computed against numbers that have since changed.
        ...(source ? { expectedVersion: source.version } : {}),
      });
      toast.success(t.inventory.stockMoved);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog
      schema={moveStockSchema}
      open={open}
      onClose={onClose}
      title={t.inventory.moveStock}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button
            form="move-stock-form"
            type="submit"
            isLoading={isSubmitting}
            disabled={sources.length === 0}
          >
            {t.inventory.moveStock}
          </Button>
        </>
      }
    >
      {sources.length === 0 ? (
        <p className="text-sm text-ink-muted">{t.inventory.nothingToMove}</p>
      ) : (
        <form
          id="move-stock-form"
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <SelectField
            label={t.inventory.fromCompartment}
            error={errors.fromCompartmentId?.message}
            {...form.register('fromCompartmentId')}
          >
            {sources.map((placement) => (
              <option key={placement.compartmentId} value={placement.compartmentId}>
                {placement.zoneName} / {placement.compartmentCode} — {placement.availableQty}{' '}
                {t.inventory.availableShort}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={t.inventory.toCompartment}
            error={errors.toCompartmentId?.message}
            {...form.register('toCompartmentId')}
          >
            <option value="">{t.inventory.chooseCompartment}</option>
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.label}
              </option>
            ))}
          </SelectField>

          <QuantityField
            control={form.control}
            name="quantity"
            label={t.inventory.quantity}
            hint={`${t.inventory.maxMovable}: ${maxMovable}`}
            error={errors.quantity?.message}
            min={1}
            max={maxMovable}
          />

          {source && source.reservedQty > 0 ? (
            <p className="rounded-[--radius-control] bg-pending-subtle px-3 py-2 text-xs text-ink">
              {t.inventory.reservedExcluded.replace('{n}', String(source.reservedQty))}
            </p>
          ) : null}

          <TextField label={t.common.note} {...form.register('note')} />
        </form>
      )}
    </Dialog>
  );
}
