import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectUsage, Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ProjectDetailPage } from './ProjectDetailPage';

let currentUser: AuthUser | null = null;
const itemsQuerySpy = vi.fn();

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    user: currentUser,
    hasRole: (...roles: Role[]) => roles.some((role) => currentUser?.roles.includes(role)),
  }),
}));

vi.mock('../api', () => ({
  useProject: () => ({
    data: {
      id: 'p-1',
      name: 'Rover',
      isActive: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      inUseCount: 1,
      returnedCount: 1,
    },
    isPending: false,
    isError: false,
  }),
  useProjectItems: (_id: string, query: { usage?: ProjectUsage }) => {
    itemsQuerySpy(query);
    return {
      data: {
        items: [
          {
            borrowRequestId: 'b-1',
            borrowNo: 'BRW-1',
            productId: 'pr-1',
            productCode: 'PRD-1',
            productName: 'Arduino Uno',
            quantity: 5,
            returnedQty: 2,
            outstandingQty: 3,
            usage: ProjectUsage.IN_USE,
            borrowerName: 'Gina General',
            purpose: 'Prototype',
            expectedReturnDate: null,
            issuedAt: null,
            returnedAt: null,
          },
        ],
        page: 1,
        limit: 25,
        total: 1,
      },
      isPending: false,
      isError: false,
    };
  },
  useRemoveProjectItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/requisitions/api', () => ({
  useRequisitions: () => ({
    data: { items: [], page: 1, limit: 25, total: 0 },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function renderPage(roles: Role[]) {
  currentUser = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'person@ims.local',
    fullName: 'Test Person',
    designation: 'Engineer',
    departmentId: null,
    departmentName: null,
    roles,
    mustChangePassword: false,
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/projects/p-1']}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    itemsQuerySpy.mockClear();
  });

  it('shows the item with its quantity and an in-use tag', () => {
    renderPage([Role.GENERAL]);

    expect(screen.getByText('Arduino Uno')).toBeInTheDocument();
    // The "In use" string appears in both the filter pill and the badge — the badge is a span
    // inside the table row, so scope the lookup to the table body to disambiguate.
    expect(screen.getByText(t.projects.outstanding(3, 5))).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText(t.projects.tagInUse)).toBeInTheDocument();
  });

  it('hides Remove from a general user and shows it to the inventory manager', () => {
    renderPage([Role.GENERAL]);
    expect(screen.queryByRole('button', { name: t.projects.remove })).not.toBeInTheDocument();

    renderPage([Role.GENERAL, Role.INVENTORY_MANAGER]);
    expect(screen.getAllByRole('button', { name: t.projects.remove }).length).toBeGreaterThan(0);
  });

  it('sends the usage filter to the server when a pill is chosen', async () => {
    const user = userEvent.setup();
    renderPage([Role.GENERAL]);

    await user.click(screen.getByRole('button', { name: t.projects.filterReturned }));

    expect(itemsQuerySpy).toHaveBeenCalledWith(
      expect.objectContaining({ usage: ProjectUsage.RETURNED }),
    );
  });
});