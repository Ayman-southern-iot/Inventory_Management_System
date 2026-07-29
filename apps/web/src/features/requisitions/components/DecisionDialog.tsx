import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ApprovalStage,
  decideRequisitionSchema,
  type Approval,
  type DecideRequisitionInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useDecideRequisition } from '../api';

interface Props {
  deciding: { approval: Approval; approve: boolean } | null;
  requestedAmount: number | null;
  onClose: () => void;
}

export function DecisionDialog({ deciding, requestedAmount, onClose }: Props) {
  const toast = useToast();
  const decide = useDecideRequisition();

  const form = useForm<DecideRequisitionInput>({
    resolver: zodResolver(decideRequisitionSchema),
    defaultValues: { approve: true, note: null, approvedAmount: null },
  });

  useEffect(() => {
    if (deciding) {
      form.reset({ approve: deciding.approve, note: null, approvedAmount: null });
    }
  }, [deciding, form]);

  async function onSubmit(values: DecideRequisitionInput) {
    if (!deciding) return;
    try {
      await decide.mutateAsync({ approvalId: deciding.approval.id, input: values });
      toast.success(deciding.approve ? t.requisitions.approvedToast : t.requisitions.rejectedToast);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const isRejecting = deciding?.approve === false;
  // Only an approver sets the sanctioned figure; the IM's stage is "do we already have it".
  const canReviseAmount =
    deciding?.approve === true && deciding.approval.stage === ApprovalStage.APPROVER;

  return (
    <Dialog
      open={deciding !== null}
      onClose={onClose}
      title={isRejecting ? t.requisitions.reject : t.requisitions.approve}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={form.formState.isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button
            form="decision-form"
            type="submit"
            variant={isRejecting ? 'danger' : 'primary'}
            isLoading={form.formState.isSubmitting}
          >
            {isRejecting ? t.requisitions.reject : t.requisitions.approve}
          </Button>
        </>
      }
    >
      <form
        id="decision-form"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        {isRejecting ? (
          <p className="rounded-[--radius-control] bg-danger-subtle px-3 py-2 text-xs text-ink">
            {/* One rejection is terminal — say so before they click, not after. */}
            {t.requisitions.rejectWarning}
          </p>
        ) : null}

        {canReviseAmount ? (
          <TextField
            label={t.requisitions.reviseAmount}
            hint={`${t.requisitions.reviseAmountHint} (${(requestedAmount ?? 0).toLocaleString()})`}
            type="number"
            min={0}
            step="0.01"
            error={form.formState.errors.approvedAmount?.message}
            {...form.register('approvedAmount', {
              setValueAs: (value: string) => (value === '' ? null : Number(value)),
            })}
          />
        ) : null}

        <TextAreaField
          label={t.requisitions.decisionNote}
          error={form.formState.errors.note?.message}
          {...form.register('note')}
        />
      </form>
    </Dialog>
  );
}
