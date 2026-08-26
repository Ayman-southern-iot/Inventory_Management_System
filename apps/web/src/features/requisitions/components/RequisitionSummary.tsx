import { Info, Send, TriangleAlert } from 'lucide-react';
import { approversRequiredFor, type ApprovalPolicy } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatBdt } from '@/lib/format';

/**
 * The running cost of the requisition, and what that cost will require of it.
 *
 * Sticky, because the figure it carries is the one that decides how many people have to sign the
 * request — and the requester is typing line items several screens further down by the time it
 * starts to matter.
 *
 * Every number here is derived from what is on screen; nothing is fetched per keystroke and
 * nothing waits on the server. The threshold itself comes from `GET /requisitions/approval-policy`
 * once, on mount, because it is an `app_settings` value an admin can change at run time
 * (requirements §11) and a number hardcoded here would start lying the first time they did.
 */
interface RequisitionSummaryProps {
  itemsTotal: number;
  transportationTotal: number;
  requestedTotal: number;
  policy: ApprovalPolicy | undefined;
  isSubmitting: boolean;
  onSaveDraft: () => void;
  onSubmit: () => void;
}

/** "1 approver" / "2 approvers" — the count is part of the sentence, so it is part of the copy. */
function approverCount(count: number): string {
  return count === 1
    ? t.requisitions.approverCountOne
    : t.requisitions.approverCountOther.replace('{n}', String(count));
}

export function RequisitionSummary({
  itemsTotal,
  transportationTotal,
  requestedTotal,
  policy,
  isSubmitting,
  onSaveDraft,
  onSubmit,
}: RequisitionSummaryProps) {
  /**
   * `approversRequiredFor` is the shared helper the boundary is defined in, so the note and the
   * server cannot drift. The boundary is **inclusive** (OQ-01): a requisition for exactly the
   * threshold needs the higher count, which is why this says "at or above" and never "over".
   */
  const required = policy ? approversRequiredFor(requestedTotal, policy) : null;
  const isAtOrAboveThreshold = policy ? requestedTotal >= policy.expenseThresholdBdt : false;

  return (
    <aside className="lg:sticky lg:top-6">
      <div className="rounded-[--radius-panel] border border-border bg-surface p-5 shadow-[--shadow-panel]">
        <h2 className="text-label font-semibold text-ink">{t.requisitions.summaryHeading}</h2>

        <dl className="mt-4 flex flex-col gap-1.5 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-micro font-semibold uppercase tracking-wider text-ink-subtle">{t.requisitions.transportation.itemsTotal}</dt>
            <dd className="font-mono tabular-nums text-ink">{formatBdt(itemsTotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-micro font-semibold uppercase tracking-wider text-ink-subtle">
              {t.requisitions.transportation.transportationTotal}
            </dt>
            <dd className="font-mono tabular-nums text-ink">{formatBdt(transportationTotal)}</dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between border-t border-border pt-3">
            <dt className="font-medium text-ink">{t.requisitions.transportation.requested}</dt>
            <dd className="font-mono text-xl font-semibold tabular-nums text-ink">
              {formatBdt(requestedTotal)}
            </dd>
          </div>
        </dl>

        {/* Rendered only once the policy has loaded. A note that guesses a threshold and then
            corrects itself is worse than one that arrives a moment late. */}
        {policy && required !== null ? (
          <div
            className={cn(
              'mt-4 flex gap-2.5 rounded-[--radius-control] p-3 text-xs leading-relaxed',
              isAtOrAboveThreshold
                ? 'bg-pending-subtle text-ink'
                : 'bg-brand-subtle text-ink',
            )}
          >
            {isAtOrAboveThreshold ? (
              <TriangleAlert aria-hidden className="mt-px size-4 shrink-0 text-pending" />
            ) : (
              <Info aria-hidden className="mt-px size-4 shrink-0 text-brand" />
            )}
            <p>
              <span className="font-semibold">{approverCount(required)}</span>{' '}
              {isAtOrAboveThreshold
                ? t.requisitions.approverNoteAtOrAbove.replace(
                    '{threshold}',
                    formatBdt(policy.expenseThresholdBdt),
                  )
                : t.requisitions.approverNoteBelow
                    .replace('{threshold}', formatBdt(policy.expenseThresholdBdt))
                    .replace('{higher}', approverCount(policy.approversAtOrAboveThreshold))}
            </p>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          <Button
            type="button"
            icon={<Send aria-hidden className="size-4" />}
            isLoading={isSubmitting}
            onClick={onSubmit}
          >
            {t.requisitions.submit}
          </Button>
          <Button type="button" variant="secondary" isLoading={isSubmitting} onClick={onSaveDraft}>
            {t.requisitions.saveDraft}
          </Button>
        </div>

        <p className="mt-3 text-xs text-ink-subtle">{t.requisitions.submitHint}</p>
      </div>
    </aside>
  );
}
