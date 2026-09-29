import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Field';
import { t } from '@/i18n/en';
import { useServiceAccounts } from '../api';
import { NewServiceAccountField } from './NewServiceAccountField';

interface ServiceAccountPickerProps {
  value: string | null;
  onChange: (serviceAccountId: string | null) => void;
  error?: string;
}

/**
 * "Acts as service account", shown only once a scope that changes data is ticked.
 *
 * Only active accounts are offered: the server refuses to bind a key to an inactive one, and the
 * dialog never offers what the API would refuse. All four states of the list are handled here
 * rather than by a boundary, because the field has to stay usable — an admin with no account
 * yet, or a list that failed, can still create one below.
 */
export function ServiceAccountPicker({ value, onChange, error }: ServiceAccountPickerProps) {
  const accounts = useServiceAccounts();
  const active = useMemo(
    () => (accounts.data ?? []).filter((account) => account.isActive),
    [accounts.data],
  );
  const isEmpty = accounts.data !== undefined && active.length === 0;

  return (
    <div className="flex flex-col gap-3 rounded-[--radius-control] border border-border p-3">
      <SelectField
        label={t.apiKeys.serviceAccount}
        required
        hint={isEmpty ? t.apiKeys.serviceAccountsNoneActive : t.apiKeys.serviceAccountHint}
        error={error}
        disabled={accounts.isPending}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">
          {accounts.isPending ? t.common.loading : t.apiKeys.serviceAccountPlaceholder}
        </option>
        {active.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </SelectField>

      {accounts.error ? (
        <div role="alert" className="flex items-center justify-between gap-2 text-xs text-danger">
          <span>{t.apiKeys.serviceAccountsLoadFailed}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void accounts.refetch()}
          >
            {t.common.retry}
          </Button>
        </div>
      ) : null}

      <NewServiceAccountField onCreated={(account) => onChange(account.id)} />
    </div>
  );
}
