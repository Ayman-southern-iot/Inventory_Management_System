import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ApprovalPolicy } from '@ims/shared';
import { RequisitionSummary } from './RequisitionSummary';

/**
 * The approver note is the only part of this panel with a decision in it, and the decision is
 * one the requester acts on: two approvers means a slower request, and they may split it or
 * trim it rather than wait.
 *
 * The boundary is **inclusive** (OQ-01) — `requisitions.service.ts` branches on
 * `requestedAmount < threshold`, so exactly the threshold needs the higher count. The note has
 * to agree with that, because the alternative is telling someone they need one approver and
 * then handing them two at submit.
 */
const POLICY: ApprovalPolicy = {
  expenseThresholdBdt: 15_000,
  approversBelowThreshold: 1,
  approversAtOrAboveThreshold: 2,
    allowsApprovedAmountRevision: false,
};

/**
 * No default parameter on `policy`. `renderSummary(x, undefined)` would re-trigger a default and
 * silently hand the component a policy in the very test asserting it has none — which is exactly
 * what happened while writing this.
 */
function renderSummary(requestedTotal: number, policy: ApprovalPolicy | undefined) {
  render(
    <RequisitionSummary
      itemsTotal={requestedTotal}
      transportationTotal={0}
      requestedTotal={requestedTotal}
      policy={policy}
      isSubmitting={false}
      onSaveDraft={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
}

/**
 * The approver-count note was removed on 2026-09-02 (Ayman).
 *
 * It explained the threshold rule to someone filling in a form who cannot act on it: the count
 * follows from the amount, and the amount follows from what they need. Telling them the request
 * would "take longer to clear" gave them nothing to do about it. The chain is shown on the
 * requisition once it is submitted, which is where it is worth reading.
 *
 * These tests replace the seven that described the note. They are kept rather than deleted so
 * the removal is a recorded decision — if the note reappears, this file says why it should not.
 */
describe('RequisitionSummary', () => {
  it('does not tell the requester how many approvers the amount needs', () => {
    renderSummary(14_999, POLICY);

    expect(screen.queryByText('1 approver')).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ approvers$/)).not.toBeInTheDocument();
  });

  it('says nothing about the threshold, on either side of it', () => {
    renderSummary(20_000, POLICY);

    expect(document.body.textContent).not.toMatch(/at or above/i);
    expect(document.body.textContent).not.toMatch(/takes longer to clear/i);
    // The threshold figure itself must not leak into the panel either.
    expect(document.body.textContent).not.toContain('15,000.00');
  });

  it('is unchanged by whether the policy has loaded', () => {
    renderSummary(20_000, undefined);
    const withoutPolicy = document.body.textContent;
    document.body.innerHTML = '';

    renderSummary(20_000, POLICY);

    // Nothing on this panel depends on the policy any more, so the two renders agree.
    expect(document.body.textContent).toBe(withoutPolicy);
  });

  it('totals the requested amount as currency', () => {
    renderSummary(15_960.24, POLICY);
    expect(document.body.textContent).toContain('15,960.24');
  });
});
