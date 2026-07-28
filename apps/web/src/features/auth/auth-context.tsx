import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type Role, type AuthUser, type LoginInput, type LoginResponse } from '@ims/shared';
import { api, setSessionLostHandler } from '@/api/client';
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
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const queryClient = useQueryClient();

  const forgetSession = useCallback(() => {
    clearStoredTokens();
    setUser(null);
    // Otherwise the next user to sign in on this machine sees the previous user's cached lists.
    queryClient.clear();
  }, [queryClient]);

  // A refresh that fails anywhere in the app drops straight back to the login screen.
  useEffect(() => {
    setSessionLostHandler(forgetSession);
    return () => setSessionLostHandler(null);
  }, [forgetSession]);

  // Restore an existing session on first paint.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!readStoredTokens()) {
        if (!cancelled) setIsRestoring(false);
        return;
      }
      try {
        const me = await api.get<AuthUser>('/auth/me');
        if (!cancelled) setUser(me);
      } catch {
        // The client already tried to refresh; reaching here means the session is gone.
        if (!cancelled) forgetSession();
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [forgetSession]);

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
      return response.user;
    },
    [],
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

  const hasRole = useCallback(
    (...roles: Role[]) => roles.some((role) => user?.roles.includes(role) ?? false),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, isRestoring, signIn, signOut, refreshUser, hasRole }),
    [user, isRestoring, signIn, signOut, refreshUser, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
