import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApprovalAction,
  ApprovalStage,
  RequisitionStatus,
  RequisitionUrgency,
  type RequisitionDetail,
} from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import * as requisitionsApi from '../api';
import * as fundsApi from '@/features/funds/api';
import { RequisitionDetailPage } from './RequisitionDetailPage';

/**
 * The money block: the two figures at the top of the card and the caption beneath them.
 *
 * D-016 — a DRAFT has no frozen `requestedAmount` (it is written at submit), and the page
 * rendered `?? 0`, putting a hard REQUESTED 0 directly above a line-item table totalling
 * 10,000. QA reported the page contradicting itself, which it did.
 *
 * D-021 — the "an approver revised this" caption was chosen by *whether an approver had
 * acted*, not by whether the amount actually changed, so every untouched approval claimed a
 * revision that never happened. On a financial record.
 *
 * UX-5 — `approved_amount` is seeded with the requested figure at submit so the BOM has a
 * number to print, and the screen printed that seed under a label claiming it was approved.
 * A requisition sitting in an approver's queue showed a concrete approved figure before
 * anybody had approved anything. The seed stays; the screen now waits for a decision.
 *
 * Same block, three unrelated causes: D-020's report predicate fixes none of them.
 */

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRequisition: vi.fn(),
    useSubmitRequisition: vi.fn(),
    useCancelRequisition: vi.fn(),
    useWithdrawApproval: vi.fn(),
  };
});

vi.mock('@/features/funds/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFunding: vi.fn(),
  };
});

vi.mock('@/features/auth/auth-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'requester',
        email: 'g@ims.local',
        fullName: 'Gina General',
        designation: 'General',
        departmentId: null,
        departmentName: null,
        roles: [],
        mustChangePassword: false,
      },
      isRestoring: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshUser: vi.fn(),
      hasRole: () => false,
    }),
  };
});

function detail(overrides: Partial<RequisitionDetail>): RequisitionDetail {
  return {
    id: 'req-1',
    requisitionNo: 'REQ-000001',
    requesterId: 'requester',
    requesterName: 'Gina',
    departmentId: null,
    departmentName: null,
    projectId: null,
    projectName: null,
    urgency: RequisitionUrgency.NORMAL,
    approvalDeadline: null,
    reason: null,
    requestedAmount: 12_500,
    provisionalAmount: 12_500,
    approvedAmount: 10_000,
    requiredApproverCount: null,
    thresholdAtSubmit: null,
    status: RequisitionStatus.DRAFT,
    submittedAt: null,
    decidedAt: null,
    isOverdue: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    supportingDocument: null,
    supportingDocumentUrl: null,
    transportationCost: null,
    transportationDescription: null,
    items: [],
    approvals: [],
    events: [],
    requiresRevisionTag: false,
    revisedAfterSendBack: false,
    fundingSnapshots: [],
    ...overrides,
  };
}

function renderDetail() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/requisitions/req-1']}>
          <RequisitionDetailPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const ITEMS = [
  {
    id: 'item-1',
    productId: null,
    productName: null,
    productCode: null,
    itemName: 'Widget',
    quantity: 3,
    estimatedUnitPrice: 2_500,
    estimatedLineTotal: 7_500,
    note: null,
    inStockQtyAtSubmit: null,
  },
  {
    id: 'item-2',
    productId: null,
    productName: null,
    productCode: null,
    itemName: 'Gadget',
    quantity: 1,
    estimatedUnitPrice: 2_000,
    estimatedLineTotal: 2_000,
    note: null,
    inStockQtyAtSubmit: null,
  },
] as unknown as RequisitionDetail['items'];

const APPROVED_APPROVAL = {
  id: 'ap-1',
  stage: ApprovalStage.APPROVER,
  slot: 1,
  assignedUserId: 'approver',
  assignedUserName: 'Approver',
  assignedUserDesignation: 'Approver',
  actedByUserId: 'approver',
  actedByUserName: 'Approver',
  action: ApprovalAction.APPROVED,
  note: null,
} as unknown as RequisitionDetail['approvals'][number];

const PENDING_APPROVAL = {
  ...APPROVED_APPROVAL,
  actedByUserId: null,
  actedByUserName: null,
  action: ApprovalAction.PENDING,
} as unknown as RequisitionDetail['approvals'][number];

function show(overrides: Partial<RequisitionDetail>): void {
  vi.mocked(requisitionsApi.useRequisition).mockReturnValue({
    data: detail(overrides),
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof requisitionsApi.useRequisition>);
  vi.mocked(requisitionsApi.useSubmitRequisition).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof requisitionsApi.useSubmitRequisition>);
  vi.mocked(requisitionsApi.useCancelRequisition).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof requisitionsApi.useCancelRequisition>);
  vi.mocked(requisitionsApi.useWithdrawApproval).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof requisitionsApi.useWithdrawApproval>);
  vi.mocked(fundsApi.useFunding).mockReturnValue({
    data: undefined,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof fundsApi.useFunding>);
  renderDetail();
}

/**
 * The <dd> paired with a given label.
 *
 * Walks up from the label rather than assuming the amount is its sibling: the totals block
 * lays label and amount out side by side, so `dd` sits one level higher than it did when the
 * figures were stacked. Anchored on the nearest ancestor that actually holds one.
 */
function figureValue(label: string): string {
  let node: HTMLElement | null = screen.getByText(label);
  while (node) {
    const dd = node.querySelector('dd');
    if (dd) return dd.textContent ?? '';
    node = node.parentElement;
  }
  throw new Error(`no <dd> found for "${label}"`);
}

describe('RequisitionDetailPage — the money block', () => {
  it('shows a draft its line-item total instead of a hard 0 (D-016)', () => {
    show({
      status: RequisitionStatus.DRAFT,
      requestedAmount: null,
      // 7,500 + 2,000 of items plus 500 carriage — the figure the server now computes, which
      // the page used to add up in the browser.
      provisionalAmount: 10_000,
      approvedAmount: null,
      transportationCost: 500,
      transportationDescription: 'Courier',
      items: ITEMS,
    });

    // 7,500 + 2,000 items + 500 transport — the same figure submit will freeze.
    expect(figureValue(t.requisitions.requested)).toBe('10,000');
  });

  /**
   * UX-6, at the page rather than the component: the facts block is actually wired in. The
   * deadline is the assertion that bites, because it appeared nowhere on this page before —
   * requester and department at least existed as a subtitle.
   */
  it('puts the requester and both dates on the page, not just in a subtitle', () => {
    show({
      status: RequisitionStatus.AWAITING_APPROVAL,
      requestedAmount: 12_500,
      approvalDeadline: '2026-09-30',
      submittedAt: '2026-08-27T10:15:00.000Z',
      items: ITEMS,
      approvals: [PENDING_APPROVAL],
    });

    expect(screen.getByText(t.requisitions.neededBy)).toBeInTheDocument();
    expect(screen.getByText(t.requisitions.submittedOn)).toBeInTheDocument();
    expect(screen.getByText(t.requisitions.raisedBy)).toBeInTheDocument();
  });

  /**
   * The decision card. It replaced two buttons in the page header, which sat beside Edit and
   * Cancel — the one thing an approver opened the page to do, in the same row as things they
   * did not, and above the figures they need to read first.
   *
   * The assertion that matters is the negative one: it must appear only for the person the
   * requisition is actually waiting on. The mocked session is the requester (`requester`), and
   * the fixture approval is assigned to `approver`.
   */
  it('offers no decision card to somebody the requisition is not waiting on', () => {
    show({
      status: RequisitionStatus.AWAITING_APPROVAL,
      requestedAmount: 12_500,
      items: ITEMS,
      approvals: [PENDING_APPROVAL],
    });

    expect(screen.queryByText(t.requisitions.yourDecision)).toBeNull();
    expect(
      screen.queryByRole('button', { name: t.requisitions.approveWithoutSignature }),
    ).toBeNull();
  });

  it('offers the decision card to the approver it is waiting on', () => {
    show({
      status: RequisitionStatus.AWAITING_APPROVAL,
      requestedAmount: 12_500,
      items: ITEMS,
      // The mocked session id — see the auth mock at the top of this file.
      approvals: [{ ...PENDING_APPROVAL, assignedUserId: 'requester' }],
    });

    expect(screen.getByText(t.requisitions.yourDecision)).toBeInTheDocument();
    // Two approve buttons, not one: signing is a distinct act chosen at the moment of
    // committing rather than a checkbox somebody might not notice.
    expect(
      screen.getByRole('button', { name: t.requisitions.approveWithoutSignature }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.requisitions.approveWithSignature }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.requisitions.reject })).toBeInTheDocument();
  });

  it('shows a draft no approved figure at all, rather than 0 (D-016)', () => {
    show({
      status: RequisitionStatus.DRAFT,
      requestedAmount: null,
      approvedAmount: null,
      items: ITEMS,
    });

    expect(figureValue(t.requisitions.approvedAmount)).toBe(t.common.none);
  });

  /**
   * UX-5, stated as the assertion that was missing. The requisition is submitted, the column
   * carries its seeded 12,500, and not one person has decided anything — so the screen must not
   * put a figure under a label that says approved.
   */
  it('names no approved figure while the requisition is still waiting on an approver', () => {
    show({
      status: RequisitionStatus.AWAITING_APPROVAL,
      requestedAmount: 12_500,
      // Seeded at submit so the BOM has a number — not a decision anybody made.
      approvedAmount: 12_500,
      items: ITEMS,
      approvals: [PENDING_APPROVAL],
    });

    expect(figureValue(t.requisitions.approvedAmount)).toBe(t.common.none);
  });

  it('keeps showing the frozen figure once it exists, not a recomputation', () => {
    show({
      status: RequisitionStatus.AWAITING_APPROVAL,
      requestedAmount: 12_500,
      approvedAmount: 12_500,
      // Deliberately inconsistent with the frozen amount: a line edited after submit must
      // not move the figure the approvers were shown.
      items: ITEMS,
      approvals: [PENDING_APPROVAL],
    });

    expect(figureValue(t.requisitions.requested)).toBe('12,500');
  });

  it('names the figure once an approver has actually approved it', () => {
    show({
      status: RequisitionStatus.APPROVED,
      requestedAmount: 15_000,
      approvedAmount: 15_000,
      items: ITEMS,
      approvals: [APPROVED_APPROVAL],
    });

    expect(figureValue(t.requisitions.approvedAmount)).toBe('15,000');
  });

  it('does not claim a revision when the approver left the amount alone (D-021)', () => {
    show({
      status: RequisitionStatus.APPROVED,
      requestedAmount: 15_000,
      approvedAmount: 15_000,
      items: ITEMS,
      approvals: [APPROVED_APPROVAL],
    });

    expect(screen.queryByText(t.requisitions.approvedAmountHintRevised)).toBeNull();
  });

  it('does claim a revision when the approver moved the amount (D-021)', () => {
    show({
      status: RequisitionStatus.APPROVED,
      requestedAmount: 15_000,
      approvedAmount: 12_000,
      items: ITEMS,
      approvals: [APPROVED_APPROVAL],
    });

    expect(screen.getByText(t.requisitions.approvedAmountHintRevised)).toBeInTheDocument();
  });

  /**
   * The nuance the "wait for a decision" rule has to get right: above the threshold, the first
   * of two approvals is a real decision about the money. If that approver revised it down, the
   * revised figure is what the second approver is being asked to sign, and hiding it until the
   * status reaches APPROVED would hide it from exactly the person who needs it.
   */
  it('names a revised figure while the second approver is still pending', () => {
    show({
      status: RequisitionStatus.AWAITING_APPROVAL,
      requestedAmount: 20_000,
      approvedAmount: 16_000,
      items: ITEMS,
      approvals: [APPROVED_APPROVAL, { ...PENDING_APPROVAL, id: 'ap-2', slot: 2 }],
    });

    expect(figureValue(t.requisitions.approvedAmount)).toBe('16,000');
    expect(screen.getByText(t.requisitions.approvedAmountHintRevised)).toBeInTheDocument();
  });

  /**
   * A rejection can be taken back.
   *
   * The API has allowed this since withdraw shipped — `REJECTED` is in `WITHDRAWABLE_STATUSES`
   * and the service comment says a withdrawn IM rejection "resurrects the requisition to
   * IM_REVIEW". The page restated the list by hand and left `REJECTED` out of it, so the
   * capability existed and no screen offered it, while the reject dialog said the opposite.
   */
  it('offers the rejector a way to take a rejection back', () => {
    show({
      status: RequisitionStatus.REJECTED,
      requestedAmount: 12_500,
      items: ITEMS,
      approvals: [
        {
          ...APPROVED_APPROVAL,
          action: ApprovalAction.REJECTED,
          assignedUserId: 'requester',
          actedByUserId: 'requester',
        },
      ],
    });

    expect(screen.getByRole('button', { name: t.requisitions.withdraw })).toBeInTheDocument();
  });

  /** Somebody else's rejection is not theirs to undo. */
  it('offers it only to the person who rejected', () => {
    show({
      status: RequisitionStatus.REJECTED,
      requestedAmount: 12_500,
      items: ITEMS,
      approvals: [{ ...APPROVED_APPROVAL, action: ApprovalAction.REJECTED }],
    });

    expect(screen.queryByRole('button', { name: t.requisitions.withdraw })).toBeNull();
  });
});
