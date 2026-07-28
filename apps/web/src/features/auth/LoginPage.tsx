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

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-ink">{t.app.name}</h1>
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
      </div>
    </main>
  );
}
