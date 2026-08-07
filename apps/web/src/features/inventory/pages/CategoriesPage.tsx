import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createCategorySchema, type Category, type CreateCategoryInput } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, SelectField, TextField } from '@/components/ui/Field';
import { Badge, PageHeader, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useCategoryTree, useCreateCategory, useUpdateCategory } from '../api';
import { flattenCategoryTree, indentFor } from '../category-tree';

export function CategoriesPage() {
  const toast = useToast();
  const categories = useCategoryTree();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | undefined>(undefined);

  const flat = useMemo(() => flattenCategoryTree(categories.data ?? []), [categories.data]);

  const form = useForm<CreateCategoryInput>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: { name: '', parentId: null, isTrackable: true },
  });

  useEffect(() => {
    if (!dialogOpen) return;
    form.reset(
      editing
        ? { name: editing.name, parentId: editing.parentId, isTrackable: editing.isTrackable }
        : { name: '', parentId: null, isTrackable: true },
    );
  }, [dialogOpen, editing, form]);

  async function onSubmit(values: CreateCategoryInput) {
    try {
      if (editing) {
        // `parentId` is deliberately not updatable — re-parenting a tree needs cycle handling
        // that this hand-maintained list does not justify.
        await updateCategory.mutateAsync({
          id: editing.id,
          input: { name: values.name, isTrackable: values.isTrackable },
        });
        toast.success(t.categories.updated);
      } else {
        await createCategory.mutateAsync(values);
        toast.success(t.categories.created);
      }
      setDialogOpen(false);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  async function toggleActive(category: Category) {
    try {
      await updateCategory.mutateAsync({ id: category.id, input: { isActive: !category.isActive } });
      toast.success(t.categories.updated);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <>
      <PageHeader
        title={t.categories.title}
        subtitle={t.categories.subtitle}
        action={
          <Button
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            {t.categories.newCategory}
          </Button>
        }
      />

      <Panel>
        <QueryBoundary
          isLoading={categories.isPending}
          error={categories.error}
          data={flat}
          onRetry={() => void categories.refetch()}
          loadingFallback={<SkeletonRows columns={4} />}
          isEmpty={(rows) => rows.length === 0}
          emptyFallback={
            <EmptyState title={t.categories.emptyTitle} body={t.categories.emptyBody} />
          }
        >
          {(rows) => (
            <Table
              headers={[t.categories.name, t.categories.products, t.users.status, '']}
            >
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-muted/50">
                  <td className="px-4 py-2.5 font-medium text-ink">
                    <span className="whitespace-pre">{indentFor(row.depth)}</span>
                    {row.name}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{row.productCount}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <Badge tone={row.isActive ? 'success' : 'danger'}>
                        {row.isActive ? t.common.active : t.common.inactive}
                      </Badge>
                      {row.isTrackable ? (
                        <Badge tone="info">{t.categories.trackable}</Badge>
                      ) : (
                        <Badge tone="neutral">{t.inventory.notTracked}</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${t.common.edit} ${row.name}`}
                        icon={<Pencil aria-hidden className="size-4" />}
                        onClick={() => {
                          setEditing(row);
                          setDialogOpen(true);
                        }}
                      />
                      <Button variant="ghost" size="sm" onClick={() => void toggleActive(row)}>
                        {row.isActive ? t.users.deactivate : t.users.activate}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </QueryBoundary>
      </Panel>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? t.categories.editCategory : t.categories.newCategory}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button form="category-form" type="submit" isLoading={form.formState.isSubmitting}>
              {t.common.save}
            </Button>
          </>
        }
      >
        <form
          id="category-form"
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <TextField
            label={t.categories.name}
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          {editing ? null : (
            <SelectField label={t.categories.parent} {...form.register('parentId')}>
              <option value="">{t.categories.noParent}</option>
              {flat.map((row) => (
                <option key={row.id} value={row.id}>
                  {indentFor(row.depth)}
                  {row.name}
                </option>
              ))}
            </SelectField>
          )}
          <Checkbox
            label={t.categories.trackable}
            {...form.register('isTrackable')}
          />
          <p className="text-xs text-ink-subtle">{t.categories.trackableHint}</p>
        </form>
      </Dialog>
    </>
  );
}
