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

describe('RequisitionSummary approver note', () => {
  it('says one approver below the threshold', () => {
    renderSummary(14_999, POLICY);
    expect(screen.getByText('1 approver')).toBeInTheDocument();
  });

  /** The off-by-one that would otherwise ship: "over the threshold" is not the rule. */
  it('says two approvers at exactly the threshold, because the boundary is inclusive', () => {
    renderSummary(15_000, POLICY);
    expect(screen.getByText('2 approvers')).toBeInTheDocument();
  });

  it('says two approvers above the threshold', () => {
    renderSummary(20_000, POLICY);
    expect(screen.getByText('2 approvers')).toBeInTheDocument();
  });

  it('never tells the user the rule is "over" the threshold', () => {
    renderSummary(9_000, POLICY);
    // Copy check with teeth: "over 15,000" is wrong and was in the reference mockup.
    expect(document.body.textContent).not.toMatch(/over ৳?15,?000/i);
    expect(document.body.textContent).toMatch(/at or above/i);
  });

  it('reads the threshold from the policy rather than a hardcoded figure', () => {
    renderSummary(30_000, {
      expenseThresholdBdt: 50_000,
      approversBelowThreshold: 1,
      approversAtOrAboveThreshold: 2,
    });

    // An admin can change this at run time (requirements §11). A literal in the SPA would start
    // lying the first time they did.
    expect(screen.getByText('1 approver')).toBeInTheDocument();
    expect(document.body.textContent).toContain('50,000');
  });

  it('shows no note at all until the policy has loaded', () => {
    renderSummary(99_000, undefined);
    // A note that guesses and then corrects itself is worse than one that arrives a moment late.
    //
    // Asserted on the count, not on /approver/: the submit hint below the buttons says "the
    // approver list are fixed" and always renders, so a looser matcher fails here for a reason
    // that has nothing to do with the note.
    expect(screen.queryByText('1 approver')).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ approvers$/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/at or above/i);
  });

  it('totals the requested amount as currency', () => {
    renderSummary(15_960.24, POLICY);
    expect(document.body.textContent).toContain('15,960.24');
  });
});
