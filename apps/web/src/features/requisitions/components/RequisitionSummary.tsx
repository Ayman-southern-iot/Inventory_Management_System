import type { ApprovalPolicy } from '@ims/shared';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';
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


export function RequisitionSummary({
  itemsTotal,
  transportationTotal,
  requestedTotal,
  policy: _policy,
  isSubmitting,
  onSaveDraft,
  onSubmit,
}: RequisitionSummaryProps) {

  return (
    <aside className="lg:sticky lg:top-6">
      <div className="rounded-[--radius-panel] border border-border bg-surface p-5 shadow-[--shadow-panel]">
        <h2 className="text-base font-semibold text-ink">{t.requisitions.summaryHeading}</h2>

        <dl className="mt-4 flex flex-col gap-1.5 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-ink-muted">{t.requisitions.transportation.itemsTotal}</dt>
            <dd className="tabular-nums text-ink">{formatBdt(itemsTotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-ink-muted">
              {t.requisitions.transportation.transportationTotal}
            </dt>
            <dd className="tabular-nums text-ink">{formatBdt(transportationTotal)}</dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between border-t border-border pt-3">
            <dt className="font-medium text-ink">{t.requisitions.transportation.requested}</dt>
            <dd className="text-xl font-semibold tabular-nums text-ink">
              {formatBdt(requestedTotal)}
            </dd>
          </div>
        </dl>

        {/*
          The approver-count note is gone (Ayman, 2026-09-02).

          It explained the threshold rule to someone filling in a form who cannot act on it:
          the count is decided by the amount, and the amount is decided by what they need. It
          told them their request would "take longer to clear" without offering anything to do
          about it. The chain is shown on the requisition itself once it is submitted, which is
          where it is actually useful.
        */}

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
