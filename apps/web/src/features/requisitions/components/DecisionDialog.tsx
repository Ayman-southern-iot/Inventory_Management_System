import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ApprovalStage,
  decideRequisitionShape,
  requireNoteOnReject,
  type Approval,
  type DecideRequisitionInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import {
  useDeleteSignature,
  useMySignature,
  useUploadSignature,
} from '@/features/profile/api';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useApprovalPolicy, useDecideRequisition } from '../api';

/**
 * Local form shape: the shared `decideRequisitionSchema` plus a UI-only `reviseAmount` gate.
 * The gate is stripped before submission and forces `approvedAmount: null` when off, so a
 * rendered-but-untouched number input can never submit 0 by accident.
 */
const formSchema = decideRequisitionShape
  .extend({
    reviseAmount: z.boolean().default(false),
  })
  // The same rule the API applies, imported rather than restated: a rejection says why.
  .superRefine(requireNoteOnReject);
type FormShape = z.infer<typeof formSchema>;

interface Props {
  deciding: { approval: Approval; approve: boolean } | null;
  requestedAmount: number | null;
  /**
   * Whether the requisition has anything to shrink — more than one line, or one line of more
   * than one unit. Passed in rather than derived here: the dialog is handed one approval, not
   * the requisition, and guessing from `requestedAmount` alone cannot tell a 500 lamp from
   * five 100 lamps (QA-034).
   */
  isAdjustable: boolean;
  onClose: () => void;
}

export function DecisionDialog({ deciding, requestedAmount, isAdjustable, onClose }: Props) {
  const toast = useToast();
  const decide = useDecideRequisition();
  // Already cached by the requisition form; this is a read from the same query.
  const { data: policy } = useApprovalPolicy();

  const form = useForm<FormShape>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      approve: true,
      note: null,
      approvedAmount: null,
      // Signing must be chosen each time, never carried over between dialogs.
      withSignature: false,
      // Opt-in gate for the amount field. Off by default: most approvers will not revise, and
      // a rendered-but-untouched number input can submit 0 by accident (see issue #3 in the
      // bug write-up). With the gate off, the input is unmounted entirely so RHF never sees it.
      reviseAmount: false,
    },
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
        reviseAmount: false,
      });
    }
  }, [deciding, form]);

  async function onSubmit(values: FormShape) {
    if (!deciding) return;
    // Strip the UI-only gate field and apply its rule: if the gate is off, the amount MUST be
    // null regardless of what the input says, so the backend skips the column update.
    const input: DecideRequisitionInput = {
      approve: values.approve,
      note: values.note,
      approvedAmount: values.reviseAmount ? values.approvedAmount : null,
      withSignature: values.withSignature,
    };
    try {
      await decide.mutateAsync({ approvalId: deciding.approval.id, input });
      toast.success(deciding.approve ? t.requisitions.approvedToast : t.requisitions.rejectedToast);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const isRejecting = deciding?.approve === false;
  // Only an approver sets the approved figure; the IM's stage is "do we already have it".
  const isApproverDeciding =
    deciding?.approve === true && deciding.approval.stage === ApprovalStage.APPROVER;
  // ...and only where a lower figure could actually buy something (QA-034). An indivisible
  // requisition still shows the row, carrying the reason — silently dropping the control
  // reads as a missing feature to an approver who has revised one before.
  /*
   * Revising the sanctioned amount is closed for this release (Ayman, 2026-09-02) while the
   * flow is finished off.
   *
   * Driven by the policy the API publishes rather than a build flag, so the dialog cannot offer
   * a field the server would refuse — and so it comes back on its own when the flag flips.
   */
  const canReviseAmount =
    (policy?.allowsApprovedAmountRevision ?? false) && isApproverDeciding && isAdjustable;
  const reviseAmount = form.watch('reviseAmount');

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

        {!hasSignature && deciding?.approve === true ? (
          <InlineSignatureUploader
            onUploaded={() => {
              toast.success(t.requisitions.signatureUploadedInline);
            }}
            onError={(error) => toast.error(messageForError(error))}
          />
        ) : null}

        {policy?.allowsApprovedAmountRevision && isApproverDeciding && !isAdjustable ? (
          <p className="text-xs text-ink-subtle">{t.requisitions.reviseAmountIndivisible}</p>
        ) : null}

        {canReviseAmount ? (
          <div className="flex flex-col gap-2">
            <Checkbox
              label={t.requisitions.reviseAmountOptIn}
              {...form.register('reviseAmount')}
            />
            <p className="text-xs text-ink-subtle">{t.requisitions.reviseAmountOptInHint}</p>
            {reviseAmount ? (
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
          </div>
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

/**
 * Inline uploader shown only when the approver is missing a signature. Lets them upload without
 * closing the dialog and navigating to the profile page. On success the parent signature query
 * refetches automatically (`useUploadSignature`'s onSuccess invalidates the key), so the
 * "Approve with signature" button becomes enabled in the same render.
 */
function InlineSignatureUploader({
  onUploaded,
  onError,
}: {
  onUploaded: () => void;
  onError: (error: unknown) => void;
}) {
  const upload = useUploadSignature();
  const remove = useDeleteSignature();
  return (
    <div className="rounded-[--radius-control] border border-warning bg-warning-subtle px-3 py-2 text-xs text-ink">
      <p className="mb-2 font-medium text-ink">{t.requisitions.noSignatureTitle}</p>
      <p className="mb-2 text-ink-muted">{t.requisitions.noSignatureBody}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-[--radius-control] border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted">
          {t.requisitions.uploadSignatureHere}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                await upload.mutateAsync(file);
                onUploaded();
              } catch (error) {
                onError(error);
              } finally {
                // Reset the input so the same file can be re-picked after an error.
                event.target.value = '';
              }
            }}
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          isLoading={remove.isPending}
          onClick={() => remove.mutateAsync().then(onUploaded).catch(onError)}
        >
          {t.requisitions.removeSignature}
        </Button>
        {upload.isPending ? (
          <span className="text-ink-muted">{t.requisitions.signatureUploading}</span>
        ) : null}
      </div>
    </div>
  );
}