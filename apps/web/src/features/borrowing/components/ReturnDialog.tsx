import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { returnBorrowSchema, type BorrowRequest, type ReturnBorrowInput } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { QuantityField } from '@/features/inventory/components/QuantityField';
import { useZones } from '@/features/inventory/api';
import { useReturnBorrow } from '../api';

export function ReturnDialog({ borrow, onClose }: { borrow?: BorrowRequest; onClose: () => void }) {
  const toast = useToast();
  const returnBorrow = useReturnBorrow();
  const zones = useZones();

  const compartments = useMemo(
    () =>
      (zones.data ?? [])
        .filter((zone) => zone.isActive)
        .flatMap((zone) =>
          zone.compartments
            .filter((compartment) => compartment.isActive)
            .map((compartment) => ({
              id: compartment.id,
              label: `${zone.name} / ${compartment.code}`,
            })),
        ),
    [zones.data],
  );

  const form = useForm<ReturnBorrowInput>({
    resolver: zodResolver(returnBorrowSchema),
    defaultValues: { quantity: undefined, compartmentId: '', conditionNote: null },
  });

  useEffect(() => {
    if (!borrow) return;
    form.reset({
      // Defaults to everything still out, since a full return is the common case.
      quantity: borrow.outstandingQty,
      // Back where it came from unless the IM reshelves it.
      compartmentId: borrow.compartmentId,
      conditionNote: null,
    });
  }, [borrow, form]);

  async function onSubmit(values: ReturnBorrowInput) {
    if (!borrow) return;
    try {
      await returnBorrow.mutateAsync({ id: borrow.id, input: values });
      toast.success(t.borrowing.returned);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog
      open={borrow !== undefined}
      onClose={onClose}
      title={`${t.borrowing.recordReturn}${borrow ? ` — ${borrow.borrowNo}` : ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button form="return-form" type="submit" isLoading={isSubmitting}>
            {t.borrowing.recordReturn}
          </Button>
        </>
      }
    >
      <form
        id="return-form"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        <QuantityField
          control={form.control}
          name="quantity"
          label={t.borrowing.quantity}
          hint={`${t.borrowing.outstanding}: ${borrow?.outstandingQty ?? 0} ${borrow?.unit ?? ''}`}
          error={errors.quantity?.message}
          min={1}
          max={borrow?.outstandingQty ?? 1}
        />
        <p className="-mt-2 text-xs text-ink-subtle">{t.borrowing.outstandingHint}</p>

        <SelectField
          label={t.borrowing.returnTo}
          error={errors.compartmentId?.message}
          {...form.register('compartmentId')}
        >
          {compartments.map((compartment) => (
            <option key={compartment.id} value={compartment.id}>
              {compartment.label}
            </option>
          ))}
        </SelectField>

        <TextAreaField
          label={t.borrowing.conditionNote}
          error={errors.conditionNote?.message}
          {...form.register('conditionNote')}
        />
      </form>
    </Dialog>
  );
}
