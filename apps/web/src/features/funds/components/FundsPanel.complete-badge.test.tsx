import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RequisitionStatus,
  RequisitionUrgency,
  Role,
  type RequisitionDetail,
  type RequisitionFunding,
} from '@ims/shared';
import { ToastProvider } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import * as fundsApi from '../api';
import { FundsPanel } from './FundsPanel';
import * as bomsApi from '@/features/boms/api';

/**
 * "This requisition is complete" is a fact about the requisition, not about the viewer.
 *
 * It used to be the else-branch of the next-action button, and that button is only ever offered to
 * someone who can act. So every general user and every approver was told the requisition was
 * complete at every stage — including one sitting at "sent to Accounts", waiting for money that
 * had not arrived. Reported by Ayman on 2026-09-02 from exactly that screen.
 *
 * Both directions matter here. Hiding the badge from people who cannot act would be just as wrong
 * the other way: a requester looking at a finished requisition should still be told it is finished.
 */
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFunding: vi.fn(), useUnverifyPurchase: vi.fn() };
});

vi.mock('@/features/boms/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useBomForRequisition: vi.fn() };
});

/** Swapped per test: the whole point is that the badge must not depend on this. */
let currentRoles: Role[] = [Role.INVENTORY_MANAGER];

vi.mock('@/features/auth/auth-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'viewer',
        email: 'viewer@ims.local',
        fullName: 'A Viewer',
        designation: null,
        departmentId: null,
        departmentName: null,
        roles: currentRoles,
        mustChangePassword: false,
      },
      isRestoring: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshUser: vi.fn(),
      adoptSession: vi.fn(),
      hasRole: (...roles: Role[]) => roles.some((role) => currentRoles.includes(role)),
    }),
  };
});

const NOW = '2026-09-02T12:00:00.000Z';

function funding(): RequisitionFunding {
  return {
    requisitionId: 'req-1',
    requestedAmount: 10_100,
    approvedAmount: 10_100,
    funded: 0,
    spent: 0,
    transportation: 0,
    spentInclTransportation: 0,
    returned: 0,
    netFunded: 0,
    outstanding: 10_100,
    unspent: 0,
    allowsPartialFunding: false,
    isFullyFunded: false,
    receipts: [],
    purchases: [],
    returns: [],
  };
}

function detail(status: RequisitionStatus): RequisitionDetail {
  return {
    id: 'req-1',
    requisitionNo: 'REQ-000001-GINA',
    requesterId: 'requester',
    requesterName: 'Gina General',
    departmentId: null,
    departmentName: null,
    projectId: null,
    projectName: null,
    urgency: RequisitionUrgency.NORMAL,
    approvalDeadline: null,
    reason: null,
    requestedAmount: 10_100,
    provisionalAmount: 10_100,
    approvedAmount: 10_100,
    requiredApproverCount: 1,
    thresholdAtSubmit: 15_000,
    status,
    submittedAt: NOW,
    decidedAt: NOW,
    isOverdue: false,
    createdAt: NOW,
    updatedAt: NOW,
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
  };
}

function renderAs(roles: Role[], status: RequisitionStatus) {
  currentRoles = roles;

  vi.mocked(fundsApi.useFunding).mockReturnValue({
    data: funding(),
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof fundsApi.useFunding>);
  vi.mocked(fundsApi.useUnverifyPurchase).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof fundsApi.useUnverifyPurchase>);
  vi.mocked(bomsApi.useBomForRequisition).mockReturnValue({
    data: null,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof bomsApi.useBomForRequisition>);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <FundsPanel requisition={detail(status)} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const badge = () => screen.queryByText(t.funds.done);

describe('the "complete" badge', () => {
  beforeEach(() => {
    currentRoles = [Role.INVENTORY_MANAGER];
  });

  /** The bug, exactly as reported: a general user, money not yet received, told it is finished. */
  it('is not shown to a general user while the requisition is still in motion', () => {
    renderAs([Role.GENERAL], RequisitionStatus.SENT_TO_ACCOUNTS);

    expect(badge()).toBeNull();
  });

  it('is not shown to an approver mid-chain either', () => {
    renderAs([Role.GENERAL, Role.APPROVER], RequisitionStatus.FUNDS_RECEIVED);

    expect(badge()).toBeNull();
  });

  /** The other direction: a requester looking at a finished requisition should be told so. */
  it('is shown to a general user once the requisition really is finished', () => {
    renderAs([Role.GENERAL], RequisitionStatus.STOCKED);

    expect(badge()).toBeInTheDocument();
  });

  it('is shown to the IM at the end of the chain', () => {
    renderAs([Role.INVENTORY_MANAGER], RequisitionStatus.STOCKED);

    expect(badge()).toBeInTheDocument();
  });

  /** While the IM still has a step to take, the button is the message and the badge would clash. */
  it('is not shown to the IM while a step remains', () => {
    renderAs([Role.INVENTORY_MANAGER], RequisitionStatus.SENT_TO_ACCOUNTS);

    expect(badge()).toBeNull();
  });

  /**
   * The property the whole fix rests on: the badge says the same thing to everyone, because it is
   * about the requisition rather than about who is looking at it.
   */
  it('says the same thing to every role at the same status', () => {
    for (const status of [RequisitionStatus.SENT_TO_ACCOUNTS, RequisitionStatus.STOCKED]) {
      const seen = new Set<boolean>();
      for (const roles of [[Role.GENERAL], [Role.APPROVER], [Role.INVENTORY_MANAGER], [Role.ADMIN]]) {
        renderAs(roles, status);
        seen.add(badge() !== null);
        document.body.innerHTML = '';
      }
      expect(seen.size, `roles disagreed at ${status}`).toBe(1);
    }
  });
});
