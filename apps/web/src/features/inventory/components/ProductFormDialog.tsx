import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Role,
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

/** The empty form. One definition, so "reset after save" and "open fresh" cannot drift. */
const BLANK: CreateProductInput = {
  name: '',
  categoryId: null,
  unit: 'pcs',
  defaultReturnable: true,
  description: null,
};

export function ProductFormDialog({ open, onClose, editing, onCreated }: Props) {
  const toast = useToast();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const categories = useCategoryTree();
  const isEditing = editing !== undefined;

  const { hasRole } = useAuth();
  const canManageCatalogue = hasRole(Role.INVENTORY_MANAGER, Role.ADMIN);

  /**
   * Keeps the dialog open and blanks the form after a save.
   *
   * Products arrive in batches — a delivery of eleven different parts is eleven trips through
   * this form, and closing it each time costs a click and loses the IM's place. Deliberately
   * not offered while editing: "edit another" is not a thing.
   */
  const [addAnother, setAddAnother] = useState(false);

  const form = useForm<CreateProductInput>({
    resolver: zodResolver(isEditing ? (updateProductSchema as never) : createProductSchema),
    defaultValues: BLANK,
  });

  useEffect(() => {
    if (!open) return;
    setAddAnother(false);
    form.reset(
      editing
        ? {
            name: editing.name,
            categoryId: editing.categoryId,
            unit: editing.unit,
            defaultReturnable: editing.defaultReturnable,
            description: editing.description,
          }
        : BLANK,
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
        onClose();
        return;
      }

      const created = await createProduct.mutateAsync(values);
      toast.success(t.inventory.productCreated);

      if (addAnother) {
        /**
         * Keep the classification. In a batch the next product is nearly always a sibling of
         * the last one, and re-picking three levels per row is the friction this exists to
         * remove. The name and description are cleared, because those never repeat.
         */
        form.reset({ ...BLANK, categoryId: values.categoryId, unit: values.unit });
        form.setFocus('name');
        return;
      }

      onCreated?.(created.id);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog
      schema={isEditing ? (updateProductSchema as never) : createProductSchema}
      size="lg"
      open={open}
      onClose={onClose}
      title={isEditing ? t.inventory.editProduct : t.inventory.newProduct}
      subtitle={t.common.requiredFieldsNote}
      footerStart={
        isEditing ? undefined : (
          <Checkbox
            label={t.inventory.saveAndAddAnother}
            checked={addAnother}
            onChange={(event) => setAddAnother(event.target.checked)}
          />
        )
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button form="product-form" type="submit" isLoading={isSubmitting}>
            {isEditing ? t.common.save : t.inventory.saveProduct}
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

        {/* Name and unit share a row: the unit is a two-word answer and a full-width select
            for it pushes everything below the fold. */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-48 flex-1">
            <TextField
              label={t.inventory.name}
              error={errors.name?.message}
              {...form.register('name')}
            />
          </div>
          <div className="w-32">
            <SelectField
              label={t.inventory.unit}
              // Always carries a value, so zod sees a default and not a requirement — but the
              // IM cannot leave it blank, and an unmarked field beside a marked one reads as
              // optional.
              required
              error={errors.unit?.message}
              {...form.register('unit')}
            >
              {UNIT_SUGGESTIONS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </SelectField>
          </div>
        </div>

        <CategoryPicker
          tree={categories.data ?? []}
          value={form.watch('categoryId') ?? null}
          onChange={(categoryId) => form.setValue('categoryId', categoryId)}
          canCreate={canManageCatalogue}
          error={errors.categoryId?.message}
        />

        <TextAreaField
          label={t.common.description}
          placeholder={t.inventory.descriptionPlaceholder}
          error={errors.description?.message}
          {...form.register('description')}
        />

        {/* Boxed, because it is a policy that outlives this form — every future borrow of this
            product inherits it — and a bare checkbox in a column of fields reads as an
            afterthought. */}
        <div className="rounded-[--radius-control] border border-border p-3">
          <Checkbox label={t.inventory.defaultReturnable} {...form.register('defaultReturnable')} />
          <p className="mt-1 pl-6 text-xs text-ink-subtle">{t.inventory.defaultReturnableHint}</p>
        </div>
      </form>
    </Dialog>
  );
}
