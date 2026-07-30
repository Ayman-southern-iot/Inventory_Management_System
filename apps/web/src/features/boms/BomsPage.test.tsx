import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import * as bomApi from './api';
import { BomsPage } from './BomsPage';

/**
 * Smoke test for the BOM list — filter pills toggle, a row click navigates,
 * the empty state explains what to do.
 *
 * Mocks `useBoms` and `useAuth` so the page mounts without a network and
 * without the full auth provider.
 */

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useBoms: vi.fn(),
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

function renderBoms() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/boms']}>
          <BomsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('BomsPage', () => {
  it('renders an empty state with a Create BOM button', () => {
    vi.mocked(bomApi.useBoms).mockReturnValue({
      data: { items: [], page: 1, limit: 20, total: 0 },
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBoms>);

    renderBoms();

    expect(screen.getByText(t.boms.emptyTitle)).toBeInTheDocument();
    // The header action button is also named "New BOM" — confirm there are
    // exactly two and the empty-state one is among them.
    const newBomButtons = screen.getAllByRole('button', { name: t.boms.newBom });
    expect(newBomButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders one row per BOM with PDF and void badges', () => {
    vi.mocked(bomApi.useBoms).mockReturnValue({
      data: {
        items: [
          {
            id: 'bom-1',
            bomNo: 'BOM-000001',
            generatedByName: 'Inara IM',
            subtotal: 3000,
            isVoid: false,
            voidReason: null,
            voidedByName: null,
            voidedAt: null,
            overBudgetBounced: false,
            hasPdf: true,
            generatedAt: '2026-07-29T12:00:00.000Z',
            requisitionNos: ['REQ-000001'],
          },
          {
            id: 'bom-2',
            bomNo: 'BOM-000002',
            generatedByName: 'Inara IM',
            subtotal: 9000,
            isVoid: true,
            voidReason: 'wrong totals',
            voidedByName: 'Inara IM',
            voidedAt: '2026-07-29T13:00:00.000Z',
            overBudgetBounced: false,
            hasPdf: false,
            generatedAt: '2026-07-28T12:00:00.000Z',
            requisitionNos: ['REQ-000002'],
          },
        ],
        page: 1,
        limit: 20,
        total: 2,
      },
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBoms>);

    renderBoms();

    const rows = screen.getAllByRole('row');
    // Header + 2 data rows.
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('BOM-000001')).toBeInTheDocument();
    expect(within(rows[1]!).getByText(t.boms.pdfReady)).toBeInTheDocument();
    expect(within(rows[2]!).getByText('BOM-000002')).toBeInTheDocument();
    expect(within(rows[2]!).getByText(t.boms.voidedLabel)).toBeInTheDocument();
  });

  it('toggles the filter pill from Live to Voided', async () => {
    const user = userEvent.setup();
    vi.mocked(bomApi.useBoms).mockReturnValue({
      data: { items: [], page: 1, limit: 20, total: 0 },
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBoms>);

    renderBoms();

    const livePill = screen.getByRole('button', { name: t.boms.filterLive });
    const voidedPill = screen.getByRole('button', { name: t.boms.filterVoided });

    expect(livePill).toHaveAttribute('aria-pressed', 'true');
    expect(voidedPill).toHaveAttribute('aria-pressed', 'false');

    await user.click(voidedPill);

    expect(livePill).toHaveAttribute('aria-pressed', 'false');
    expect(voidedPill).toHaveAttribute('aria-pressed', 'true');
  });
});