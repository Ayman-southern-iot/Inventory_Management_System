import type { ReactNode } from 'react';
import type { RequisitionDetail } from '@ims/shared';
import { t } from '@/i18n/en';
import { formatDate, formatDateTime } from '@/lib/format';
import { SupportingDocumentCard } from './SupportingDocumentCard';

/**
 * Who asked, for what, under whose budget, by when — and the paperwork.
 *
 * UX-6: these facts existed only as a small grey subtitle under the requisition number, and
 * neither date existed anywhere. An approver deciding on somebody else's money was reading the
 * one line on the page set in the lowest contrast.
 *
 * Laid out as the approving-view template lays it out: a two-column grid of labelled rows with a
 * rule between them, and the two long values — the reason and the attachment — spanning the full
 * width at the bottom. They used to sit outside this block, the reason underneath and the
 * document floated off to the right, which is what made the card read as three things fighting
 * for the same space rather than one summary.
 *
 * Shared because the approver's screen and the requester's own show the same five facts; two
 * copies would drift, and the copy that drifts is always the one nobody is looking at.
 */
export function RequisitionFacts({ detail }: { detail: RequisitionDetail }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
      <Fact label={t.requisitions.raisedBy} value={detail.requesterName} />
      <Fact label={t.requisitions.department} value={detail.departmentName} />
      {/* A missing project is not a gap to hide: it means personal development (Ayman's
          ruling, 2026-08-26), so it is named rather than dashed out. */}
      <Fact label={t.requisitions.project} value={detail.projectName ?? t.requisitions.noProject} />
      <Fact
        label={t.requisitions.submittedOn}
        // A draft has not been submitted, and `formatDateTime` on null would invent a date.
        value={detail.submittedAt ? formatDateTime(detail.submittedAt) : null}
      />
      <Fact label={t.requisitions.neededBy} value={formatDate(detail.approvalDeadline)} />

      {detail.reason ? (
        <Fact
          span
          label={t.requisitions.reason}
          value={<span className="whitespace-pre-wrap font-normal">{detail.reason}</span>}
        />
      ) : null}

      {detail.supportingDocument ? (
        <Fact
          span
          label={t.requisitions.supportingDocument.fieldHeading}
          value={
            <SupportingDocumentCard
              document={detail.supportingDocument}
              url={detail.supportingDocumentUrl}
            />
          }
        />
      ) : null}
    </dl>
  );
}

function Fact({
  label,
  value,
  span,
}: {
  label: string;
  value: ReactNode;
  /** Full width, for a value too long to sit in half a card. */
  span?: boolean;
}) {
  return (
    <div
      className={[
        'min-w-0 border-b border-border py-3 last:border-b-0',

        span ? 'sm:col-span-2' : '',
      ].join(' ')}
    >
      <dt className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
        {label}
      </dt>
      {/* `break-words`: a long project name must wrap inside its column rather than widen the
          grid and push everything beside it out of shape. */}
      <dd className="break-words text-sm font-medium text-ink">
        {value === null || value === undefined || value === '' ? t.common.none : value}
      </dd>
    </div>
  );
}
