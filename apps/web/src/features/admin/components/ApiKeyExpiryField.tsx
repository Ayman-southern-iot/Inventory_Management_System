import { SelectField } from '@/components/ui/Field';
import { t } from '@/i18n/en';
import { expiryOptions } from './api-key-expiry';

/** `null` is a real choice here, so the select carries a sentinel rather than an empty value. */
const NEVER = 'never';

interface ApiKeyExpiryFieldProps {
  /** Days, or null for a key that never expires. */
  value: number | null;
  onChange: (days: number | null) => void;
  /** Any write scope ticked: no "Never", and nothing past the ceiling. */
  isWrite: boolean;
  /** From the usage document: the longest a key that can change data may live (OQ-KT3). */
  writeKeyMaxLifetimeDays: number;
  error?: string;
}

export function ApiKeyExpiryField({
  value,
  onChange,
  isWrite,
  writeKeyMaxLifetimeDays,
  error,
}: ApiKeyExpiryFieldProps) {
  const maxDays = String(writeKeyMaxLifetimeDays);

  return (
    <SelectField
      label={t.apiKeys.expiry}
      required={isWrite}
      hint={isWrite ? t.apiKeys.expiryWriteHint.replace('{n}', maxDays) : t.apiKeys.expiryHint}
      error={error}
      value={value === null ? NEVER : String(value)}
      onChange={(event) =>
        onChange(event.target.value === NEVER ? null : Number(event.target.value))
      }
    >
      {expiryOptions(isWrite, writeKeyMaxLifetimeDays).map((days) => (
        <option key={days} value={String(days)}>
          {t.apiKeys.expiryDays.replace('{n}', String(days))}
        </option>
      ))}
      {/* Forever is for read-only keys only (OQ-KT3); the server refuses it for a write. */}
      {isWrite ? null : <option value={NEVER}>{t.apiKeys.expiryNever}</option>}
    </SelectField>
  );
}
