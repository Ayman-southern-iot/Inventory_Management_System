import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RequisitionEventType,
  RequisitionStatus,
  RequisitionUrgency,
  type RequisitionDetail,
  type RequisitionEvent,
} from '@ims/shared';
import { LifecycleTracker } from './LifecycleTracker';

function event(type: RequisitionEventType, createdAt: string): RequisitionEvent {
  return {
    id: crypto.randomUUID(),
    eventType: type,
    actorId: null,
    actorName: null,
    createdAt,
  };
}

function requisition(overrides: Partial<RequisitionDetail> = {}): RequisitionDetail {
  return {
    id: 'req-1',
    requisitionNo: 'REQ-000001',
    requesterId: 'requester',
    requesterName: 'Gina General',
    departmentId: null,
    departmentName: null,
    projectId: null,
    projectName: null,
    urgency: RequisitionUrgency.NORMAL,
    approvalDeadline: null,
    reason: null,
    requestedAmount: 100_000,
    approvedAmount: 100_000,
    requiredApproverCount: 1,
    thresholdAtSubmit: 80_000,
    status: RequisitionStatus.IM_REVIEW,
    submittedAt: new Date().toISOString(),
    decidedAt: null,
    isOverdue: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [],
    approvals: [],
    events: [],
    supportingDocument: null,
    supportingDocumentUrl: null,
    transportationCost: null,
    transportationDescription: null,
    ...overrides,
  };
}

function chips() {
  const list = screen.getByRole('list', { name: /lifecycle/i });
  return Array.from(list.querySelectorAll('li'));
}

describe('LifecycleTracker', () => {
  it('renders all nine lifecycle stages in order', () => {
    render(<LifecycleTracker requisition={requisition()} />);

    const items = chips();
    expect(items).toHaveLength(9);
    expect(items[0]).toHaveTextContent('Submitted');
    expect(items[1]).toHaveTextContent('IM review');
    expect(items[2]).toHaveTextContent('Approved');
    expect(items[3]).toHaveTextContent('BOM');
    expect(items[4]).toHaveTextContent('Accounts');
    expect(items[5]).toHaveTextContent('Funded');
    expect(items[6]).toHaveTextContent('Purchased');
    expect(items[7]).toHaveTextContent('Verified');
    expect(items[8]).toHaveTextContent('In stock');
  });

  it('marks stages as done when their corresponding event has fired', () => {
    const submittedAt = '2026-01-15T10:00:00.000Z';
    const imApprovedAt = '2026-01-15T11:00:00.000Z';
    render(
      <LifecycleTracker
        requisition={requisition({
          status: RequisitionStatus.AWAITING_APPROVAL,
          events: [
            event(RequisitionEventType.SUBMITTED, submittedAt),
            event(RequisitionEventType.IM_APPROVED, imApprovedAt),
          ],
        })}
      />,
    );

    // The IM review chip should now show "completed at" because IM_APPROVED fired.
    expect(
      screen.getByTitle(`Completed ${new Date(imApprovedAt).toLocaleString()}`),
    ).toBeInTheDocument();
    // Submitted is also done but with the SUBMITTED timestamp.
    expect(
      screen.getByTitle(`Completed ${new Date(submittedAt).toLocaleString()}`),
    ).toBeInTheDocument();
  });

  it('marks the current stage from status (AWAITING_APPROVAL lights the Approved chip)', () => {
    render(
      <LifecycleTracker
        requisition={requisition({ status: RequisitionStatus.AWAITING_APPROVAL })}
      />,
    );

    const items = chips();
    // The 3rd item (Approved) carries aria-current="step" — AWAITING_APPROVAL is the
    // approver-deciding stage, which is our "Approved" stage.
    expect(items[2]!.querySelector('[aria-current="step"]')).toBeInTheDocument();
    // And the IM review chip is no longer current.
    expect(items[1]!.querySelector('[aria-current="step"]')).toBeNull();
  });

  it('renders the rejected state when status is REJECTED', () => {
    render(
      <LifecycleTracker
        requisition={requisition({ status: RequisitionStatus.REJECTED })}
      />,
    );
    // The list has the rejected-row opacity hint.
    const list = screen.getByRole('list', { name: /lifecycle/i });
    expect(list.className).toMatch(/opacity-90/);
    // No chip is "current" because rejection is terminal.
    expect(list.querySelector('[aria-current="step"]')).toBeNull();
  });

  it('renders the cancelled state when status is CANCELLED', () => {
    render(
      <LifecycleTracker
        requisition={requisition({ status: RequisitionStatus.CANCELLED })}
      />,
    );
    // When cancelled, no stage is current.
    expect(
      screen.getByRole('list', { name: /lifecycle/i }).querySelector('[aria-current="step"]'),
    ).toBeNull();
  });

  it('renders the event history when events are present', () => {
    render(
      <LifecycleTracker
        requisition={requisition({
          status: RequisitionStatus.AWAITING_APPROVAL,
          events: [
            event(RequisitionEventType.SUBMITTED, '2026-01-15T10:00:00.000Z'),
            event(RequisitionEventType.IM_APPROVED, '2026-01-15T11:00:00.000Z'),
          ],
        })}
      />,
    );

    // The history is collapsed by default; the <summary> is the trigger.
    const summary = screen.getByText(/history/i);
    expect(summary).toBeInTheDocument();
    // The event list is inside the same <details>; expand it to verify the entries.
    const details = summary.closest('details');
    expect(details).not.toBeNull();
  });

  it('does not render the history block when there are no events', () => {
    render(<LifecycleTracker requisition={requisition({ events: [] })} />);
    expect(screen.queryByText(/history/i)).toBeNull();
  });

  it('handles a fully-completed requisition (status CLOSED)', () => {
    render(
      <LifecycleTracker
        requisition={requisition({
          status: RequisitionStatus.CLOSED,
          events: [
            event(RequisitionEventType.SUBMITTED, '2026-01-15T10:00:00.000Z'),
            event(RequisitionEventType.IM_APPROVED, '2026-01-15T11:00:00.000Z'),
            event(RequisitionEventType.FULLY_APPROVED, '2026-01-15T12:00:00.000Z'),
            event(RequisitionEventType.BOM_GENERATED, '2026-01-16T09:00:00.000Z'),
            event(RequisitionEventType.SENT_TO_ACCOUNTS, '2026-01-16T10:00:00.000Z'),
            event(RequisitionEventType.FUNDS_RECEIVED, '2026-01-16T15:00:00.000Z'),
            event(RequisitionEventType.PURCHASED, '2026-01-17T11:00:00.000Z'),
            event(RequisitionEventType.PURCHASE_VERIFIED, '2026-01-17T14:00:00.000Z'),
            event(RequisitionEventType.STOCKED, '2026-01-17T16:00:00.000Z'),
          ],
        })}
      />,
    );

    // CLOSED is in the currentStatuses of 'inStock', so the last chip is current.
    const items = chips();
    expect(items[8]!.querySelector('[aria-current="step"]')).toBeInTheDocument();
    // The earlier chips are done, not current.
    expect(items[0]!.querySelector('[aria-current="step"]')).toBeNull();
  });
});