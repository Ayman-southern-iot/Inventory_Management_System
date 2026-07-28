import { useEffect, useMemo } from 'react';
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
import { useCategoryTree, useCreateProduct, useUpdateProduct } from '../api';
import { indentFor, selectableCategories } from '../category-tree';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Undefined means create. */
  editing?: ProductDetail;
}

export function ProductFormDialog({ open, onClose, editing }: Props) {
  const toast = useToast();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const categories = useCategoryTree();
  const isEditing = editing !== undefined;

  // Only trackable categories are offered for a new product; an untracked one would produce a
  // catalogue entry that can never hold stock, which is almost never what the IM meant.
  const options = useMemo(() => selectableCategories(categories.data ?? []), [categories.data]);

  const form = useForm<CreateProductInput>({
    resolver: zodResolver(isEditing ? (updateProductSchema as never) : createProductSchema),
    defaultValues: {
      productCode: '',
      name: '',
      categoryId: '',
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
            productCode: editing.productCode,
            name: editing.name,
            categoryId: editing.categoryId,
            unit: editing.unit,
            defaultReturnable: editing.defaultReturnable,
            description: editing.description,
          }
        : {
            productCode: '',
            name: '',
            categoryId: options[0]?.id ?? '',
            unit: 'pcs',
            defaultReturnable: true,
            description: null,
          },
    );
  }, [open, editing, options, form]);

  async function onSubmit(values: CreateProductInput) {
    try {
      if (isEditing) {
        const patch: UpdateProductInput = {
          productCode: values.productCode,
          name: values.name,
          categoryId: values.categoryId,
          unit: values.unit,
          defaultReturnable: values.defaultReturnable,
          description: values.description,
        };
        await updateProduct.mutateAsync({ id: editing.id, input: patch });
        toast.success(t.inventory.productUpdated);
      } else {
        await createProduct.mutateAsync(values);
        toast.success(t.inventory.productCreated);
      }
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog
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
        <TextField
          label={t.inventory.productCode}
          error={errors.productCode?.message}
          {...form.register('productCode')}
        />
        <TextField
          label={t.inventory.name}
          error={errors.name?.message}
          {...form.register('name')}
        />
        <SelectField
          label={t.inventory.category}
          error={errors.categoryId?.message}
          {...form.register('categoryId')}
        >
          <option value="">{t.inventory.allCategories}</option>
          {options.map((category) => (
            <option key={category.id} value={category.id}>
              {indentFor(category.depth)}
              {category.name}
            </option>
          ))}
        </SelectField>
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
