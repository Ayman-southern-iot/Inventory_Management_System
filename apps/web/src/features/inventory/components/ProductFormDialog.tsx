import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  UNIT_SUGGESTIONS,
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type ProductDetail,
  type UpdateProductInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { Role } from '@ims/shared';
import { useAuth } from '@/features/auth/auth-context';
import { useCategoryTree, useCreateProduct, useUpdateProduct } from '../api';
import { CategoryPicker } from './CategoryPicker';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Undefined means create. */
  editing?: ProductDetail;
  /**
   * Called with the new product's id after a successful create (ask #2).
   *
   * A callback rather than a navigate baked in here, because one caller must NOT be sent
   * anywhere: `ReceiveToStockForm` creates a product from inside a receipt it is halfway
   * through, and navigating away would discard that work (plan D.3).
   */
  onCreated?: (productId: string) => void;
}

export function ProductFormDialog({ open, onClose, editing, onCreated }: Props) {
  const toast = useToast();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const categories = useCategoryTree();
  const isEditing = editing !== undefined;

  const { hasRole } = useAuth();
  const canManageCatalogue = hasRole(Role.INVENTORY_MANAGER, Role.ADMIN);

  const form = useForm<CreateProductInput>({
    resolver: zodResolver(isEditing ? (updateProductSchema as never) : createProductSchema),
    defaultValues: {
      name: '',
      categoryId: null,
      unit: 'pcs',
      defaultReturnable: true,
      description: null,
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      editing
        ? {
            name: editing.name,
            categoryId: editing.categoryId,
            unit: editing.unit,
            defaultReturnable: editing.defaultReturnable,
            description: editing.description,
          }
        : {
            name: '',
            // Nothing preselected. Category is optional, and defaulting to whichever node
            // happened to sort first is how products get filed somewhere arbitrary.
            categoryId: null,
            unit: 'pcs',
            defaultReturnable: true,
            description: null,
          },
    );
  }, [open, editing, form]);

  async function onSubmit(values: CreateProductInput) {
    try {
      if (isEditing) {
        const patch: UpdateProductInput = {
          name: values.name,
          categoryId: values.categoryId,
          unit: values.unit,
          defaultReturnable: values.defaultReturnable,
          description: values.description,
        };
        await updateProduct.mutateAsync({ id: editing.id, input: patch });
        toast.success(t.inventory.productUpdated);
      } else {
        const created = await createProduct.mutateAsync(values);
        toast.success(t.inventory.productCreated);
        onCreated?.(created.id);
      }
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog
      schema={isEditing ? (updateProductSchema as never) : createProductSchema}
      open={open}
      onClose={onClose}
      title={isEditing ? t.inventory.editProduct : t.inventory.newProduct}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button form="product-form" type="submit" isLoading={isSubmitting}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form
        id="product-form"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        {/*
          No Storage ID field. It was the product code wearing a borrowed label, and since
          migration 0034 'Storage ID' means a shelf slot. The code now generates itself
          (0036, ask #1); on an edit it is shown read-only so the IM can still read it off.
        */}
        {isEditing ? (
          <TextField label={t.inventory.productCode} value={editing.productCode} readOnly disabled />
        ) : null}
        <TextField
          label={t.inventory.name}
          error={errors.name?.message}
          {...form.register('name')}
        />
        <div className="flex flex-col gap-1.5">
          <CategoryPicker
            tree={categories.data ?? []}
            value={form.watch('categoryId') ?? null}
            onChange={(categoryId) => form.setValue('categoryId', categoryId)}
            canCreate={canManageCatalogue}
            error={errors.categoryId?.message}
          />
          <p className="text-xs text-ink-subtle">{t.inventory.categoryHint}</p>
        </div>
        <SelectField label={t.inventory.unit} error={errors.unit?.message} {...form.register('unit')}>
          {UNIT_SUGGESTIONS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </SelectField>
        <Checkbox label={t.inventory.defaultReturnable} {...form.register('defaultReturnable')} />
        <TextAreaField
          label={t.common.description}
          error={errors.description?.message}
          {...form.register('description')}
        />
      </form>
    </Dialog>
  );
}
