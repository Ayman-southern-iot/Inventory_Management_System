import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
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
import * as bomsApi from '@/features/boms/api';
import { FundsPanel } from './FundsPanel';

/**
 * Audit F2. `GET /boms/by-requisition/:id` is IM and Admin only, and the panel asked for it for
 * every viewer, so a requester or approver got a 403 on every requisition page. It asks only
 * those who can read the answer.
 */
const session = vi.hoisted(() => ({ roles: [] as string[] }));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFunding: vi.fn(), useUnverifyPurchase: vi.fn() };
});

vi.mock('@/features/boms/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useBomForRequisition: vi.fn() };
});

vi.mock('@/features/auth/auth-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'u-1', roles: session.roles, mustChangePassword: false },
      isRestoring: false,
      hasRole: (...roles: string[]) => roles.some((role) => session.roles.includes(role)),
    }),
  };
});

const NOW = '2026-08-12T12:00:00.000Z';

const FUNDING = {
  requisitionId: 'req-1',
  requestedAmount: 100,
  approvedAmount: 100,
  funded: 0,
  spent: 0,
  transportation: 0,
  spentInclTransportation: 0,
  returned: 0,
  netFunded: 0,
  outstanding: 100,
  unspent: 0,
  allowsPartialFunding: false,
  isFullyFunded: false,
  receipts: [],
  purchases: [],
  returns: [],
} as unknown as RequisitionFunding;

const DETAIL = {
  id: 'req-1',
  requisitionNo: 'REQ-000001',
  urgency: RequisitionUrgency.NORMAL,
  status: RequisitionStatus.SENT_TO_ACCOUNTS,
  createdAt: NOW,
  updatedAt: NOW,
  items: [],
  approvals: [],
  events: [],
  fundingSnapshots: [],
} as unknown as RequisitionDetail;

function renderAs(roles: string[]) {
  session.roles = roles;
  vi.mocked(fundsApi.useFunding).mockReturnValue({ data: FUNDING, isPending: false, isError: false } as never);
  vi.mocked(fundsApi.useUnverifyPurchase).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
  vi.mocked(bomsApi.useBomForRequisition).mockReturnValue({ data: null } as never);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <FundsPanel requisition={DETAIL} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('FundsPanel asks for the live BOM only when the viewer may read it', () => {
  beforeEach(() => {
    vi.mocked(bomsApi.useBomForRequisition).mockReset();
  });

  it.each([
    ['a requester', [Role.GENERAL]],
    ['an approver', [Role.GENERAL, Role.APPROVER]],
  ])('does not ask for %s', (_label, roles) => {
    renderAs(roles);
    expect(bomsApi.useBomForRequisition).toHaveBeenCalledWith('req-1', { enabled: false });
    expect(bomsApi.useBomForRequisition).not.toHaveBeenCalledWith('req-1', { enabled: true });
  });

  it.each([
    ['the Inventory Manager', [Role.GENERAL, Role.INVENTORY_MANAGER]],
    ['an administrator', [Role.GENERAL, Role.ADMIN]],
  ])('asks for %s', (_label, roles) => {
    renderAs(roles);
    expect(bomsApi.useBomForRequisition).toHaveBeenCalledWith('req-1', { enabled: true });
  });
});
