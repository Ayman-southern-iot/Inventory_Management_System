import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type Role, type AuthUser, type LoginInput, type LoginResponse } from '@ims/shared';
import { api, isApiUnreachable, setSessionLostHandler } from '@/api/client';
import { webConfig } from '@/api/config';
import {
  clearStoredTokens,
  readStoredTokens,
  writeStoredTokens,
  TOKEN_STORAGE_KEY,
} from '@/api/token-store';

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the stored session has been checked, so routes do not flash the login screen. */
  isRestoring: boolean;
  signIn: (input: LoginInput) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Adopts a session the server issued outside the login flow, e.g. a password change. */
  adoptSession: (session: LoginResponse) => void;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const queryClient = useQueryClient();
  /** The start-up retry waiting to ask `/auth/me` again while the API was unreachable. */
  const restoreRetry = useRef<number | undefined>(undefined);

  /**
   * The start-up restore is over, whoever ended it: an answer from the API, a sign-in, a
   * session adopted after a password change, or a sign-out. Cancels a pending retry, which
   * otherwise kept `isRestoring` true (and LoginPage from redirecting) until it fired.
   */
  const endRestore = useCallback(() => {
    window.clearTimeout(restoreRetry.current);
    restoreRetry.current = undefined;
    setIsRestoring(false);
  }, []);

  const forgetSession = useCallback(() => {
    clearStoredTokens();
    setUser(null);
    // Otherwise the next user to sign in on this machine sees the previous user's cached lists.
    queryClient.clear();
    endRestore();
  }, [queryClient, endRestore]);

  // A refresh that fails anywhere in the app drops straight back to the login screen.
  useEffect(() => {
    setSessionLostHandler(forgetSession);
    return () => setSessionLostHandler(null);
  }, [forgetSession]);

  // Restore an existing session on first paint.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      restoreRetry.current = undefined;
      if (!readStoredTokens()) {
        if (!cancelled) endRestore();
        return;
      }
      try {
        const me = await api.get<AuthUser>('/auth/me');
        if (cancelled) return;
        setUser(me);
        endRestore();
      } catch (error) {
        if (cancelled) return;
        if (isApiUnreachable(error)) {
          // The API could not be asked, so the stored session may be perfectly good. Keep it
          // and ask again; signing out here strands a kiosk that booted before the network.
          restoreRetry.current = window.setTimeout(
            () => void restore(),
            webConfig.sessionRestoreRetryMs,
          );
          return;
        }
        // The client already tried to refresh; reaching here means the session is gone.
        forgetSession();
      }
    }

    void restore();
    return () => {
      cancelled = true;
      window.clearTimeout(restoreRetry.current);
    };
  }, [forgetSession, endRestore]);

  // Signing out in one tab signs out the others.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === TOKEN_STORAGE_KEY && event.newValue === null) forgetSession();
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [forgetSession]);

  const signIn = useCallback(
    async (input: LoginInput) => {
      const response = await api.loginRequest<LoginResponse>('/auth/login', input);
      writeStoredTokens(response);
      setUser(response.user);
      endRestore();
      return response.user;
    },
    [endRestore],
  );

  const signOut = useCallback(async () => {
    const stored = readStoredTokens();
    try {
      if (stored) await api.post('/auth/logout', { refreshToken: stored.refreshToken });
    } catch {
      // A failed logout call must still clear the client; the token expires on its own.
    } finally {
      forgetSession();
    }
  }, [forgetSession]);

  const refreshUser = useCallback(async () => {
    const me = await api.get<AuthUser>('/auth/me');
    setUser(me);
  }, []);

  const adoptSession = useCallback(
    (session: LoginResponse) => {
      writeStoredTokens(session);
      setUser(session.user);
      endRestore();
    },
    [endRestore],
  );

  const hasRole = useCallback(
    (...roles: Role[]) => roles.some((role) => user?.roles.includes(role) ?? false),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, isRestoring, signIn, signOut, refreshUser, adoptSession, hasRole }),
    [user, isRestoring, signIn, signOut, refreshUser, adoptSession, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
