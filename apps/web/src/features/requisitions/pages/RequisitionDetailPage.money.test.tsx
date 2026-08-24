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
 * The money block: the two figures at the top of the card and the caption under Sanctioned.
 *
 * D-016 — a DRAFT has no frozen `requestedAmount` (it is written at submit), and the page
 * rendered `?? 0`, putting a hard REQUESTED 0 directly above a line-item table totalling
 * 10,000. QA reported the page contradicting itself, which it did.
 *
 * D-021 — the "an approver revised this" caption was chosen by *whether an approver had
 * acted*, not by whether the amount actually changed, so every untouched approval claimed a
 * revision that never happened. On a financial record.
 *
 * Same block, two unrelated causes: D-020's report predicate fixes neither.
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

/** The <dd> under a given figure label. */
function figureValue(label: string): string {
  const term = screen.getByText(label);
  return term.parentElement!.querySelector('dd')!.textContent ?? '';
}

describe('RequisitionDetailPage — the money block', () => {
  it('shows a draft its line-item total instead of a hard 0 (D-016)', () => {
    show({
      status: RequisitionStatus.DRAFT,
      requestedAmount: null,
      approvedAmount: null,
      transportationCost: 500,
      transportationDescription: 'Courier',
      items: ITEMS,
    });

    // 7,500 + 2,000 items + 500 transport — the same figure submit will freeze.
    expect(figureValue(t.requisitions.requested)).toBe('10,000');
  });

  it('shows a draft no sanctioned figure at all, rather than 0 (D-016)', () => {
    show({
      status: RequisitionStatus.DRAFT,
      requestedAmount: null,
      approvedAmount: null,
      items: ITEMS,
    });

    expect(figureValue(t.requisitions.sanctioned)).toBe(t.common.none);
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

  it('does not claim a revision when the approver left the amount alone (D-021)', () => {
    show({
      status: RequisitionStatus.APPROVED,
      requestedAmount: 15_000,
      approvedAmount: 15_000,
      items: ITEMS,
      approvals: [APPROVED_APPROVAL],
    });

    expect(screen.queryByText(t.requisitions.sanctionedHintRevised)).toBeNull();
    expect(screen.queryByText(t.requisitions.sanctionedHintPending)).toBeNull();
  });

  it('does claim a revision when the approver moved the amount (D-021)', () => {
    show({
      status: RequisitionStatus.APPROVED,
      requestedAmount: 15_000,
      approvedAmount: 12_000,
      items: ITEMS,
      approvals: [APPROVED_APPROVAL],
    });

    expect(screen.getByText(t.requisitions.sanctionedHintRevised)).toBeInTheDocument();
  });

  it('still explains the pre-approval copy of the figure', () => {
    show({
      status: RequisitionStatus.AWAITING_APPROVAL,
      requestedAmount: 15_000,
      approvedAmount: 15_000,
      items: ITEMS,
      approvals: [PENDING_APPROVAL],
    });

    expect(screen.getByText(t.requisitions.sanctionedHintPending)).toBeInTheDocument();
  });
});
