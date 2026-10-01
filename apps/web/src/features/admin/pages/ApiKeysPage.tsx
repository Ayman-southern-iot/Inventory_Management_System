import { useMemo, useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import {
  PAGINATION_DEFAULT_LIMIT,
  type ApiKey,
  type ListApiKeysQuery,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Field';
import { PageHeader, Pagination, Panel } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useApiKeyUsage, useApiKeys, useSetApiKeyActive } from '../api';
import { ApiKeyCreatedPanel } from '../components/ApiKeyCreatedPanel';
import { ApiKeyUsageDialog } from '../components/ApiKeyUsageDialog';
import { ApiKeysAvailability } from '../components/ApiKeysAvailability';
import { API_KEYS_TABLE_COLUMNS, ApiKeysTable } from '../components/ApiKeysTable';
import { CreateApiKeyDialog } from '../components/CreateApiKeyDialog';
import { RevokeApiKeyDialog } from '../components/RevokeApiKeyDialog';
import { ServiceAccountsPanel } from '../components/ServiceAccountsPanel';

export function ApiKeysPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | undefined>(undefined);
  /**
   * The freshly minted token, held only until the admin dismisses the panel. Never written to
   * state that outlives the page, never logged — there is nowhere to read it back from.
   */
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const query = useMemo<ListApiKeysQuery>(
    () => ({ page, limit: PAGINATION_DEFAULT_LIMIT, includeRevoked }),
    [page, includeRevoked],
  );

  const keys = useApiKeys(query);
  const usage = useApiKeyUsage();
  const setActive = useSetApiKeyActive();

  /*
   * The usage document is what says whether keys may be issued at all (demo mode) and how long
   * a write key may live, so issuing waits for it. In demo mode the button is not offered, since
   * the server would refuse whatever it produced.
   */
  const isDisabledInDemo = usage.data?.keysDisabledInDemo === true;

  async function toggleActive(key: ApiKey) {
    try {
      await setActive.mutateAsync({ id: key.id, isActive: !key.isActive });
      toast.success(key.isActive ? t.apiKeys.wasDisabled : t.apiKeys.enabled);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <>
      <PageHeader
        title={t.apiKeys.title}
        subtitle={t.apiKeys.subtitle}
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              icon={<BookOpen aria-hidden className="size-4" />}
              onClick={() => setUsageOpen(true)}
            >
              {t.apiKeys.usageTitle}
            </Button>
            {isDisabledInDemo ? null : (
              <Button
                icon={<Plus aria-hidden className="size-4" />}
                disabled={usage.data === undefined}
                onClick={() => setCreateOpen(true)}
              >
                {t.apiKeys.newKey}
              </Button>
            )}
          </div>
        }
      />

      <ApiKeysAvailability
        isDisabledInDemo={isDisabledInDemo}
        loadError={usage.error}
        onRetry={() => void usage.refetch()}
      />

      <Panel>
        <div className="border-b border-border px-4 py-3">
          <Checkbox
            label={t.apiKeys.showRevoked}
            checked={includeRevoked}
            onChange={(event) => {
              setIncludeRevoked(event.target.checked);
              setPage(1);
            }}
          />
        </div>

        <QueryBoundary
          isLoading={keys.isPending}
          error={keys.error}
          data={keys.data}
          onRetry={() => void keys.refetch()}
          loadingFallback={<SkeletonRows columns={API_KEYS_TABLE_COLUMNS} />}
          isEmpty={(data) => data.items.length === 0}
          emptyFallback={<EmptyState title={t.apiKeys.emptyTitle} body={t.apiKeys.emptyBody} />}
        >
          {(data) => (
            <>
              <ApiKeysTable
                keys={data.items}
                onToggleActive={(key) => void toggleActive(key)}
                onRevoke={setRevoking}
              />
              <Pagination
                page={data.page}
                limit={data.limit}
                total={data.total}
                onPageChange={setPage}
              />
            </>
          )}
        </QueryBoundary>
      </Panel>

      <ServiceAccountsPanel canCreateAccount={usage.data !== undefined && !isDisabledInDemo} />

      {usage.data && !isDisabledInDemo ? (
        <CreateApiKeyDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onIssued={setIssuedToken}
          writeKeyMaxLifetimeDays={usage.data.writeKeyMaxLifetimeDays}
        />
      ) : null}

      {issuedToken ? (
        <ApiKeyCreatedPanel token={issuedToken} onClose={() => setIssuedToken(null)} />
      ) : null}

      <ApiKeyUsageDialog open={usageOpen} onClose={() => setUsageOpen(false)} />

      <RevokeApiKeyDialog apiKey={revoking} onClose={() => setRevoking(undefined)} />
    </>
  );
}
