import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RequisitionStatus, RequisitionUrgency, type RequisitionDetail } from '@ims/shared';
import { t } from '@/i18n/en';
import { RequisitionFacts } from './RequisitionFacts';

/**
 * UX-6. The facts an approver decides on lived in one low-contrast subtitle under the
 * requisition number, and the dates lived nowhere at all — neither the submitted date nor the
 * deadline appeared on the detail page, only the approvers' own action timestamps. An approver
 * could not see what they were late against without going back to the list they arrived from.
 */
function detail(overrides: Partial<RequisitionDetail> = {}): RequisitionDetail {
  return {
    id: 'req-1',
    requisitionNo: 'REQ-000015',
    requesterId: 'u-1',
    requesterName: 'Gina General',
    departmentId: 'd-1',
    departmentName: 'Engineering',
    projectId: 'p-1',
    projectName: 'Home Automation',
    urgency: RequisitionUrgency.NORMAL,
    approvalDeadline: '2026-08-30',
    reason: 'Because',
    requestedAmount: 20_500,
    provisionalAmount: 20_500,
    approvedAmount: null,
    requiredApproverCount: 2,
    thresholdAtSubmit: 15_000,
    status: RequisitionStatus.AWAITING_APPROVAL,
    submittedAt: '2026-08-27T10:15:00.000Z',
    decidedAt: null,
    transportationCost: 500,
    transportationDescription: 'Van',
    items: [],
    approvals: [],
    events: [],
    requiresRevisionTag: false,
    revisedAfterSendBack: false,
    fundingSnapshots: [],
    isOverdue: false,
    supportingDocument: null,
    supportingDocumentUrl: null,
    createdAt: '2026-08-27T10:00:00.000Z',
    updatedAt: '2026-08-27T10:15:00.000Z',
    ...overrides,
  } as unknown as RequisitionDetail;
}

/** The <dd> paired with a given <dt>. */
function factValue(label: string): string {
  return screen.getByText(label).parentElement!.querySelector('dd')!.textContent ?? '';
}

describe('RequisitionFacts', () => {
  it('labels who raised it, under which department and project', () => {
    render(<RequisitionFacts detail={detail()} />);

    expect(factValue(t.requisitions.raisedBy)).toBe('Gina General');
    expect(factValue(t.requisitions.department)).toBe('Engineering');
    expect(factValue(t.requisitions.project)).toBe('Home Automation');
  });

  /** The half of UX-6 that was missing outright rather than merely faint. */
  it('shows both dates — when it was submitted and when it is needed', () => {
    render(<RequisitionFacts detail={detail()} />);

    expect(factValue(t.requisitions.submittedOn)).not.toBe(t.common.none);
    expect(factValue(t.requisitions.neededBy)).toContain('2026');
  });

  it('names a missing project rather than dashing it out', () => {
    render(<RequisitionFacts detail={detail({ projectName: null })} />);

    // Ayman's ruling, 2026-08-26: no project means personal development, not an unlabelled gap.
    expect(factValue(t.requisitions.project)).toBe(t.requisitions.noProject);
  });

  it('shows no submitted date for a draft rather than inventing one', () => {
    render(<RequisitionFacts detail={detail({ submittedAt: null })} />);

    expect(factValue(t.requisitions.submittedOn)).toBe(t.common.none);
  });
});
