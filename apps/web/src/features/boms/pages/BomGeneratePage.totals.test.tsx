import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser, type BomCandidate } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import * as bomApi from '../api';
import { BomGeneratePage } from './BomGeneratePage';

/**
 * D-026. Editing a line's unit cost updated that row's own total but left BOM SUBTOTAL and
 * VARIANCE frozen at the figures they were born with.
 *
 * The generated document was always correct, so this is preview-only — but the preview is the
 * figure the Inventory Manager reads before committing, and VARIANCE is what tells them whether
 * they are over the sanctioned amount. A frozen variance is a wrong answer to the one question
 * the screen exists to answer.
 */

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useBomCandidates: vi.fn(),
    useGenerateBom: vi.fn(),
    useSendBackForRevision: vi.fn(),
  };
});

vi.mock('@/features/auth/auth-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'u1',
        email: 'im@ims.local',
        fullName: 'Inara IM',
        designation: 'Inventory Manager',
        departmentId: null,
        departmentName: null,
        roles: [Role.INVENTORY_MANAGER],
        mustChangePassword: false,
      } as AuthUser,
      isRestoring: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshUser: vi.fn(),
      hasRole: () => true,
    }),
  };
});

const MULTI_ITEM: BomCandidate = {
  requisitionId: 'r-multi',
  requisitionNo: 'REQ-000101',
  requesterName: 'Rana',
  departmentName: 'Lab',
  projectName: 'P',
  approvedAmount: 40_000,
  items: [
    {
      requisitionItemId: 'ri-multi-1',
      productId: null,
      itemName: 'Item A',
      quantity: 2,
      estimatedUnitPrice: 10_000,
      purpose: null,
    },
    {
      requisitionItemId: 'ri-multi-2',
      productId: null,
      itemName: 'Item B',
      quantity: 1,
      estimatedUnitPrice: 8_000,
      purpose: null,
    },
  ],
};

/** The footer cell whose label matches, read as text so the assertion is what the IM sees. */
function totalsValue(label: string): string {
  const cell = screen.getByText(label).closest('div')!;
  return cell.textContent!.replace(label, '').trim();
}

function renderGenerate() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/boms/new']}>
          <BomGeneratePage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('BomGeneratePage totals', () => {
  it('recomputes BOM subtotal and variance when a unit cost changes', async () => {
    const user = userEvent.setup();
    vi.mocked(bomApi.useBomCandidates).mockReturnValue({
      data: [MULTI_ITEM],
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBomCandidates>);
    vi.mocked(bomApi.useGenerateBom).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof bomApi.useGenerateBom>);
    vi.mocked(bomApi.useSendBackForRevision).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof bomApi.useSendBackForRevision>);

    renderGenerate();

    const pickerRow = screen.getByText('REQ-000101').closest('label')!;
    await user.click(within(pickerRow).getByRole('checkbox'));

    // 2 x 10,000 + 1 x 8,000 against an approved 40,000.
    const before = totalsValue(t.boms.bomSubtotal);
    const varianceBefore = totalsValue(t.boms.variance);
    expect(before).toBe((28_000).toLocaleString());

    // Halve Item A's unit cost: 2 x 5,000 + 1 x 8,000 = 18,000.
    const firstUnitCost = screen.getAllByLabelText(t.boms.unitCost)[0]!;
    await user.clear(firstUnitCost);
    await user.type(firstUnitCost, '5000');

    expect(totalsValue(t.boms.bomSubtotal)).toBe((18_000).toLocaleString());
    expect(totalsValue(t.boms.variance)).not.toBe(varianceBefore);
    expect(totalsValue(t.boms.variance)).toContain((-22_000).toLocaleString());
  });
});
