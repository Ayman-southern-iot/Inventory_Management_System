import { t } from '@/i18n/en';
import { plural } from '@/i18n/plural';

/**
 * The line under the approval tracker: how many approvers this requisition needs, and the
 * threshold that decided it.
 *
 * Extracted from `RequisitionDetailPage` so the composed sentence is testable without
 * rendering the page. The count drives singular/plural — a requisition needing one approver
 * used to read "1 approvers required".
 */
export function approverCountHint(count: number, threshold: number): string {
  return t.requisitions.approverCountHint
    .replace('{count}', plural(count, t.requisitions.approverCountOne, t.requisitions.approverCountOther))
    .replace('{threshold}', threshold.toLocaleString());
}
