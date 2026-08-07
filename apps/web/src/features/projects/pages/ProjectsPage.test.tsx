import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser, type Project } from '@ims/shared';
import { ApiError } from '@/api/client';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { ProjectsPage } from './ProjectsPage';

let currentUser: AuthUser | null = null;

/** Drives the four states the page must handle; each test sets the shape it needs. */
interface StubQuery {
  data: Project[] | undefined;
  isPending: boolean;
  error: unknown;
}

let projectsQuery: StubQuery;
const refetch = vi.fn();

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    user: currentUser,
    hasRole: (...roles: Role[]) => roles.some((role) => currentUser?.roles.includes(role)),
  }),
}));

vi.mock('../api', () => ({
  useProjects: () => ({ ...projectsQuery, refetch }),
  useCreateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const ROVER: Project = {
  id: 'p-1',
  name: 'Rover',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectsPage', () => {
  beforeEach(() => {
    refetch.mockClear();
    currentUser = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'gina@ims.local',
      fullName: 'Gina General',
      designation: 'Engineer',
      departmentId: null,
      departmentName: null,
      roles: [Role.GENERAL],
      mustChangePassword: false,
    };
    projectsQuery = { data: [ROVER], isPending: false, error: null };
  });

  it('shows the projects and the create action to a general user', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: t.projects.title })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Rover/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', ROUTES.projects.detail(ROVER.id));
    expect(screen.getByRole('button', { name: t.projects.create })).toBeInTheDocument();
  });

  it('shows a loading placeholder while the list is pending', () => {
    projectsQuery = { data: undefined, isPending: true, error: null };
    renderPage();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Rover/ })).not.toBeInTheDocument();
  });

  it('says there is nothing yet rather than showing an empty panel', () => {
    projectsQuery = { data: [], isPending: false, error: null };
    renderPage();

    expect(screen.getByText(t.projects.empty)).toBeInTheDocument();
    expect(screen.getByText(t.projects.emptyBody)).toBeInTheDocument();
  });

  it('offers a retry when the list fails to load', async () => {
    projectsQuery = {
      data: undefined,
      isPending: false,
      error: new ApiError('INTERNAL', 'boom', 500),
    };
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.common.retry }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('opens the create dialog from the header action', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: t.projects.create }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText(t.projects.nameLabel)).toBeInTheDocument();
  });
});
