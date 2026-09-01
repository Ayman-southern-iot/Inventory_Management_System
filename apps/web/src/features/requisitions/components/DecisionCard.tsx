import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Check, Pencil, X } from 'lucide-react';
import {
  ApprovalStage,
  decideRequisitionSchema,
  type Approval,
  type DecideRequisitionInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useMySignature } from '@/features/profile/api';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useDecideRequisition } from '../api';

const formSchema = decideRequisitionSchema;
type FormShape = z.infer<typeof formSchema>;

/**
 * The decision, on the page.
 *
 * It used to be two buttons in the page header beside Edit, Cancel and Withdraw, opening a
 * dialog — the one thing an approver came to do, in a row with things they did not, above the
 * figures they need to read first. The approving-view template puts it last in the left column,
 * so the decision reads as the conclusion of the page.
 *
 * Approving happens here. Rejecting still opens a confirmation, because one rejection ends the
 * whole request for every remaining approver and that warning has to be read before the click,
 * not after.
 */
export function DecisionCard({
  approval,
  requestedAmount,
  isAdjustable,
  onReject,
}: {
  approval: Approval;
  requestedAmount: number | null;
  /**
   * Whether the requisition has anything to shrink — more than one line, or one line of more
   * than one unit. A single indivisible item has no lower figure that still buys it (QA-034).
   */
  isAdjustable: boolean;
  onReject: () => void;
}) {
  const toast = useToast();
  const decide = useDecideRequisition();
  const signature = useMySignature(true);
  const hasSignature = Boolean(signature.data?.signature);

  /**
   * The revise field is behind a button, the way the requisition form hides transportation
   * behind a switch (Ayman, 2026-08-29). Off by default for the same two reasons: most
   * approvals do not revise anything, and a number input that is rendered but never touched can
   * submit 0 by accident.
   */
  const [revising, setRevising] = useState(false);

  const form = useForm<FormShape>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      approve: true,
      note: null,
      approvedAmount: null,
      // Signing is chosen at the moment of committing, never carried over.
      withSignature: false,
    },
  });

  // Only an approver sets the approved figure; the IM's stage asks "do we already have it".
  const canRevise = approval.stage === ApprovalStage.APPROVER && isAdjustable;
  const isIndivisible = approval.stage === ApprovalStage.APPROVER && !isAdjustable;

  async function onSubmit(values: FormShape) {
    const payload: DecideRequisitionInput = {
      approve: true,
      note: values.note?.trim() ? values.note.trim() : null,
      // Closed means "approve the full amount", whatever is left in the field.
      approvedAmount: revising ? values.approvedAmount : null,
      withSignature: values.withSignature,
    };
    try {
      await decide.mutateAsync({ approvalId: approval.id, input: payload });
      toast.success(t.requisitions.approvedToast);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <section className="overflow-hidden rounded-[--radius-panel] border border-pending/40 bg-surface shadow-[--shadow-panel]">
      <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">{t.requisitions.yourDecision}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">{t.requisitions.yourDecisionHint}</p>
          </div>

          <TextAreaField
            label={t.requisitions.decisionNote}
            hint={t.requisitions.decisionNoteOptional}
            error={form.formState.errors.note?.message}
            {...form.register('note')}
          />

          {canRevise ? (
            <div className="flex flex-col gap-2">
              {revising ? (
                <Controller
                  control={form.control}
                  name="approvedAmount"
                  render={({ field }) => (
                    <TextField
                      label={t.requisitions.reviseAmount}
                      hint={`${t.requisitions.reviseAmountHint} (${(requestedAmount ?? 0).toLocaleString()})`}
                      type="number"
                      min={0}
                      step="0.01"
                      error={form.formState.errors.approvedAmount?.message}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ''}
                      onChange={(event) =>
                        field.onChange(event.target.value === '' ? null : Number(event.target.value))
                      }
                    />
                  )}
                />
              ) : null}
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<Pencil aria-hidden className="size-4" />}
                  onClick={() => {
                    // Closing clears the figure as well as hiding it: a value left behind in a
                    // collapsed field is money nobody can see they are approving.
                    // resetField, not setValue: the input is uncontrolled, so setting the form
                    // value alone leaves the typed figure sitting in the DOM and it reappears
                    // the moment the field is opened again.
                    if (revising) form.resetField('approvedAmount', { defaultValue: null });
                    setRevising((open) => !open);
                  }}
                >
                  {revising ? t.requisitions.reviseAmountCancel : t.requisitions.reviseAmountOpen}
                </Button>
              </div>
            </div>
          ) : null}

          {isIndivisible ? (
            <p className="text-xs text-ink-subtle">{t.requisitions.reviseAmountIndivisible}</p>
          ) : null}

          {!hasSignature ? (
            <p className="text-xs text-ink-subtle">{t.requisitions.noSignatureHint}</p>
          ) : null}
        </div>

        {/* Actions on their own footer band, right-aligned, as the template has them. */}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-canvas px-5 py-3">
          <Button
            type="button"
            variant="secondary"
            icon={<X aria-hidden className="size-4 text-danger" />}
            onClick={onReject}
          >
            {t.requisitions.reject}
          </Button>
          {/* Two buttons rather than a checkbox: signing is a distinct act, and the approver
              should choose it explicitly at the moment they commit rather than toggling a
              control they might not have noticed. */}
          <Button
            type="submit"
            variant="secondary"
            isLoading={form.formState.isSubmitting && !form.getValues('withSignature')}
            onClick={() => form.setValue('withSignature', false)}
          >
            {t.requisitions.approveWithoutSignature}
          </Button>
          <Button
            type="submit"
            icon={<Check aria-hidden className="size-4" />}
            disabled={!hasSignature}
            title={hasSignature ? undefined : t.requisitions.noSignatureHint}
            isLoading={form.formState.isSubmitting && form.getValues('withSignature')}
            onClick={() => form.setValue('withSignature', true)}
          >
            {t.requisitions.approveWithSignature}
          </Button>
        </div>
      </form>
    </section>
  );
}
