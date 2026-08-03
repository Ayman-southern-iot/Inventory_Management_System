import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { loginSchema, type DemoAccounts, type LoginInput } from '@ims/shared';
import { ApiError, api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useAuth } from './auth-context';
import { ROUTES } from '@/routes/paths';

export function LoginPage() {
  const { user, isRestoring, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  // The same zod schema the API validates with (rules/30-frontend.md) — written once.
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  /**
   * The server decides whether demo accounts exist at all — it answers 404 when
   * `DEMO_ACCOUNTS_ENABLED` is off, and this renders nothing. Deliberately server-driven
   * rather than a build-time flag: the same production bundle is what runs on the demo box,
   * and a list of who works here is not something a bundler should be deciding.
   */
  const demo = useQuery({
    queryKey: queryKeys.auth.demoAccounts(),
    queryFn: ({ signal }) => api.get<DemoAccounts>('/auth/demo-accounts', signal),
    retry: false,
    staleTime: 30_000,
  });

  if (!isRestoring && user) {
    const from = (location.state as { from?: string } | null)?.from ?? ROUTES.dashboard;
    return <Navigate to={from} replace />;
  }

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    try {
      const signedIn = await signIn(values);
      navigate(signedIn.mustChangePassword ? ROUTES.changePassword : ROUTES.dashboard, {
        replace: true,
      });
    } catch (error) {
      setFormError(
        error instanceof ApiError ? messageForError(error) : t.errors.INTERNAL,
      );
    }
  }

  /** Fills the form rather than signing in directly, so the credentials are visible first. */
  function fillCredentials(email: string, password: string) {
    setValue('email', email, { shouldValidate: true });
    setValue('password', password, { shouldValidate: true });
    setFormError(null);
  }

  const accounts = demo.data?.accounts ?? [];

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img
            src="/southern-iot-logo.png"
            alt={t.app.name}
            className="mx-auto h-16 w-auto"
          />
          <h1 className="mt-3 text-lg font-semibold tracking-tight text-ink">
            {t.app.name}
          </h1>
          <p className="mt-1 text-xs text-ink-subtle">{t.app.acronym}</p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-4 rounded-[--radius-panel] border border-border bg-surface p-6 shadow-[--shadow-panel]"
        >
          <div>
            <h2 className="text-base font-semibold text-ink">{t.auth.signInTitle}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">{t.auth.signInSubtitle}</p>
          </div>

          {formError ? (
            <p
              role="alert"
              className="rounded-[--radius-control] bg-danger-subtle px-3 py-2 text-sm text-danger"
            >
              {formError}
            </p>
          ) : null}

          <TextField
            label={t.auth.email}
            type="email"
            autoComplete="username"
            autoFocus
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField
            label={t.auth.password}
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />

          <Button type="submit" isLoading={isSubmitting}>
            {isSubmitting ? t.auth.signingIn : t.auth.signIn}
          </Button>
        </form>

        {accounts.length > 0 && demo.data ? (
          <section
            aria-label={t.auth.demoAccountsTitle}
            className="mt-4 rounded-[--radius-panel] border border-border bg-surface-2 p-4 text-xs text-ink-muted"
          >
            <h3 className="text-sm font-semibold text-ink">{t.auth.demoAccountsTitle}</h3>
            <p className="mt-1">
              {t.auth.demoAccountsPasswordLabel}{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-ink">
                {demo.data.password}
              </code>
            </p>
            <ul className="mt-3 divide-y divide-border">
              {accounts.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    // An account may carry its own password when it differs from the shared one.
                    onClick={() =>
                      fillCredentials(account.email, account.password ?? demo.data.password)
                    }
                    className="flex w-full flex-col items-start gap-0.5 py-2 text-left hover:bg-surface focus-visible:bg-surface"
                  >
                    <span className="font-medium text-ink">
                      {account.fullName}
                      <span className="ml-2 font-normal text-ink-subtle">
                        {account.roles.join(', ')}
                      </span>
                    </span>
                    <span className="font-mono text-[0.7rem] text-ink-muted">
                      {account.email}
                      <span className="ml-2 text-ink-subtle">
                        {account.password ?? demo.data.password}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[0.7rem] text-ink-subtle">{t.auth.demoAccountsCaveat}</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
