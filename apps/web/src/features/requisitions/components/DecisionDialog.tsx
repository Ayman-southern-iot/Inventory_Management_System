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
import { useMySignature } from '@/features/profile/api';
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
    defaultValues: { approve: true, note: null, approvedAmount: null, withSignature: false },
  });

  // Only fetched while the dialog is open and we are approving — an approver's signature is
  // irrelevant to a rejection, and the query would 403 for a role that cannot sign.
  const signature = useMySignature(deciding?.approve === true);
  const hasSignature = Boolean(signature.data?.signature);

  useEffect(() => {
    if (deciding) {
      form.reset({
        approve: deciding.approve,
        note: null,
        approvedAmount: null,
        // Never carried over between dialogs: signing must be chosen each time.
        withSignature: false,
      });
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
          {/* Approving offers both options as separate buttons rather than a checkbox: signing is
              a distinct act, and the approver should be choosing it explicitly at the moment they
              commit, not toggling a control they might not have noticed. A rejection is never
              signed, so it keeps one button. */}
          {isRejecting ? (
            <Button
              form="decision-form"
              type="submit"
              variant="danger"
              isLoading={form.formState.isSubmitting}
            >
              {t.requisitions.reject}
            </Button>
          ) : (
            <>
              <Button
                form="decision-form"
                type="submit"
                variant="secondary"
                isLoading={form.formState.isSubmitting && !form.getValues('withSignature')}
                onClick={() => form.setValue('withSignature', false)}
              >
                {t.requisitions.approveWithoutSignature}
              </Button>
              <Button
                form="decision-form"
                type="submit"
                variant="primary"
                disabled={!hasSignature}
                title={hasSignature ? undefined : t.requisitions.noSignatureHint}
                isLoading={form.formState.isSubmitting && form.getValues('withSignature')}
                onClick={() => form.setValue('withSignature', true)}
              >
                {t.requisitions.approveWithSignature}
              </Button>
            </>
          )}
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
