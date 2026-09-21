import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MapPin } from 'lucide-react';
import {
  returnBorrowSchema,
  ReturnCondition,
  type BorrowRequest,
  type ReturnBorrowInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { CompartmentPicker } from '@/components/ui/CompartmentPicker';
import { SelectField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { QuantityField } from '@/features/inventory/components/QuantityField';
import { useZones } from '@/features/inventory/api';
import { useReturnBorrow } from '../api';

/**
 * The four return conditions drive product availability, so the dropdown is required and the
 * default is the safest one — "Good". A blank submit would either be silently accepted as
 * "Good" (the old bug) or rejected for missing field (more honest, so we do that).
 */
const conditionOptions: ReadonlyArray<{ value: ReturnCondition; label: string }> = [
  { value: ReturnCondition.GOOD, label: t.borrowing.conditionGood },
  {
    value: ReturnCondition.PARTIALLY_DAMAGED_USABLE,
    label: t.borrowing.conditionPartiallyDamagedUsable,
  },
  { value: ReturnCondition.DAMAGED, label: t.borrowing.conditionDamaged },
  { value: ReturnCondition.NOT_WORKING, label: t.borrowing.conditionNotWorking },
];

export function ReturnDialog({ borrow, onClose }: { borrow?: BorrowRequest; onClose: () => void }) {
  const toast = useToast();
  const returnBorrow = useReturnBorrow();
  const zones = useZones();


  const form = useForm<ReturnBorrowInput>({
    resolver: zodResolver(returnBorrowSchema),
    defaultValues: {
      quantity: undefined,
      compartmentId: '',
      condition: ReturnCondition.GOOD,
    },
  });

  useEffect(() => {
    if (!borrow) return;
    form.reset({
      // Defaults to everything still out, since a full return is the common case.
      quantity: borrow.outstandingQty,
      // Back where it came from unless the IM reshelves it.
      compartmentId: borrow.compartmentId,
      condition: ReturnCondition.GOOD,
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
  /** The IM has chosen a different shelf, so the offer to undo that is worth showing. */
  const isReshelving =
    borrow !== undefined && form.watch('compartmentId') !== borrow.compartmentId;

  return (
    <Dialog
      schema={returnBorrowSchema}
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

        {/*
          Ayman: the IM should not have to go and look up where the thing came from. The picker
          below already defaults to the origin, but three selects reading "Main Store / Meta /
          1A" do not say *why* — this line does, and the button undoes a reshelve.
        */}
        {borrow ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[--radius-control] border border-border bg-surface-muted px-3 py-2 text-xs">
            <MapPin aria-hidden className="size-3.5 shrink-0 text-ink-subtle" />
            <span className="text-ink-subtle">{t.borrowing.takenFrom}</span>
            <span className="font-medium text-ink">{borrow.location}</span>
            {isReshelving ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() =>
                  form.setValue('compartmentId', borrow.compartmentId, { shouldValidate: true })
                }
              >
                {t.borrowing.putItBack}
              </Button>
            ) : (
              <span className="ml-auto text-ink-subtle">{t.borrowing.takenFromHint}</span>
            )}
          </div>
        ) : null}

        {/*
          Zone first, then the shelves inside it. This one asks "any shelf in the building",
          which is the question the two-step picker is for — unlike Borrow, Adjust and
          Quarantine, which choose among the shelves already holding this product and would be
          made worse by a zone step that can show an empty list.
        */}
        <CompartmentPicker
          zones={zones.data ?? []}
          value={form.watch('compartmentId') ?? ''}
          error={errors.compartmentId?.message}
          onChange={(compartmentId) =>
            form.setValue('compartmentId', compartmentId, { shouldValidate: true })
          }
        />

        <SelectField
          label={t.borrowing.returnCondition}
          error={errors.condition?.message}
          {...form.register('condition')}
        >
          {conditionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </form>
    </Dialog>
  );
}
