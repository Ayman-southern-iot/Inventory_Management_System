import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  resolveQuarantineSchema,
  QuarantineAction,
  type Placement,
  type ResolveQuarantineInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { QuantityField } from './QuantityField';
import { useResolveQuarantine } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  /**
   * The IM clicks Release/Dispose next to a particular placement chip. We receive the row
   * directly so the dialog knows which compartment to act on and what the maximum
   * `quarantined_qty` is — submitting more than that returns a 409.
   */
  placement: Placement;
}

/**
 * Settle a quarantined placement. RELEASE marks the units as verified usable; DISPOSE writes
 * them off. Both require a note: the future reader needs to know what the IM did with the
 * damaged goods, and "verified usable" / "scrapped" are the only honest answers.
 */
export function QuarantineDialog({ open, onClose, productId, placement }: Props) {
  const toast = useToast();
  const resolve = useResolveQuarantine();

  const form = useForm<ResolveQuarantineInput>({
    resolver: zodResolver(resolveQuarantineSchema),
    defaultValues: {
      productId,
      compartmentId: placement.compartmentId,
      action: QuarantineAction.RELEASE,
      quantity: placement.quarantinedQty,
      note: '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        productId,
        compartmentId: placement.compartmentId,
        action: QuarantineAction.RELEASE,
        quantity: placement.quarantinedQty,
        note: '',
      });
    }
  }, [open, productId, placement.compartmentId, placement.quarantinedQty, form]);

  async function onSubmit(values: ResolveQuarantineInput) {
    try {
      await resolve.mutateAsync(values);
      toast.success(
        values.action === QuarantineAction.RELEASE
          ? t.borrowing.quarantineReleasedToast
          : t.borrowing.quarantineDisposedToast,
      );
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
      title={t.borrowing.quarantineDialogTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button form="quarantine-form" type="submit" isLoading={isSubmitting}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form
        id="quarantine-form"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        <SelectField
          label={t.borrowing.quarantineDialogTitle}
          error={errors.action?.message}
          {...form.register('action')}
        >
          <option value={QuarantineAction.RELEASE}>{t.borrowing.quarantineRelease}</option>
          <option value={QuarantineAction.DISPOSE}>{t.borrowing.quarantineDispose}</option>
        </SelectField>

        <QuantityField
          control={form.control}
          name="quantity"
          label={t.borrowing.quarantineQuantityLabel}
          hint={`${t.borrowing.quarantineQuantityHint} (max ${placement.quarantinedQty})`}
          error={errors.quantity?.message}
          min={1}
          max={placement.quarantinedQty}
        />

        <TextAreaField
          label={t.borrowing.quarantineNoteLabel}
          hint={t.borrowing.quarantineNoteHint}
          error={errors.note?.message}
          {...form.register('note')}
        />
      </form>
    </Dialog>
  );
}