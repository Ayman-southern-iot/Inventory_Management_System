import { Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createServiceAccountSchema,
  type CreateServiceAccountInput,
  type ServiceAccount,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useCreateServiceAccount } from '../api';

interface NewServiceAccountFieldProps {
  /** Handed the account the server created, so the caller can select it straight away. */
  onCreated: (account: ServiceAccount) => void;
}

/**
 * Create a service account without leaving the key dialog.
 *
 * Deliberately not a `<form>`: it sits inside the key dialog's form, and a nested form is invalid
 * HTML. Enter is caught here instead, so it creates the account rather than submitting the key.
 */
export function NewServiceAccountField({ onCreated }: NewServiceAccountFieldProps) {
  const toast = useToast();
  const create = useCreateServiceAccount();
  const form = useForm<CreateServiceAccountInput>({
    resolver: zodResolver(createServiceAccountSchema),
    defaultValues: { name: '' },
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      const account = await create.mutateAsync(values);
      toast.success(t.apiKeys.serviceAccountCreated);
      form.reset({ name: '' });
      onCreated(account);
    } catch (error) {
      toast.error(messageForError(error));
    }
  });

  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        {/*
          `required={false}`: the surrounding dialog marks fields from the *key* schema, whose
          `name` is required. This name is only needed if you choose to create an account.
        */}
        <TextField
          label={t.apiKeys.newServiceAccount}
          placeholder={t.apiKeys.newServiceAccountPlaceholder}
          required={false}
          error={form.formState.errors.name?.message}
          {...form.register('name')}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void submit();
          }}
        />
      </div>
      <Button
        type="button"
        variant="secondary"
        icon={<Plus aria-hidden className="size-4" />}
        isLoading={create.isPending}
        onClick={() => void submit()}
      >
        {t.apiKeys.createServiceAccount}
      </Button>
    </div>
  );
}
