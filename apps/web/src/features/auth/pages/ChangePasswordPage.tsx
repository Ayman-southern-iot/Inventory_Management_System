import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { changePasswordSchema, type LoginResponse } from '@ims/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useAuth } from '../auth-context';
import { ROUTES } from '@/routes/paths';

/**
 * Confirmation is client-only by design: the API has no use for a duplicate of the password,
 * so it is layered on top of the shared schema rather than added to it.
 */
const formSchema = changePasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: t.auth.passwordMismatch,
  });

type FormValues = z.infer<typeof formSchema>;

export function ChangePasswordPage() {
  const { user, adoptSession } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: FormValues) {
    try {
      // The server ends every other session and hands back a fresh one, so the caller is not
      // signed out by their own password change. Adopting it also clears `mustChangePassword`
      // before the route guard looks again.
      const session = await api.post<LoginResponse>('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      adoptSession(session);
      toast.success(t.auth.passwordChanged);
      navigate(ROUTES.dashboard, { replace: true });
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title={t.auth.changePasswordTitle}
        subtitle={user?.mustChangePassword ? t.auth.changePasswordForced : undefined}
      />
      <Panel className="p-5">
        <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {/* Password managers need a username field to know which credential is being
              updated; without one they either ignore the change or save it against the
              wrong entry. Hidden because the user cannot change who they are here. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={user?.email ?? ''}
            readOnly
            hidden
            aria-hidden
            tabIndex={-1}
          />
          <TextField
            label={t.auth.currentPassword}
            type="password"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...form.register('currentPassword')}
          />
          <TextField
            label={t.auth.newPassword}
            type="password"
            autoComplete="new-password"
            hint={t.auth.passwordRules}
            error={errors.newPassword?.message}
            {...form.register('newPassword')}
          />
          <TextField
            label={t.auth.confirmPassword}
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...form.register('confirmPassword')}
          />
          <Button type="submit" isLoading={isSubmitting}>
            {t.common.save}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
