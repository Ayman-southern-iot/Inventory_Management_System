import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Role, type AuthUser } from '@ims/shared';
import type * as ClientModule from '@/api/client';
import { ApiError } from '@/api/client';
import { t } from '@/i18n/en';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ROUTES } from '@/routes/paths';
import { LoginPage } from './LoginPage';

const signIn = vi.fn();
vi.mock('../auth-context', () => ({
  useAuth: () => ({ user: null, isRestoring: false, signIn }),
}));
// Demo accounts are off, as on the panel's production server.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    api: { ...actual.api, get: vi.fn().mockRejectedValue(new actual.ApiError('NOT_FOUND', 'x', 404)) },
  };
});
vi.stubGlobal('__BUILD_TIME__', '2026-10-05T00:00:00.000Z');

const panelUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'lab-panel@siot.lab',
  fullName: 'Lab panel',
  roles: [Role.GENERAL],
  mustChangePassword: false,
} as unknown as AuthUser;

/** A URL, or a location carrying router state the way `ProtectedRoute` sends it. */
type Entry = string | { pathname: string; state: unknown };

function renderLogin(entry: Entry) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route path={ROUTES.panel} element={<p>the panel</p>} />
          <Route path={ROUTES.dashboard} element={<p>the dashboard</p>} />
          <Route path={ROUTES.changePassword} element={<p>change password</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const keyboard = () => screen.queryByRole('group', { name: t.onScreenKeyboard.label });
const key = (name: string) => screen.getByRole('button', { name });

async function typeOnScreen(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.click(field);
  for (const char of text) {
    if (char >= 'A' && char <= 'Z') {
      await user.click(key(t.onScreenKeyboard.shift));
      await user.click(key(char));
      await user.click(key(t.onScreenKeyboard.shift));
    } else {
      await user.click(key(char));
    }
  }
}

describe('LoginPage in kiosk mode', () => {
  beforeEach(() => {
    signIn.mockReset();
  });

  it('is where a signed-out panel lands: the login page with its keyboard, not a blank screen', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[ROUTES.panel]}>
          <Routes>
            <Route path={ROUTES.login} element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path={ROUTES.panel} element={<p>the panel</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText(t.auth.email)).toBeInTheDocument();
    expect(keyboard()).toBeInTheDocument();
  });

  it('shows the on-screen keyboard when the panel sent the person here', () => {
    renderLogin({ pathname: ROUTES.login, state: { from: ROUTES.panel } });
    expect(keyboard()).toBeInTheDocument();
  });

  it('shows the on-screen keyboard for ?kiosk=1', () => {
    renderLogin(`${ROUTES.login}?kiosk=1`);
    expect(keyboard()).toBeInTheDocument();
  });

  it('shows no keyboard to an ordinary visitor', () => {
    renderLogin(ROUTES.login);
    expect(keyboard()).not.toBeInTheDocument();
  });

  it('signs in with what was typed on screen and goes back to the panel', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue(panelUser);
    renderLogin({ pathname: ROUTES.login, state: { from: ROUTES.panel } });

    await typeOnScreen(user, screen.getByLabelText(t.auth.email), 'lab-panel@siot.lab');
    await typeOnScreen(user, screen.getByLabelText(t.auth.password), 'Panel-pw1');
    await user.click(screen.getByRole('button', { name: t.auth.signIn }));

    expect(signIn).toHaveBeenCalledWith({ email: 'lab-panel@siot.lab', password: 'Panel-pw1' });
    expect(await screen.findByText('the panel')).toBeInTheDocument();
  });

  it('goes back to the panel after a sign-in typed on a plugged-in keyboard too', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue(panelUser);
    renderLogin({ pathname: ROUTES.login, state: { from: ROUTES.panel } });

    await user.type(screen.getByLabelText(t.auth.email), 'lab-panel@siot.lab');
    await user.type(screen.getByLabelText(t.auth.password), 'Panel-pw1');
    await user.click(screen.getByRole('button', { name: t.auth.signIn }));

    expect(await screen.findByText('the panel')).toBeInTheDocument();
  });

  it('still sends an account that must change its password to the change-password page', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({ ...panelUser, mustChangePassword: true });
    renderLogin(`${ROUTES.login}?kiosk=1`);

    await typeOnScreen(user, screen.getByLabelText(t.auth.email), 'lab-panel@siot.lab');
    await typeOnScreen(user, screen.getByLabelText(t.auth.password), 'Panel-pw1');
    await user.click(screen.getByRole('button', { name: t.auth.signIn }));

    expect(await screen.findByText('change password')).toBeInTheDocument();
  });

  it('keeps the kiosk on the login page with the error when the sign-in is refused', async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValue(new ApiError('INVALID_CREDENTIALS', 'Wrong email or password', 401));
    renderLogin({ pathname: ROUTES.login, state: { from: ROUTES.panel } });

    await typeOnScreen(user, screen.getByLabelText(t.auth.email), 'lab-panel@siot.lab');
    await typeOnScreen(user, screen.getByLabelText(t.auth.password), 'wrong');
    await user.click(screen.getByRole('button', { name: t.auth.signIn }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(keyboard()).toBeInTheDocument();
  });
});
