import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { loginSchema, type LoginInput } from '@ims/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useAuth } from './auth-context';
import { ROUTES } from '@/routes/paths';

/**
 * Hard-coded demo credentials displayed under the sign-in card. Strictly a developer
 * convenience — the block is wrapped in `import.meta.env.DEV` so the production bundle
 * never ships it (rules/30-frontend.md; verified by the production-safety grep in the
 * Phase 05 plan).
 */
const TEST_ACCOUNTS: ReadonlyArray<{
  label: string;
  email: string;
  password: string;
}> = [
  { label: 'Admin (ims.net)', email: 'admin@ims.net', password: '@admin@' },
  { label: 'Admin (admin.net)', email: 'admin@admin.net', password: '@admin@' },
];

export function LoginPage() {
  const { user, isRestoring, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  // The same zod schema the API validates with (rules/30-frontend.md) — written once.
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
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

  // `import.meta.env.DEV` is statically replaced by Vite at build time, so the whole
  // test-accounts block is dead-code-eliminated from the production bundle.
  const isDev = import.meta.env.DEV;

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

        {isDev ? (
          <section
            aria-label={t.auth.testAccountsTitle}
            className="mt-4 rounded-[--radius-panel] border border-border bg-surface-2 p-4 text-xs text-ink-muted"
          >
            <h3 className="text-sm font-semibold text-ink">{t.auth.testAccountsTitle}</h3>
            <p className="mt-1">{t.auth.testAccountsHint}</p>
            <table className="mt-3 w-full text-left">
              <thead className="text-[0.7rem] uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="pb-1 pr-2 font-medium">{t.auth.testAccountsRole}</th>
                  <th className="pb-1 pr-2 font-medium">{t.auth.testAccountsEmail}</th>
                  <th className="pb-1 font-medium">{t.auth.testAccountsPassword}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {TEST_ACCOUNTS.map((account) => (
                  <tr key={account.email}>
                    <td className="py-1.5 pr-2 text-ink">{account.label}</td>
                    <td className="py-1.5 pr-2 font-mono text-[0.7rem] text-ink">
                      {account.email}
                    </td>
                    <td className="py-1.5 font-mono text-[0.7rem] text-ink">
                      {account.password}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </main>
  );
}
