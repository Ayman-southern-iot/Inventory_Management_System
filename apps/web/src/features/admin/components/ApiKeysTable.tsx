import { Power, Trash2 } from 'lucide-react';
import type { ApiKey } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Badge, Table } from '@/components/ui/primitives';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';

/** Column count, for the loading skeleton that stands in for this table. */
export const API_KEYS_TABLE_COLUMNS = 7;

interface ApiKeysTableProps {
  keys: readonly ApiKey[];
  onToggleActive: (key: ApiKey) => void;
  onRevoke: (key: ApiKey) => void;
}

export function ApiKeysTable({ keys, onToggleActive, onRevoke }: ApiKeysTableProps) {
  return (
    <Table
      headers={[
        t.apiKeys.name,
        t.apiKeys.prefix,
        t.apiKeys.status,
        t.apiKeys.serviceAccountColumn,
        t.apiKeys.lastUsed,
        t.apiKeys.createdBy,
        '',
      ]}
    >
      {keys.map((key) => (
        <tr key={key.id} className="hover:bg-surface-muted/50">
          <td className="px-4 py-2.5">
            <p className="font-medium text-ink">{key.name}</p>
            <p className="text-xs text-ink-subtle">
              {key.scopes.join(', ')}
              {key.expiresAt ? ` · ${formatDateTime(key.expiresAt)}` : ''}
            </p>
          </td>
          <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">{key.keyPrefix}…</td>
          <td className="px-4 py-2.5">
            <StatusBadge apiKey={key} />
          </td>
          {/* An unbound key is a read-only key with no principal at all (K4). */}
          <td className="px-4 py-2.5 text-xs text-ink-muted">
            {key.serviceAccountName ?? t.common.none}
          </td>
          <td className="px-4 py-2.5 text-xs text-ink-muted">
            {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : t.apiKeys.neverUsed}
          </td>
          <td className="px-4 py-2.5 text-xs text-ink-muted">{key.createdByName}</td>
          <td className="px-4 py-2.5">
            <div className="flex justify-end gap-1">
              {/* A revoked key has no actions — it is history, not a control. */}
              {key.revokedAt === null ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${key.isActive ? t.apiKeys.disable : t.apiKeys.enable} ${key.name}`}
                    icon={<Power aria-hidden className="size-4" />}
                    onClick={() => onToggleActive(key)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t.apiKeys.revoke} ${key.name}`}
                    icon={<Trash2 aria-hidden className="size-4" />}
                    onClick={() => onRevoke(key)}
                  />
                </>
              ) : null}
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );
}

/**
 * Five states, and they are not independent: revoked outranks everything, and expiry outranks
 * the enabled flag because a key past its date is refused whatever the toggle says.
 *
 * Blocked sits under the key's own Disabled: a key switched off by itself stays described by
 * its own flag, and "blocked" is reserved for a key that is fine in itself but refused because
 * its service account is deactivated (ADR-0002, 403 API_KEY_DISABLED). The reason is written
 * out under the badge rather than in a `title` tooltip, which keyboard and screen-reader users
 * never see.
 */
function StatusBadge({ apiKey }: { apiKey: ApiKey }) {
  if (apiKey.revokedAt !== null) return <Badge tone="danger">{t.apiKeys.revoked}</Badge>;
  if (apiKey.isExpired) return <Badge tone="danger">{t.apiKeys.expired}</Badge>;
  // `pending`, not `danger`: disabled is a pause an admin can undo, unlike revoked or expired.
  if (!apiKey.isActive) return <Badge tone="pending">{t.apiKeys.disabled}</Badge>;
  if (apiKey.serviceAccountIsActive === false) {
    // `pending` too: activating the account undoes it.
    return (
      <>
        <Badge tone="pending">{t.apiKeys.blocked}</Badge>
        <p className="mt-0.5 text-xs text-ink-subtle">{t.apiKeys.blockedByServiceAccount}</p>
      </>
    );
  }
  return <Badge tone="success">{t.apiKeys.active}</Badge>;
}
