import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema, type ResetPasswordInput, type User } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useResetUserPassword } from '../api';

export function ResetPasswordDialog({ user, onClose }: { user?: User; onClose: () => void }) {
  const toast = useToast();
  const resetPassword = useResetUserPassword();

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: '', mustChangePassword: true },
  });

  useEffect(() => {
    if (user) form.reset({ newPassword: '', mustChangePassword: true });
  }, [user, form]);

  async function onSubmit(values: ResetPasswordInput) {
    if (!user) return;
    try {
      await resetPassword.mutateAsync({ id: user.id, input: values });
      // No email relay exists yet (OQ-10), so the admin hands the password over in person.
      toast.success(t.users.passwordReset);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { isSubmitting, errors } = form.formState;

  return (
    <Dialog
      open={user !== undefined}
      onClose={onClose}
      title={`${t.users.resetPassword}${user ? ` — ${user.fullName}` : ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button form="reset-password-form" type="submit" isLoading={isSubmitting}>
            {isSubmitting ? t.common.saving : t.common.save}
          </Button>
        </>
      }
    >
      <form
        id="reset-password-form"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        <TextField
          label={t.auth.newPassword}
          type="password"
          autoComplete="new-password"
          hint={t.auth.passwordRules}
          error={errors.newPassword?.message}
          {...form.register('newPassword')}
        />
        <Checkbox label={t.users.mustChangePassword} {...form.register('mustChangePassword')} />
      </form>
    </Dialog>
  );
}
