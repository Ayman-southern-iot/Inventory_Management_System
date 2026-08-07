import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ApprovalAction,
  ApprovalStage,
  RequisitionStatus,
  RequisitionUrgency,
  type Approval,
  type RequisitionDetail,
} from '@ims/shared';
import { t } from '@/i18n/en';
import { ApprovalTracker } from './ApprovalTracker';

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: crypto.randomUUID(),
    stage: ApprovalStage.APPROVER,
    slot: 1,
    assignedUserId: 'user-1',
    assignedUserName: 'Ayesha Approver',
    assignedUserDesignation: 'Head of Operations',
    actedByUserId: null,
    actedByUserName: null,
    action: ApprovalAction.PENDING,
    note: null,
    actedAt: null,
    ...overrides,
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
    requestedAmount: 20000,
    approvedAmount: 20000,
    requiredApproverCount: 2,
    thresholdAtSubmit: 15000,
    status: RequisitionStatus.AWAITING_APPROVAL,
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
    ...overrides,
  };
}

describe('ApprovalTracker', () => {
  it('shows the IM first, then the approvers by slot', () => {
    render(
      <ApprovalTracker
        requisition={requisition({
          approvals: [
            approval({ stage: ApprovalStage.APPROVER, slot: 2, assignedUserName: 'Second' }),
            approval({ stage: ApprovalStage.APPROVER, slot: 1, assignedUserName: 'First' }),
            approval({
              stage: ApprovalStage.INVENTORY_MANAGER,
              slot: 1,
              assignedUserName: 'The IM',
            }),
          ],
        })}
      />,
    );

    const rendered = screen.getAllByRole('listitem').map((node) => node.textContent ?? '');
    expect(rendered[0]).toContain('The IM');
    expect(rendered[1]).toContain('First');
    expect(rendered[2]).toContain('Second');
  });

  it('marks only the stage that is actually actionable as waiting', () => {
    render(
      <ApprovalTracker
        requisition={requisition({
          status: RequisitionStatus.IM_REVIEW,
          approvals: [
            approval({ stage: ApprovalStage.INVENTORY_MANAGER, assignedUserName: 'The IM' }),
            approval({ stage: ApprovalStage.APPROVER, assignedUserName: 'An approver' }),
          ],
        })}
      />,
    );

    const rows = screen.getAllByRole('listitem').map((node) => node.textContent ?? '');
    // While it sits with the IM, the approver has not been reached — not "waiting".
    expect(rows[0]).toContain(t.requisitions.awaiting);
    expect(rows[1]).toContain(t.requisitions.notReached);
  });

  it('reveals the rejection note only when "see why" is pressed', async () => {
    render(
      <ApprovalTracker
        requisition={requisition({
          status: RequisitionStatus.REJECTED,
          approvals: [
            approval({
              action: ApprovalAction.REJECTED,
              note: 'over budget this quarter',
              actedByUserId: 'user-1',
              actedByUserName: 'Ayesha Approver',
              actedAt: new Date().toISOString(),
            }),
          ],
        })}
      />,
    );

    expect(screen.queryByText('over budget this quarter')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t.requisitions.seeWhy }));
    expect(screen.getByText('over budget this quarter')).toBeInTheDocument();
    // The rejector's designation is part of the answer to "why", not decoration.
    expect(screen.getByText(/Head of Operations/)).toBeInTheDocument();
  });

  it('credits a delegate without displacing the assignee', () => {
    render(
      <ApprovalTracker
        requisition={requisition({
          approvals: [
            approval({
              action: ApprovalAction.APPROVED,
              actedByUserId: 'delegate-1',
              actedByUserName: 'Farhan Finance',
              actedAt: new Date().toISOString(),
            }),
          ],
        })}
      />,
    );

    // Regex, not an exact string: the same line carries the timestamp after the attribution.
    expect(
      screen.getByText(
        new RegExp(`Farhan Finance ${t.requisitions.onBehalfOf} Ayesha Approver`),
      ),
    ).toBeInTheDocument();
    // The assignee still appears in their own right — the delegate is credited, not substituted.
    expect(screen.getAllByText(/Ayesha Approver/).length).toBeGreaterThan(1);
  });

  /**
   * The history block lives in LifecycleTracker now (per "history should be in Lifecycle
   * part, not in progress part"), so this tracker renders only the chain. The withdrawn
   * node still surfaces its note inline.
   */
  it('shows the withdrawn note inline for an approval that was withdrawn', () => {
    const note = 'changed my mind, second look needed';
    render(
      <ApprovalTracker
        requisition={requisition({
          status: RequisitionStatus.AWAITING_APPROVAL,
          approvals: [
            approval({
              action: ApprovalAction.WITHDRAWN,
              actedAt: new Date().toISOString(),
              note,
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText(note)).toBeInTheDocument();
    // The history block is no longer part of this view.
    expect(screen.queryByText(t.requisitions.history)).toBeNull();
  });

  it('marks untouched stages as skipped once the request is dead', () => {
    render(
      <ApprovalTracker
        requisition={requisition({
          status: RequisitionStatus.REJECTED,
          approvals: [
            approval({ stage: ApprovalStage.INVENTORY_MANAGER, action: ApprovalAction.REJECTED, actedAt: new Date().toISOString() }),
            approval({ stage: ApprovalStage.APPROVER, slot: 1 }),
          ],
        })}
      />,
    );

    const rows = screen.getAllByRole('listitem').map((node) => node.textContent ?? '');
    expect(rows[1]).toContain(t.requisitions.skipped);
  });
});
