import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Role, type AuthUser } from '@ims/shared';
import type * as ClientModule from '@/api/client';
import { ApiError, api } from '@/api/client';
import { t } from '@/i18n/en';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ROUTES } from '@/routes/paths';
import { LoginPage } from './LoginPage';

const signIn = vi.fn();
const signOut = vi.fn();
/** Who the auth context says is signed in. Read at render time, so a test can set it first. */
let signedIn: AuthUser | null = null;
vi.mock('../auth-context', () => ({
  useAuth: () => ({ user: signedIn, isRestoring: false, signIn, signOut }),
}));
// Demo accounts are off, as on the panel's production server.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn().mockRejectedValue(new actual.ApiError('NOT_FOUND', 'x', 404)),
    },
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

async function typeOnScreen(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  text: string,
) {
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
    vi.mocked(api.get).mockRejectedValue(new ApiError('NOT_FOUND', 'x', 404));
    signIn.mockReset();
    signOut.mockReset().mockResolvedValue(undefined);
    signedIn = null;
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

  it('offers no demo accounts on the kiosk, even when the server lists them', async () => {
    const demo = {
      password: 'demo-password',
      accounts: [
        { email: 'demo@example.invalid', fullName: 'Demo', designation: '', roles: [Role.ADMIN] },
      ],
    };
    const answered = Promise.resolve(demo);
    vi.mocked(api.get).mockReturnValue(answered);
    renderLogin(`${ROUTES.login}?kiosk=1`);
    // Let the answer arrive and render before asserting what is not there.
    await act(async () => {
      await answered;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.get).toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: t.auth.demoAccountsTitle }),
    ).not.toBeInTheDocument();
  });

  it('still offers them to an ordinary visitor on a demo server', async () => {
    const demo = {
      password: 'demo-password',
      accounts: [
        { email: 'demo@example.invalid', fullName: 'Demo', designation: '', roles: [Role.ADMIN] },
      ],
    };
    vi.mocked(api.get).mockResolvedValue(demo);
    renderLogin(ROUTES.login);
    expect(
      await screen.findByRole('region', { name: t.auth.demoAccountsTitle }),
    ).toBeInTheDocument();
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

  it('sends a kiosk that is already signed in to the panel, not the dashboard', () => {
    // A kiosk started on /login?kiosk=1 restores its session at every boot. The dashboard is
    // the full app, with borrower names one tap away: never on the wall.
    signedIn = panelUser;
    renderLogin(`${ROUTES.login}?kiosk=1`);
    expect(screen.getByText('the panel')).toBeInTheDocument();
  });

  it('refuses an account that must change its password, signs it out and stays on the login page', async () => {
    // The change-password page sits inside the app shell and has no on-screen keyboard.
    const user = userEvent.setup();
    signIn.mockResolvedValue({ ...panelUser, mustChangePassword: true });
    renderLogin(`${ROUTES.login}?kiosk=1`);

    await typeOnScreen(user, screen.getByLabelText(t.auth.email), 'lab-panel@siot.lab');
    await typeOnScreen(user, screen.getByLabelText(t.auth.password), 'Panel-pw1');
    await user.click(screen.getByRole('button', { name: t.auth.signIn }));

    expect(await screen.findByRole('alert')).toHaveTextContent(t.auth.kioskMustChangePassword);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('change password')).not.toBeInTheDocument();
    expect(keyboard()).toBeInTheDocument();
  });

  it('sends an ordinary sign-in to the dashboard, as before kiosk mode existed', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue(panelUser);
    renderLogin(ROUTES.login);
    await user.type(screen.getByLabelText(t.auth.email), 'someone@example.invalid');
    await user.type(screen.getByLabelText(t.auth.password), 'Some-pw1');
    await user.click(screen.getByRole('button', { name: t.auth.signIn }));
    expect(await screen.findByText('the dashboard')).toBeInTheDocument();
  });

  it('still sends an ordinary visitor whose password must change to the change-password page', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({ ...panelUser, mustChangePassword: true });
    renderLogin(ROUTES.login);

    await user.type(screen.getByLabelText(t.auth.email), 'someone@example.invalid');
    await user.type(screen.getByLabelText(t.auth.password), 'Temp-pw1');
    await user.click(screen.getByRole('button', { name: t.auth.signIn }));

    expect(await screen.findByText('change password')).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
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
