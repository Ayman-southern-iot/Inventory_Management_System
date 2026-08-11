import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RequisitionStatus,
  RequisitionUrgency,
  Role,
  type RequisitionDetail,
  type RequisitionFunding,
  type RequisitionFundingSnapshot,
} from '@ims/shared';
import { ToastProvider } from '@/components/ui/Toast';
import * as fundsApi from '../api';
import { FundsPanel } from './FundsPanel';

// Mock the funds API hook so the panel doesn't try to fetch live data — tests set its
// return value per case.
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFunding: vi.fn(),
  };
});

// Mock auth so the action buttons (next/previous) don't surface controls that confuse
// the pill-only assertions. The panel reads `hasRole` once on mount.
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

const NOW = '2026-08-10T12:00:00.000Z';

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
    approvedAmount: 3000,
    requiredApproverCount: 1,
    thresholdAtSubmit: 2500,
    status: RequisitionStatus.STOCKED,
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

function snapshot(
  status: RequisitionStatus,
  figures: Partial<RequisitionFundingSnapshot> = {},
): RequisitionFundingSnapshot {
  return {
    status,
    requestedAmount: 4178,
    approvedAmount: 3000,
    transportation: 0,
    funded: 0,
    spent: 0,
    returnedToAccounts: 0,
    unspent: 0,
    snapshottedAt: NOW,
    ...figures,
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

describe('FundsPanel — stage-selector pills', () => {
  it('renders a pill for each forward-progress snapshot stage', () => {
    renderPanel(
      detail({
        fundingSnapshots: [
          snapshot(RequisitionStatus.BOM_GENERATED),
          snapshot(RequisitionStatus.SENT_TO_ACCOUNTS),
          snapshot(RequisitionStatus.FUNDS_RECEIVED, { funded: 3000 }),
          snapshot(RequisitionStatus.PURCHASED, { funded: 3000, spent: 2500 }),
          snapshot(RequisitionStatus.PURCHASE_VERIFIED, {
            funded: 3000,
            spent: 2500,
            returnedToAccounts: 100,
            transportation: 200,
          }),
          snapshot(RequisitionStatus.STOCKED, {
            funded: 3000,
            spent: 2500,
            returnedToAccounts: 100,
            transportation: 200,
          }),
        ],
      }),
    );

    const tablist = screen.getByRole('tablist', { name: /figures at stage/i });
    const pills = within(tablist).getAllByRole('tab');
    // Six pills: bom, accounts, funded, purchased, verified, inStock.
    expect(pills).toHaveLength(6);
    expect(pills.map((p) => p.textContent)).toEqual([
      'BOM',
      'Accounts',
      'Funded',
      'Purchased',
      'Verified',
      'In stock',
    ]);
  });

  it('enables only the pills whose status has a snapshot row', () => {
    renderPanel(
      detail({
        fundingSnapshots: [
          snapshot(RequisitionStatus.BOM_GENERATED),
          snapshot(RequisitionStatus.SENT_TO_ACCOUNTS),
          // No FUNDS_RECEIVED or PURCHASED row — those pills are disabled.
          snapshot(RequisitionStatus.PURCHASE_VERIFIED, { funded: 3000, spent: 2500 }),
        ],
      }),
    );

    const tablist = screen.getByRole('tablist', { name: /figures at stage/i });
    const pills = within(tablist).getAllByRole('tab');
    const enabled = pills.filter((p) => !(p as HTMLButtonElement).disabled);
    expect(enabled.map((p) => p.textContent)).toEqual(['BOM', 'Accounts', 'Verified']);
  });

  it('defaults to the current requisition stage (no regression on page load)', () => {
    renderPanel(
      detail({
        // Status is STOCKED — the "inStock" pill should be the default selected one.
        status: RequisitionStatus.STOCKED,
        fundingSnapshots: [
          snapshot(RequisitionStatus.BOM_GENERATED),
          snapshot(RequisitionStatus.SENT_TO_ACCOUNTS),
          snapshot(RequisitionStatus.STOCKED, {
            funded: 3000,
            spent: 2500,
            returnedToAccounts: 100,
            transportation: 200,
          }),
        ],
      }),
    );

    const inStock = screen.getByRole('tab', { name: 'In stock' });
    expect(inStock).toHaveAttribute('aria-selected', 'true');
  });

  it('clicking an enabled pill swaps the figures to the snapshot values', async () => {
    const user = userEvent.setup();
    renderPanel(
      detail({
        status: RequisitionStatus.STOCKED,
        fundingSnapshots: [
          // BOM-stage snapshot: no money has moved yet — funded/spent/returned are zero.
          // Approved stays at the frozen 3000 (the approver's revision is captured).
          snapshot(RequisitionStatus.BOM_GENERATED),
          // Funded-stage snapshot: accounts has released 3000, nothing else.
          snapshot(RequisitionStatus.FUNDS_RECEIVED, { funded: 3000 }),
        ],
      }),
    );

    // Click the "BOM" pill — funded/spent/returned/unspent all collapse to 0.00.
    await user.click(screen.getByRole('tab', { name: 'BOM' }));
    // Approved is the one figure that survives the BOM snapshot (frozen at submit-time).
    expect(within(screen.getByRole('tabpanel')).getByText('3,000.00')).toBeInTheDocument();
    // Funded, spent, returned, unspent all collapse to 0.00 — formatBdt uses 2 decimals.
    expect(screen.getAllByText('0.00').length).toBeGreaterThanOrEqual(4);

    // Click the "Funded" pill — funded should be 3000 (and so should approved). Use
    // getAllByText because both the "Approved" and "Funded" <dd> cells now show 3,000.00.
    await user.click(screen.getByRole('tab', { name: 'Funded' }));
    const tabpanel = screen.getByRole('tabpanel');
    expect(within(tabpanel).getAllByText('3,000.00')).toHaveLength(2);
  });

  it('disabled pills do not change state when clicked', async () => {
    const user = userEvent.setup();
    renderPanel(
      detail({
        status: RequisitionStatus.BOM_GENERATED,
        fundingSnapshots: [
          // Only BOM has a snapshot — every other pill is disabled.
          snapshot(RequisitionStatus.BOM_GENERATED),
        ],
      }),
    );

    const inStock = screen.getByRole('tab', { name: 'In stock' });
    expect(inStock).toBeDisabled();

    // Click anyway — the disabled attribute prevents the click handler from running, so
    // the panel should still report the BOM-pill as selected.
    await user.click(inStock).catch(() => {
      // userEvent surfaces "not interactive" errors on disabled buttons; ignore.
    });

    const bom = screen.getByRole('tab', { name: 'BOM' });
    expect(bom).toHaveAttribute('aria-selected', 'true');
    expect(inStock).toHaveAttribute('aria-selected', 'false');
  });

  it('shows a context line below the pills when a historical snapshot is selected', async () => {
    const user = userEvent.setup();
    renderPanel(
      detail({
        status: RequisitionStatus.STOCKED,
        fundingSnapshots: [
          snapshot(RequisitionStatus.BOM_GENERATED),
          snapshot(RequisitionStatus.STOCKED, {
            funded: 3000,
            spent: 2500,
            returnedToAccounts: 100,
            transportation: 200,
          }),
        ],
      }),
    );

    // Click the BOM pill to select a historical snapshot.
    await user.click(screen.getByRole('tab', { name: 'BOM' }));
    // The context line reads "Figures as of <stage>" so the user knows *which* pill they
    // selected and that the figures below are historical, not live.
    expect(screen.getByText('Figures as of BOM')).toBeInTheDocument();
  });

  it('rejects REJECTED / CANCELLED — never renders them as pills', () => {
    renderPanel(
      detail({
        status: RequisitionStatus.STOCKED,
        fundingSnapshots: [
          snapshot(RequisitionStatus.BOM_GENERATED),
          snapshot(RequisitionStatus.STOCKED, {
            funded: 3000,
            spent: 2500,
            returnedToAccounts: 100,
            transportation: 200,
          }),
        ],
      }),
    );

    const tablist = screen.getByRole('tablist', { name: /figures at stage/i });
    // No pill labelled "Rejected" or "Cancelled" — backward-only statuses are filtered out
    // by `SNAPSHOT_STAGES` which is the pill source of truth.
    expect(within(tablist).queryByRole('tab', { name: /rejected/i })).toBeNull();
    expect(within(tablist).queryByRole('tab', { name: /cancelled/i })).toBeNull();
  });
});
