import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Power } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PAGINATION_DEFAULT_LIMIT,
  createDepartmentSchema,
  type CreateDepartmentInput,
  type Department,
  type ListDepartmentsQuery,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, TextField } from '@/components/ui/Field';
import { Badge, PageHeader, Pagination, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useCreateDepartment, useDepartments, useUpdateDepartment } from '../api';

export function DepartmentsPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<Department | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);

  const query = useMemo<ListDepartmentsQuery>(
    () => ({ page, limit: PAGINATION_DEFAULT_LIMIT, includeInactive }),
    [page, includeInactive],
  );

  const departments = useDepartments(query);
  const createDepartment = useCreateDepartment();
  const updateDepartment = useUpdateDepartment();

  const form = useForm<CreateDepartmentInput>({
    resolver: zodResolver(createDepartmentSchema),
    defaultValues: { name: '' },
  });

  useEffect(() => {
    if (dialogOpen) form.reset({ name: editing?.name ?? '' });
  }, [dialogOpen, editing, form]);

  async function onSubmit(values: CreateDepartmentInput) {
    try {
      if (editing) {
        await updateDepartment.mutateAsync({ id: editing.id, input: { name: values.name } });
        toast.success(t.departments.updated);
      } else {
        await createDepartment.mutateAsync(values);
        toast.success(t.departments.created);
      }
      setDialogOpen(false);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  async function toggleActive(department: Department) {
    try {
      await updateDepartment.mutateAsync({
        id: department.id,
        input: { isActive: !department.isActive },
      });
      toast.success(t.departments.updated);
    } catch (error) {
      // The API refuses to deactivate a department that still holds users; surface that reason.
      toast.error(messageForError(error));
    }
  }

  return (
    <>
      <PageHeader
        title={t.departments.title}
        subtitle={t.departments.subtitle}
        action={
          <Button
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            {t.departments.newDepartment}
          </Button>
        }
      />

      <Panel>
        <div className="border-b border-border px-4 py-3">
          <Checkbox
            label={t.users.showInactive}
            checked={includeInactive}
            onChange={(event) => {
              setIncludeInactive(event.target.checked);
              setPage(1);
            }}
          />
        </div>

        <QueryBoundary
          isLoading={departments.isPending}
          error={departments.error}
          data={departments.data}
          onRetry={() => void departments.refetch()}
          loadingFallback={<SkeletonRows columns={4} />}
          isEmpty={(data) => data.items.length === 0}
          emptyFallback={
            <EmptyState title={t.departments.emptyTitle} body={t.departments.emptyBody} />
          }
        >
          {(data) => (
            <>
              <Table
                headers={[t.departments.name, t.departments.members, t.users.status, '']}
              >
                {data.items.map((department) => (
                  <tr key={department.id} className="hover:bg-surface-muted/50">
                    <td className="px-4 py-2.5 font-medium text-ink">{department.name}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{department.userCount}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={department.isActive ? 'success' : 'danger'}>
                        {department.isActive ? t.common.active : t.common.inactive}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${t.common.edit} ${department.name}`}
                          icon={<Pencil aria-hidden className="size-4" />}
                          onClick={() => {
                            setEditing(department);
                            setDialogOpen(true);
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${department.isActive ? t.users.deactivate : t.users.activate} ${department.name}`}
                          icon={<Power aria-hidden className="size-4" />}
                          onClick={() => void toggleActive(department)}
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

      <Dialog
      schema={createDepartmentSchema}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? t.departments.editDepartment : t.departments.newDepartment}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              form="department-form"
              type="submit"
              isLoading={form.formState.isSubmitting}
            >
              {t.common.save}
            </Button>
          </>
        }
      >
        <form id="department-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <TextField
            label={t.departments.name}
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
        </form>
      </Dialog>
    </>
  );
}
