import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  ApprovalAction,
  ApprovalStage,
  RequisitionStatus,
  RequisitionUrgency,
  type Approval,
  type RequisitionDetail,
} from '@ims/shared';
import { t } from '@/i18n/en';
import { Role } from '@ims/shared';
import { ApprovalTracker } from './ApprovalTracker';

/**
 * Who is looking. The tracker asks, because the last node of a finished chain now offers the
 * next step and not everyone is allowed to take it.
 */
let viewerRoles: Role[] = [];
vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    hasRole: (...roles: Role[]) => roles.some((role) => viewerRoles.includes(role)),
  }),
}));

/**
 * The tracker links out, so it needs a router around it. Wrapping here rather than at each of
 * the call sites keeps the tests reading as `render(<ApprovalTracker …/>)`.
 */
function render(ui: ReactElement) {
  return rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  viewerRoles = [];
});

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
    provisionalAmount: 20000,
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
    transportationCost: null,
    transportationDescription: null,
    requiresRevisionTag: false,
    revisedAfterSendBack: false,
    fundingSnapshots: [],
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

  /**
   * An approver's note was stored and never shown: only a rejection (behind "See why") and a
   * withdrawal rendered one. Somebody writing "buy the cheaper one" on an approval was writing
   * into a void — neither the requester nor the next approver ever saw it.
   */
  it('shows the note an approver left when approving', () => {
    render(
      <ApprovalTracker
        requisition={requisition({
          approvals: [
            approval({
              action: ApprovalAction.APPROVED,
              actedByUserId: 'user-1',
              actedByUserName: 'Ayesha Approver',
              note: 'Buy the cheaper one',
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText('Buy the cheaper one')).toBeInTheDocument();
  });

  /** No note, no panel — an ordinary approval keeps its single line. */
  it('renders no note panel when the approver left nothing', () => {
    const { container } = render(
      <ApprovalTracker
        requisition={requisition({
          approvals: [
            approval({
              action: ApprovalAction.APPROVED,
              actedByUserId: 'user-1',
              actedByUserName: 'Ayesha Approver',
              note: null,
            }),
          ],
        })}
      />,
    );

    expect(container.querySelector('.bg-surface-muted')).toBeNull();
  });
});

/**
 * The next step, at the end of a chain that finished.
 *
 * Ayman, 2026-09-01: "after requisition fully approved in progress there will be link which
 * leads him to generating bom". Before this the only route was to leave the requisition, open
 * Bills of Materials, and find it again among every other approved one — so the link is only
 * worth anything if it carries the requisition with it.
 */
describe('ApprovalTracker — the next step after approval', () => {
  const approvedChain = () =>
    requisition({
      status: RequisitionStatus.APPROVED,
      approvals: [
        approval({
          action: ApprovalAction.APPROVED,
          actedByUserId: 'user-1',
          actedByUserName: 'Ayesha Approver',
        }),
      ],
    });

  it('links an inventory manager to the BOM builder, carrying the requisition', () => {
    viewerRoles = [Role.INVENTORY_MANAGER];

    render(<ApprovalTracker requisition={approvedChain()} />);

    const link = screen.getByRole('link', { name: t.requisitions.generateBomNext });
    expect(link).toHaveAttribute('href', '/boms/new?requisition=req-1');
  });

  /**
   * A call to action the viewer would be refused at is worse than no call to action. Only the
   * IM and an admin can generate a BOM, so only they are offered the route.
   */
  it('offers nothing to an approver, who cannot generate one', () => {
    viewerRoles = [Role.APPROVER];

    render(<ApprovalTracker requisition={approvedChain()} />);

    expect(screen.queryByRole('link', { name: t.requisitions.generateBomNext })).toBeNull();
  });

  /**
   * `APPROVED` exactly. Past it a BOM already exists, and inviting a second one for the same
   * requisition walks the IM into the conflict the one-live-BOM rule raises.
   */
  it('stops offering once a BOM has been generated', () => {
    viewerRoles = [Role.INVENTORY_MANAGER];

    render(
      <ApprovalTracker
        requisition={{ ...approvedChain(), status: RequisitionStatus.BOM_GENERATED }}
      />,
    );

    expect(screen.queryByRole('link', { name: t.requisitions.generateBomNext })).toBeNull();
  });

  /** Still going through the chain: there is nothing to generate yet. */
  it('offers nothing while the requisition is still awaiting approval', () => {
    viewerRoles = [Role.INVENTORY_MANAGER];

    render(
      <ApprovalTracker
        requisition={{ ...approvedChain(), status: RequisitionStatus.AWAITING_APPROVAL }}
      />,
    );

    expect(screen.queryByRole('link', { name: t.requisitions.generateBomNext })).toBeNull();
  });
});
