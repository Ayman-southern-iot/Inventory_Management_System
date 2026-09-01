import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { voidBomSchema, type VoidBomInput } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useVoidBom } from '../api';

/**
 * The IM must give a written reason before voiding a BOM. The text is recorded
 * verbatim in the audit trail and on the voided BOM row — short, factual
 * sentences work better than "I changed my mind".
 *
 * Modeled on `DecisionDialog` (requisitions): one form field, one submit
 * button, footer with cancel + danger confirm.
 */
export function BomVoidDialog({
  bomId,
  open,
  onClose,
}: {
  bomId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const voidBom = useVoidBom();

  const form = useForm<VoidBomInput>({
    resolver: zodResolver(voidBomSchema),
    defaultValues: { reason: '' },
  });

  useEffect(() => {
    if (open) form.reset({ reason: '' });
  }, [open, form]);

  async function onSubmit(values: VoidBomInput) {
    if (!bomId) return;
    try {
      await voidBom.mutateAsync({ id: bomId, input: values });
      toast.success(t.boms.voidedToast);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <Dialog
      schema={voidBomSchema}
      open={open}
      onClose={onClose}
      title={t.boms.voidTitle}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={form.formState.isSubmitting}
          >
            {t.common.cancel}
          </Button>
          <Button
            form="void-bom-form"
            type="submit"
            variant="danger"
            isLoading={form.formState.isSubmitting}
          >
            {t.boms.voidConfirm}
          </Button>
        </>
      }
    >
      <form
        id="void-bom-form"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        <p className="rounded-[--radius-control] bg-danger-subtle px-3 py-2 text-xs text-ink">
          {t.boms.voidHint}
        </p>
        <TextAreaField
          label={t.boms.voidReason}
          hint={t.boms.voidReasonHint}
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
      </form>
    </Dialog>
  );
}
