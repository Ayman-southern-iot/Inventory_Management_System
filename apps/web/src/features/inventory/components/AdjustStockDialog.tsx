import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { adjustStockSchema, type AdjustStockInput, type Placement } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { QuantityField } from './QuantityField';
import { useAdjustStock } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  placements: Placement[];
}

/**
 * A stock-take correction. `delta` is signed, and the reason is mandatory — an unexplained
 * adjustment is indistinguishable from theft when someone reads the ledger back in six months.
 */
export function AdjustStockDialog({ open, onClose, productId, placements }: Props) {
  const toast = useToast();
  const adjustStock = useAdjustStock();

  const form = useForm<AdjustStockInput>({
    resolver: zodResolver(adjustStockSchema),
    defaultValues: { productId, compartmentId: '', delta: undefined, reason: '' },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        productId,
        compartmentId: placements[0]?.compartmentId ?? '',
        delta: undefined,
        reason: '',
      });
    }
  }, [open, productId, placements, form]);

  async function onSubmit(values: AdjustStockInput) {
    try {
      await adjustStock.mutateAsync(values);
      toast.success(t.inventory.stockAdjusted);
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
      title={t.inventory.adjustStock}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button form="adjust-stock-form" type="submit" isLoading={isSubmitting}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form
        id="adjust-stock-form"
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
          {placements.map((placement) => (
            <option key={placement.compartmentId} value={placement.compartmentId}>
              {placement.zoneName} / {placement.compartmentCode} — {placement.quantity}
            </option>
          ))}
        </SelectField>

        <QuantityField
          control={form.control}
          name="delta"
          label={t.inventory.adjustment}
          hint={t.inventory.adjustmentHint}
          error={errors.delta?.message}
        />

        <TextAreaField
          label={t.inventory.reason}
          hint={t.inventory.reasonHint}
          error={errors.reason?.message}
          {...form.register('reason')}
        />
      </form>
    </Dialog>
  );
}
