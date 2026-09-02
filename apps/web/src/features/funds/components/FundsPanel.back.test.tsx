import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RequisitionStatus,
  RequisitionUrgency,
  Role,
  type RequisitionDetail,
  type RequisitionFunding,
} from '@ims/shared';
import { ToastProvider } from '@/components/ui/Toast';
import * as fundsApi from '../api';
import { FundsPanel } from './FundsPanel';
import * as bomsApi from '@/features/boms/api';

// Mock the funds API hook so the panel doesn't try to fetch live data — tests set its
// return value per case.
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFunding: vi.fn(),
    useUnverifyPurchase: vi.fn(),
  };
});

// Mock the BOM query — funds panel renders with no live BOM by default.
vi.mock('@/features/boms/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useBomForRequisition: vi.fn(),
  };
});

// Mock auth so the action buttons (next/previous) don't surface controls that confuse
// the assertions. The panel reads `hasRole` once on mount.
vi.mock('@/features/auth/auth-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'im-1',
        email: 'im@ims.local',
        fullName: 'Ina Manager',
        designation: 'Inventory Manager',
        departmentId: null,
        departmentName: null,
        roles: [Role.INVENTORY_MANAGER],
        mustChangePassword: false,
      },
      isRestoring: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshUser: vi.fn(),
      adoptSession: vi.fn(),
      hasRole: (...roles: Role[]) => roles.includes(Role.INVENTORY_MANAGER),
    }),
  };
});

const NOW = '2026-08-12T12:00:00.000Z';

function liveFunding(overrides: Partial<RequisitionFunding> = {}): RequisitionFunding {
  return {
    requisitionId: 'req-1',
    requestedAmount: 4178,
    approvedAmount: 3000,
    funded: 3000,
    spent: 2500,
    transportation: 200,
    spentInclTransportation: 2700,
    returned: 100,
    netFunded: 2900,
    outstanding: 0,
    unspent: 200,
    allowsPartialFunding: false,
    isFullyFunded: true,
    receipts: [],
    purchases: [],
    returns: [],
    ...overrides,
  };
}

function detail(overrides: Partial<RequisitionDetail> = {}): RequisitionDetail {
  return {
    id: 'req-1',
    requisitionNo: 'REQ-000018',
    requesterId: 'requester',
    requesterName: 'Gina General',
    departmentId: null,
    departmentName: null,
    projectId: null,
    projectName: null,
    urgency: RequisitionUrgency.NORMAL,
    approvalDeadline: null,
    reason: null,
    requestedAmount: 4178,
    provisionalAmount: 4178,
    approvedAmount: 3000,
    requiredApproverCount: 1,
    thresholdAtSubmit: 2500,
    status: RequisitionStatus.FUNDS_RECEIVED,
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
    transportationCost: 200,
    transportationDescription: 'Van hire',
    requiresRevisionTag: false,
    revisedAfterSendBack: false,
    fundingSnapshots: [],
    ...overrides,
  };
}

function renderPanel(detailProp: RequisitionDetail) {
  vi.mocked(fundsApi.useFunding).mockReturnValue({
    data: liveFunding(),
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof fundsApi.useFunding>);

  vi.mocked(fundsApi.useUnverifyPurchase).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  } as unknown as ReturnType<typeof fundsApi.useUnverifyPurchase>);

  vi.mocked(bomsApi.useBomForRequisition).mockReturnValue({
    data: null,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof bomsApi.useBomForRequisition>);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <FundsPanel requisition={detailProp} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('FundsPanel — single Back button', () => {
  it('renders the Back button at PURCHASE_VERIFIED with the i18n "Back" label', () => {
    renderPanel(detail({ status: RequisitionStatus.PURCHASE_VERIFIED }));

    // The forward action is "Add to inventory", and the Back button opens the unverify
    // dialog so the IM can re-record. The button is labelled with the standalone "Back"
    // copy (not the unverifyPurchase label) — the user wants a single, obvious control.
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  /**
   * These two used to assert the opposite — that PURCHASED and FUNDS_RECEIVED had no way back,
   * which was true until phase 08 and is the exact thing Ayman asked for on 2026-08-26: "I
   * accidentally accept the record money received and go to the record purchase, but there is no
   * way of going back." Re-grounded rather than deleted; the assertions are inverted because the
   * rule they encode was replaced by a ruling, not because they were failing.
   */
  it.each([
    ['SENT_TO_ACCOUNTS', RequisitionStatus.SENT_TO_ACCOUNTS],
    ['FUNDS_PARTIAL', RequisitionStatus.FUNDS_PARTIAL],
    ['FUNDS_RECEIVED', RequisitionStatus.FUNDS_RECEIVED],
    ['PURCHASED', RequisitionStatus.PURCHASED],
    ['PURCHASE_VERIFIED', RequisitionStatus.PURCHASE_VERIFIED],
  ])('offers Back at %s', (_label, status) => {
    renderPanel(detail({ status }));

    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  /**
   * The one place there is deliberately no way back. Stock has moved by STOCKED, and putting it
   * back is a stock adjustment through StockService — not a status flip, and not this button.
   */
  it('offers no Back once the goods are in stock', () => {
    renderPanel(detail({ status: RequisitionStatus.STOCKED }));

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('offers no Back at BOM_GENERATED, where voiding the BOM is the way back', () => {
    renderPanel(detail({ status: RequisitionStatus.BOM_GENERATED }));

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('does not render the panel at all before a BOM exists', () => {
    renderPanel(detail({ status: RequisitionStatus.APPROVED }));

    // The whole panel is hidden — there is no money story yet.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByText(/Money and purchasing/i)).toBeNull();
  });

  it('does not render any pill selector after the user asked for back-only navigation', () => {
    renderPanel(detail({ status: RequisitionStatus.STOCKED }));

    // The legacy pill selector had `role="tablist"` with `aria-label="Figures at stage"`.
    // It is gone — only the forward action title (or "done" badge) and the optional
    // Back button exist.
    expect(screen.queryByRole('tablist', { name: /figures at stage/i })).toBeNull();
  });
});
