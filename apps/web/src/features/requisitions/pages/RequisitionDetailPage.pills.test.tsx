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
 * The send-back / revised pills are derived from `requiresRevisionTag` and
 * `revisedAfterSendBack` on the detail shape. We don't want a full page test
 * (that would mean wiring FundsPanel + auth + decisions), so this file
 * covers only the pill-rendering branches.
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

describe('RequisitionDetailPage — send-back pills', () => {
  it('shows the "For revise" pill on a DRAFT requisition after a send-back', () => {
    vi.mocked(requisitionsApi.useRequisition).mockReturnValue({
      data: detail({
        status: RequisitionStatus.DRAFT,
        approvedAmount: null,
        requiresRevisionTag: true,
        revisedAfterSendBack: false,
      }),
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

    expect(screen.getByText(t.requisitions.status.DRAFT)).toBeInTheDocument();
    expect(
      screen.getByText(t.requisitions.statusTags.draftForRevise),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.requisitions.statusTags.draftRevised),
    ).not.toBeInTheDocument();
  });

  it('shows the "Revised" pill once the requester has re-submitted', () => {
    vi.mocked(requisitionsApi.useRequisition).mockReturnValue({
      data: detail({
        status: RequisitionStatus.IM_REVIEW,
        requiresRevisionTag: false,
        revisedAfterSendBack: true,
        approvals: [
          {
            id: 'ap-im',
            stage: ApprovalStage.INVENTORY_MANAGER,
            slot: 1,
            assignedUserId: 'im',
            assignedUserName: 'IM',
            assignedUserDesignation: 'IM',
            actedByUserId: null,
            actedByUserName: null,
            action: ApprovalAction.PENDING,
            note: null,
            actedAt: null,
          },
        ],
      }),
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

    expect(
      screen.getByText(t.requisitions.statusTags.draftRevised),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.requisitions.statusTags.draftForRevise),
    ).not.toBeInTheDocument();
  });
});