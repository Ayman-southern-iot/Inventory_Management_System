import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ApiKeyScope,
  createApiKeySchema,
  hasWriteScope,
  type CreateApiKeyInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useCreateApiKey } from '../api';
import { ApiKeyExpiryField } from './ApiKeyExpiryField';
import { ApiKeyScopeFields } from './ApiKeyScopeFields';
import { ServiceAccountPicker } from './ServiceAccountPicker';
import { DEFAULT_EXPIRY_DAYS, reconcileExpiry } from './api-key-expiry';

/** A read-only key with the default expiry: exactly what the dialog offered before write scopes. */
const EMPTY: CreateApiKeyInput = {
  name: '',
  scopes: [ApiKeyScope.INVENTORY_READ],
  expiresInDays: DEFAULT_EXPIRY_DAYS,
  serviceAccountId: null,
};

interface CreateApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  /** Handed the raw token the moment it exists, for the one-time reveal. */
  onIssued: (token: string) => void;
  /** From the usage document: the longest a key that can change data may live (OQ-KT3). */
  writeKeyMaxLifetimeDays: number;
}

/**
 * Issue a key. Validation is the shared `createApiKeySchema`, whose refinement demands a service
 * account and an expiry once any write scope is ticked; the one rule it cannot see — the
 * configured ceiling on that expiry — is enforced by never offering a longer option.
 */
export function CreateApiKeyDialog({
  open,
  onClose,
  onIssued,
  writeKeyMaxLifetimeDays,
}: CreateApiKeyDialogProps) {
  const toast = useToast();
  const createKey = useCreateApiKey();
  const form = useForm<CreateApiKeyInput>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open, form]);

  const { errors, isSubmitted, isSubmitting } = form.formState;
  const scopes = form.watch('scopes');
  const expiresInDays = form.watch('expiresInDays');
  const serviceAccountId = form.watch('serviceAccountId');
  const isWrite = hasWriteScope(scopes);

  /**
   * Keeps the other two fields legal for the new scope set, instead of letting submit find out:
   * a write key gets an expiry within the ceiling, a read-only key drops its account.
   */
  function changeScopes(next: ApiKeyScope[]) {
    const nextIsWrite = hasWriteScope(next);
    form.setValue('scopes', next);
    form.setValue(
      'expiresInDays',
      reconcileExpiry(expiresInDays, nextIsWrite, writeKeyMaxLifetimeDays),
    );
    if (!nextIsWrite) form.setValue('serviceAccountId', null);
    if (isSubmitted) void form.trigger();
  }

  async function onCreate(values: CreateApiKeyInput) {
    try {
      const created = await createKey.mutateAsync(values);
      toast.success(t.apiKeys.created);
      onClose();
      // Straight into the one-time reveal — there is no second chance to show this.
      onIssued(created.token);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <Dialog
      schema={createApiKeySchema}
      open={open}
      onClose={onClose}
      title={t.apiKeys.createTitle}
      subtitle={t.apiKeys.createSubtitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button isLoading={isSubmitting} onClick={() => void form.handleSubmit(onCreate)()}>
            {t.apiKeys.issue}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={form.handleSubmit(onCreate)} className="flex flex-col gap-4">
        <TextField
          label={t.apiKeys.name}
          placeholder={t.apiKeys.namePlaceholder}
          hint={t.apiKeys.nameHint}
          error={errors.name?.message}
          {...form.register('name')}
        />

        <ApiKeyScopeFields
          value={scopes}
          onChange={changeScopes}
          error={errors.scopes ? t.apiKeys.scopesRequired : undefined}
        />

        {isWrite ? (
          <>
            <p className="rounded-[--radius-control] bg-pending-subtle px-3 py-2 text-xs text-ink">
              {t.apiKeys.writeScopeNotice.replace('{n}', String(writeKeyMaxLifetimeDays))}
            </p>
            <ServiceAccountPicker
              value={serviceAccountId}
              onChange={(id) =>
                form.setValue('serviceAccountId', id, { shouldValidate: isSubmitted })
              }
              error={errors.serviceAccountId ? t.apiKeys.serviceAccountRequired : undefined}
            />
          </>
        ) : null}

        <ApiKeyExpiryField
          value={expiresInDays}
          onChange={(days) =>
            form.setValue('expiresInDays', days, { shouldValidate: isSubmitted })
          }
          isWrite={isWrite}
          writeKeyMaxLifetimeDays={writeKeyMaxLifetimeDays}
          error={errors.expiresInDays ? t.apiKeys.expiryRequired : undefined}
        />
      </form>
    </Dialog>
  );
}
