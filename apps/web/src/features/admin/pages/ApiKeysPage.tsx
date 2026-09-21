import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Power, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  API_KEY_EXPIRY_PRESET_DAYS,
  ApiKeyScope,
  PAGINATION_DEFAULT_LIMIT,
  createApiKeySchema,
  type ApiKey,
  type CreateApiKeyInput,
  type ListApiKeysQuery,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, SelectField, TextField } from '@/components/ui/Field';
import { Badge, PageHeader, Pagination, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';
import { messageForError } from '@/lib/error-message';
import {
  useApiKeyUsage,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useSetApiKeyActive,
} from '../api';
import { ApiKeyCreatedPanel } from '../components/ApiKeyCreatedPanel';
import { ApiKeyUsagePanel } from '../components/ApiKeyUsagePanel';

/** `null` is a real choice here, so the select carries a sentinel rather than an empty value. */
const NEVER = 'never';

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
  const createKey = useCreateApiKey();
  const setActive = useSetApiKeyActive();
  const revokeKey = useRevokeApiKey();

  const form = useForm<CreateApiKeyInput>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: { name: '', scopes: [ApiKeyScope.INVENTORY_READ], expiresInDays: 90 },
  });

  useEffect(() => {
    if (createOpen) {
      form.reset({ name: '', scopes: [ApiKeyScope.INVENTORY_READ], expiresInDays: 90 });
    }
  }, [createOpen, form]);

  async function onCreate(values: CreateApiKeyInput) {
    try {
      const created = await createKey.mutateAsync(values);
      toast.success(t.apiKeys.created);
      setCreateOpen(false);
      // Straight into the one-time reveal — there is no second chance to show this.
      setIssuedToken(created.token);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  async function toggleActive(key: ApiKey) {
    try {
      await setActive.mutateAsync({ id: key.id, isActive: !key.isActive });
      toast.success(key.isActive ? t.apiKeys.wasDisabled : t.apiKeys.enabled);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  async function confirmRevoke() {
    if (!revoking) return;
    try {
      await revokeKey.mutateAsync(revoking.id);
      toast.success(t.apiKeys.wasRevoked);
      setRevoking(undefined);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const expiresInDays = form.watch('expiresInDays');

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
            <Button
              icon={<Plus aria-hidden className="size-4" />}
              onClick={() => setCreateOpen(true)}
            >
              {t.apiKeys.newKey}
            </Button>
          </div>
        }
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
          loadingFallback={<SkeletonRows columns={6} />}
          isEmpty={(data) => data.items.length === 0}
          emptyFallback={<EmptyState title={t.apiKeys.emptyTitle} body={t.apiKeys.emptyBody} />}
        >
          {(data) => (
            <>
              <Table
                headers={[
                  t.apiKeys.name,
                  t.apiKeys.prefix,
                  t.apiKeys.status,
                  t.apiKeys.lastUsed,
                  t.apiKeys.createdBy,
                  '',
                ]}
              >
                {data.items.map((key) => (
                  <tr key={key.id} className="hover:bg-surface-muted/50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{key.name}</p>
                      <p className="text-xs text-ink-subtle">
                        {key.scopes.join(', ')}
                        {key.expiresAt ? ` · ${formatDateTime(key.expiresAt)}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">
                      {key.keyPrefix}…
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge apiKey={key} />
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
                              onClick={() => void toggleActive(key)}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`${t.apiKeys.revoke} ${key.name}`}
                              icon={<Trash2 aria-hidden className="size-4" />}
                              onClick={() => setRevoking(key)}
                            />
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
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

      <Dialog
        schema={createApiKeySchema}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t.apiKeys.createTitle}
        subtitle={t.apiKeys.createSubtitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              isLoading={form.formState.isSubmitting}
              onClick={() => void form.handleSubmit(onCreate)()}
            >
              {t.apiKeys.issue}
            </Button>
          </>
        }
      >
        <form
          noValidate
          onSubmit={form.handleSubmit(onCreate)}
          className="flex flex-col gap-4"
        >
          <TextField
            label={t.apiKeys.name}
            placeholder={t.apiKeys.namePlaceholder}
            hint={t.apiKeys.nameHint}
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />

          {/*
            One scope today, so this renders as a fixed statement of what the key gets rather
            than a checkbox with nothing to choose between. It becomes a real choice the moment
            a second member joins the enum.
          */}
          <fieldset className="rounded-[--radius-control] border border-border p-3">
            <legend className="px-1 text-sm font-medium text-ink">{t.apiKeys.scopes}</legend>
            <p className="text-sm text-ink">{t.apiKeys.scopeInventoryRead}</p>
            <p className="mt-0.5 text-xs text-ink-subtle">{t.apiKeys.scopeInventoryReadHint}</p>
          </fieldset>

          <SelectField
            label={t.apiKeys.expiry}
            hint={t.apiKeys.expiryHint}
            value={expiresInDays === null ? NEVER : String(expiresInDays)}
            onChange={(event) =>
              form.setValue(
                'expiresInDays',
                event.target.value === NEVER ? null : Number(event.target.value),
              )
            }
          >
            {API_KEY_EXPIRY_PRESET_DAYS.map((days) => (
              <option key={days} value={String(days)}>
                {t.apiKeys.expiryDays.replace('{n}', String(days))}
              </option>
            ))}
            <option value={NEVER}>{t.apiKeys.expiryNever}</option>
          </SelectField>
        </form>
      </Dialog>

      {issuedToken ? (
        <ApiKeyCreatedPanel token={issuedToken} onClose={() => setIssuedToken(null)} />
      ) : null}

      <Dialog
        open={usageOpen}
        onClose={() => setUsageOpen(false)}
        size="lg"
        title={t.apiKeys.usageTitle}
        footer={<Button onClick={() => setUsageOpen(false)}>{t.common.close}</Button>}
      >
        <QueryBoundary
          isLoading={usage.isPending}
          error={usage.error}
          data={usage.data}
          onRetry={() => void usage.refetch()}
          loadingFallback={<SkeletonRows columns={1} />}
        >
          {(data) => <ApiKeyUsagePanel usage={data} />}
        </QueryBoundary>
      </Dialog>

      <Dialog
        open={revoking !== undefined}
        onClose={() => setRevoking(undefined)}
        title={t.apiKeys.revokeConfirmTitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevoking(undefined)}>
              {t.common.cancel}
            </Button>
            <Button variant="danger" onClick={() => void confirmRevoke()}>
              {t.apiKeys.revoke}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">{t.apiKeys.revokeConfirmBody}</p>
      </Dialog>
    </>
  );
}

/**
 * Four states, and they are not independent: revoked outranks everything, and expiry outranks
 * the enabled flag because a key past its date is refused whatever the toggle says.
 */
function StatusBadge({ apiKey }: { apiKey: ApiKey }) {
  if (apiKey.revokedAt !== null) return <Badge tone="danger">{t.apiKeys.revoked}</Badge>;
  if (apiKey.isExpired) return <Badge tone="danger">{t.apiKeys.expired}</Badge>;
  // `pending`, not `danger`: disabled is a pause an admin can undo, unlike revoked or expired.
  if (!apiKey.isActive) return <Badge tone="pending">{t.apiKeys.disabled}</Badge>;
  return <Badge tone="success">{t.apiKeys.active}</Badge>;
}
