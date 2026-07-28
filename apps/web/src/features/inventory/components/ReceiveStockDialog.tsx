import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { receiveStockSchema, type ReceiveStockInput, type Zone } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { QuantityField } from './QuantityField';
import { useReceiveStock } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  zones: Zone[];
}

export function ReceiveStockDialog({ open, onClose, productId, zones }: Props) {
  const toast = useToast();
  const receiveStock = useReceiveStock();

  const form = useForm<ReceiveStockInput>({
    resolver: zodResolver(receiveStockSchema),
    defaultValues: { productId, compartmentId: '', quantity: undefined },
  });

  // A deactivated compartment cannot take stock — the API refuses it, so do not offer it.
  const compartments = useMemo(
    () =>
      zones
        .filter((zone) => zone.isActive)
        .flatMap((zone) =>
          zone.compartments
            .filter((compartment) => compartment.isActive)
            .map((compartment) => ({
              id: compartment.id,
              label: `${zone.name} / ${compartment.code}`,
            })),
        ),
    [zones],
  );

  useEffect(() => {
    if (open) form.reset({ productId, compartmentId: '', quantity: undefined });
  }, [open, productId, form]);

  async function onSubmit(values: ReceiveStockInput) {
    try {
      await receiveStock.mutateAsync(values);
      toast.success(t.inventory.stockReceived);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.inventory.receiveStock}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button form="receive-stock-form" type="submit" isLoading={isSubmitting}>
            {t.inventory.receiveStock}
          </Button>
        </>
      }
    >
      <form
        id="receive-stock-form"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        <SelectField
          label={t.inventory.compartment}
          error={errors.compartmentId?.message}
          {...form.register('compartmentId')}
        >
          <option value="">{t.inventory.chooseCompartment}</option>
          {compartments.map((compartment) => (
            <option key={compartment.id} value={compartment.id}>
              {compartment.label}
            </option>
          ))}
        </SelectField>

        <QuantityField
          control={form.control}
          name="quantity"
          label={t.inventory.quantity}
          error={errors.quantity?.message}
          min={1}
        />

        <TextField label={t.common.note} {...form.register('note')} />
      </form>
    </Dialog>
  );
}
