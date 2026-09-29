import { useState } from 'react';
import type { ServiceAccount } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useServiceAccounts, useSetServiceAccountActive } from '../api';

/**
 * The accounts keys that change data act as (ADR-0002), managed here rather than on the Users
 * screen, which is built for people.
 *
 * Deactivating is the kill switch for every key bound to the account at once, so it sits behind
 * the same in-app confirm as revoking a key. Activating is not confirmed: it undoes a pause.
 */
export function ServiceAccountsPanel() {
  const toast = useToast();
  const accounts = useServiceAccounts();
  const setActive = useSetServiceAccountActive();
  const [deactivating, setDeactivating] = useState<ServiceAccount | undefined>(undefined);

  async function apply(account: ServiceAccount, isActive: boolean) {
    try {
      await setActive.mutateAsync({ id: account.id, isActive });
      toast.success(
        isActive ? t.apiKeys.serviceAccountActivated : t.apiKeys.serviceAccountDeactivated,
      );
      setDeactivating(undefined);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <Panel className="mt-6">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{t.apiKeys.serviceAccountsTitle}</h2>
        <p className="mt-0.5 text-xs text-ink-muted">{t.apiKeys.serviceAccountsBody}</p>
      </header>

      <QueryBoundary
        isLoading={accounts.isPending}
        error={accounts.error}
        data={accounts.data}
        onRetry={() => void accounts.refetch()}
        loadingFallback={<SkeletonRows columns={4} rows={2} />}
        isEmpty={(data) => data.length === 0}
        emptyFallback={
          <EmptyState
            title={t.apiKeys.serviceAccountsEmptyTitle}
            body={t.apiKeys.serviceAccountsEmptyBody}
          />
        }
      >
        {(data) => (
          <Table
            headers={[t.apiKeys.name, t.apiKeys.status, t.apiKeys.activeKeys, '']}
            headerAligns={['start', 'start', 'end', 'start']}
          >
            {data.map((account) => (
              <tr key={account.id} className="hover:bg-surface-muted/50">
                <td className="px-4 py-2.5 font-medium text-ink">{account.name}</td>
                <td className="px-4 py-2.5">
                  {/* `pending`, as for a disabled key: a pause an admin can undo. */}
                  <Badge tone={account.isActive ? 'success' : 'pending'}>
                    {account.isActive ? t.common.active : t.common.inactive}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                  {account.activeKeyCount}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${account.isActive ? t.apiKeys.deactivate : t.apiKeys.activate} ${account.name}`}
                      disabled={setActive.isPending}
                      onClick={() =>
                        account.isActive ? setDeactivating(account) : void apply(account, true)
                      }
                    >
                      {account.isActive ? t.apiKeys.deactivate : t.apiKeys.activate}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </QueryBoundary>

      <Dialog
        open={deactivating !== undefined}
        onClose={() => setDeactivating(undefined)}
        title={t.apiKeys.deactivateConfirmTitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeactivating(undefined)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="danger"
              isLoading={setActive.isPending}
              onClick={() => (deactivating ? void apply(deactivating, false) : undefined)}
            >
              {t.apiKeys.deactivate}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          {t.apiKeys.deactivateConfirmBody
            .replace('{name}', deactivating?.name ?? '')
            .replace('{n}', String(deactivating?.activeKeyCount ?? 0))}
        </p>
      </Dialog>
    </Panel>
  );
}
