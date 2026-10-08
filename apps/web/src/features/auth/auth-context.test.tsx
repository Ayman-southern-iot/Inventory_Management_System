import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser } from '@ims/shared';
import type * as ClientModule from '@/api/client';
import { ApiError, api } from '@/api/client';
import { webConfig } from '@/api/config';
import { TOKEN_STORAGE_KEY, readStoredTokens, writeStoredTokens } from '@/api/token-store';
import { AuthProvider, useAuth } from './auth-context';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, api: { ...actual.api, get: vi.fn(), loginRequest: vi.fn() } };
});
const get = vi.mocked(api.get);
const loginRequest = vi.mocked(api.loginRequest);

const someone = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'lab-panel@example.invalid',
  fullName: 'Lab panel',
  designation: 'Kiosk',
  departmentId: null,
  departmentName: null,
  roles: [Role.GENERAL],
  mustChangePassword: false,
} satisfies AuthUser;

const unreachable = () => new ApiError('NETWORK', 'Cannot reach the server', 0);

/** The provider's sign-in, captured so a test can sign in the way LoginPage does. */
let signIn: ReturnType<typeof useAuth>['signIn'];

function Probe() {
  const auth = useAuth();
  signIn = auth.signIn;
  return <p>{auth.isRestoring ? 'restoring' : (auth.user?.email ?? 'signed out')}</p>;
}

function renderProvider() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** Lets the restore's awaited call settle without moving the clock. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

describe('AuthProvider: restoring a stored session at start-up', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    localStorage.clear();
    writeStoredTokens({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps the stored session when the API cannot be reached', async () => {
    get.mockRejectedValue(unreachable());
    renderProvider();
    await settle();

    expect(readStoredTokens()).not.toBeNull();
    expect(screen.queryByText('signed out')).not.toBeInTheDocument();
  });

  it('signs back in from the stored session once the API answers again', async () => {
    get.mockRejectedValueOnce(unreachable()).mockResolvedValue(someone);
    renderProvider();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(screen.getByText(someone.email)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps the session through a gateway error too: a proxy answered, the API did not', async () => {
    get.mockRejectedValue(new ApiError('INTERNAL', 'Request failed', 502));
    renderProvider();
    await settle();

    expect(readStoredTokens()).not.toBeNull();
    expect(screen.queryByText('signed out')).not.toBeInTheDocument();
  });

  it.each([503, 504])('keeps the session through a %i as well, and asks again', async (status) => {
    get.mockRejectedValue(new ApiError('INTERNAL', 'Request failed', status));
    renderProvider();
    await settle();
    expect(readStoredTokens()).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(webConfig.sessionRestoreRetryMs));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('ends the restore at once when someone signs in while a retry is pending', async () => {
    // LoginPage redirects only when restoring is over, so a pending retry left the form on
    // screen after a successful sign-in until the timer fired.
    get.mockRejectedValue(unreachable());
    loginRequest.mockResolvedValue({
      accessToken: 'new',
      refreshToken: 'new',
      expiresIn: 900,
      user: someone,
    });
    renderProvider();
    await settle();
    expect(screen.getByText('restoring')).toBeInTheDocument();

    await act(async () => {
      await signIn({ email: someone.email, password: 'secret-for-test' });
    });
    expect(screen.getByText(someone.email)).toBeInTheDocument();

    // The pending retry is cancelled, not left to call /auth/me again later.
    await act(() => vi.advanceTimersByTimeAsync(webConfig.sessionRestoreRetryMs * 2));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('ends the restore at once when another tab signs out while a retry is pending', async () => {
    get.mockRejectedValue(unreachable());
    renderProvider();
    await settle();
    expect(screen.getByText('restoring')).toBeInTheDocument();

    localStorage.removeItem(TOKEN_STORAGE_KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY, newValue: null }));
    });
    expect(screen.getByText('signed out')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(webConfig.sessionRestoreRetryMs * 2));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('stops asking again once the app is gone', async () => {
    get.mockRejectedValue(unreachable());
    const client = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await settle();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('forgets a deactivated account: the server answered, and said no', async () => {
    get.mockRejectedValue(new ApiError('ACCOUNT_DEACTIVATED', 'Account deactivated', 403));
    renderProvider();
    await settle();
    expect(readStoredTokens()).toBeNull();
    expect(screen.getByText('signed out')).toBeInTheDocument();
  });

  it('still forgets the session when the server rejects it', async () => {
    get.mockRejectedValue(new ApiError('TOKEN_EXPIRED', 'Session expired', 401));
    renderProvider();
    await settle();

    expect(readStoredTokens()).toBeNull();
    expect(screen.getByText('signed out')).toBeInTheDocument();
  });
});
