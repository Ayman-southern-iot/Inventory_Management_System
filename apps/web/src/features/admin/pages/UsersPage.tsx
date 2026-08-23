import { useMemo, useState } from 'react';
import { KeyRound, Pencil, Plus, Power } from 'lucide-react';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  Role,
  type ListUsersQuery,
  type User,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Checkbox, TextField } from '@/components/ui/Field';
import { Badge, Pagination, Panel, PageHeader, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useDepartments, useSetUserActive, useUsers } from '../api';
import { UserFormDialog } from '../components/UserFormDialog';
import { ResetPasswordDialog } from '../components/ResetPasswordDialog';

/** Exported for `api/list-queries.contract.test.ts`, which parses it through its schema. */
export const ALL_DEPARTMENTS_QUERY = {
  page: 1,
  limit: PAGINATION_MAX_LIMIT,
  includeInactive: false,
} as const;

export function UsersPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<User | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [resettingFor, setResettingFor] = useState<User | undefined>(undefined);

  const query = useMemo<ListUsersQuery>(
    () => ({
      page,
      limit: PAGINATION_DEFAULT_LIMIT,
      includeInactive,
      ...(search.trim() ? { search: search.trim() } : {}),
    }),
    [page, includeInactive, search],
  );

  const users = useUsers(query);
  const departments = useDepartments(ALL_DEPARTMENTS_QUERY);
  const setActive = useSetUserActive();

  async function toggleActive(user: User) {
    try {
      await setActive.mutateAsync({ id: user.id, isActive: !user.isActive });
      toast.success(user.isActive ? t.users.deactivated : t.users.activated);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }

  function openEdit(user: User) {
    setEditing(user);
    setFormOpen(true);
  }

  return (
    <>
      <PageHeader
        title={t.users.title}
        subtitle={t.users.subtitle}
        action={
          <Button icon={<Plus aria-hidden className="size-4" />} onClick={openCreate}>
            {t.users.newUser}
          </Button>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-4 border-b border-border px-4 py-3">
          <div className="min-w-56 flex-1">
            <TextField
              label={t.common.search}
              placeholder={t.users.searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="pb-2.5">
            <Checkbox
              label={t.users.showInactive}
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                setPage(1);
              }}
            />
          </div>
        </div>

        <QueryBoundary
          isLoading={users.isPending}
          error={users.error}
          data={users.data}
          onRetry={() => void users.refetch()}
          loadingFallback={<SkeletonRows columns={5} />}
          isEmpty={(data) => data.items.length === 0}
          emptyFallback={<EmptyState title={t.users.emptyTitle} />}
        >
          {(data) => (
            <>
              <Table
                headers={[
                  t.users.fullName,
                  t.users.designation,
                  t.users.department,
                  t.users.roles,
                  t.users.status,
                  '',
                ]}
              >
                {data.items.map((user) => (
                  <tr key={user.id} className="hover:bg-surface-muted/50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{user.fullName}</p>
                      <p className="text-xs text-ink-subtle">{user.email}</p>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{user.designation}</td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {user.departmentName ?? t.common.none}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((role) => (
                          <Badge key={role} tone={role === Role.ADMIN ? 'info' : 'neutral'}>
                            {t.roles[role]}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={user.isActive ? 'success' : 'danger'}>
                        {user.isActive ? t.common.active : t.common.inactive}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${t.common.edit} ${user.fullName}`}
                          icon={<Pencil aria-hidden className="size-4" />}
                          onClick={() => openEdit(user)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${t.users.resetPassword} ${user.fullName}`}
                          icon={<KeyRound aria-hidden className="size-4" />}
                          onClick={() => setResettingFor(user)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${user.isActive ? t.users.deactivate : t.users.activate} ${user.fullName}`}
                          icon={<Power aria-hidden className="size-4" />}
                          onClick={() => void toggleActive(user)}
                        />
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

      <UserFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        departments={departments.data?.items ?? []}
        editing={editing}
      />
      <ResetPasswordDialog
        user={resettingFor}
        onClose={() => setResettingFor(undefined)}
      />
    </>
  );
}
