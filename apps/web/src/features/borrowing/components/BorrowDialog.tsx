import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ErrorCode,
  createBorrowRequestSchema,
  type CreateBorrowRequestInput,
  type ProductDetail,
} from '@ims/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { QuantityField } from '@/features/inventory/components/QuantityField';
import { useCreateBorrow, useCreateProject, useProjects } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  product: ProductDetail;
}

const NEW_PROJECT = '__new__';

export function BorrowDialog({ open, onClose, product }: Props) {
  const toast = useToast();
  const createBorrow = useCreateBorrow();
  const createProject = useCreateProject();
  const projects = useProjects();

  const [newProjectName, setNewProjectName] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  /** Only compartments with something available — reserved units are already spoken for. */
  const sources = useMemo(
    () => product.placements.filter((placement) => placement.availableQty > 0),
    [product.placements],
  );

  const form = useForm<CreateBorrowRequestInput>({
    resolver: zodResolver(createBorrowRequestSchema),
    defaultValues: {
      productId: product.id,
      compartmentId: '',
      quantity: undefined,
      projectId: null,
      isReturnable: product.defaultReturnable,
      expectedReturnDate: null,
      purpose: null,
    },
  });

  const compartmentId = form.watch('compartmentId');
  const isReturnable = form.watch('isReturnable');
  const selected = sources.find((placement) => placement.compartmentId === compartmentId);
  const maxQuantity = selected?.availableQty ?? 0;

  useEffect(() => {
    if (!open) return;
    setNewProjectName('');
    setDuplicateWarning(null);
    form.reset({
      productId: product.id,
      compartmentId: sources[0]?.compartmentId ?? '',
      quantity: undefined,
      projectId: null,
      // OQ-08: the product's default, which the requester may override below.
      isReturnable: product.defaultReturnable,
      expectedReturnDate: null,
      purpose: null,
    });
  }, [open, product, sources, form]);

  // A consumable never comes back, so the date field must not linger with a stale value.
  useEffect(() => {
    if (!isReturnable) form.setValue('expectedReturnDate', null);
  }, [isReturnable, form]);

  async function ensureProject(force = false): Promise<string | null | undefined> {
    const chosen = form.getValues('projectId');
    if (chosen !== NEW_PROJECT) return chosen;
    if (!newProjectName.trim()) return null;

    try {
      const created = await createProject.mutateAsync({
        name: newProjectName.trim(),
        allowDuplicateName: force,
      });
      setDuplicateWarning(null);
      return created.id;
    } catch (error) {
      // OQ-09: a duplicate name is a warning the user can override, not a failure.
      if (error instanceof ApiError && error.code === ErrorCode.DUPLICATE_PROJECT_NAME) {
        setDuplicateWarning(newProjectName.trim());
        return undefined;
      }
      throw error;
    }
  }

  async function submit(values: CreateBorrowRequestInput, forceProject = false) {
    try {
      const projectId = await ensureProject(forceProject);
      if (projectId === undefined) return; // waiting on the duplicate-name decision

      await createBorrow.mutateAsync({ ...values, projectId });
      toast.success(t.borrowing.requested);
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
      title={`${t.borrowing.borrow} — ${product.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button
            form="borrow-form"
            type="submit"
            isLoading={isSubmitting}
            disabled={sources.length === 0}
          >
            {t.borrowing.borrow}
          </Button>
        </>
      }
    >
      {sources.length === 0 ? (
        <p className="text-sm text-ink-muted">{t.inventory.nothingToMove}</p>
      ) : (
        <form
          id="borrow-form"
          noValidate
          onSubmit={form.handleSubmit((values) => submit(values))}
          className="flex flex-col gap-4"
        >
          <SelectField
            label={t.borrowing.location}
            error={errors.compartmentId?.message}
            {...form.register('compartmentId')}
          >
            {sources.map((placement) => (
              <option key={placement.compartmentId} value={placement.compartmentId}>
                {placement.zoneName} / {placement.compartmentCode} — {placement.availableQty}{' '}
                {t.inventory.availableShort}
              </option>
            ))}
          </SelectField>

          <QuantityField
            control={form.control}
            name="quantity"
            label={t.borrowing.quantity}
            hint={`${t.inventory.available}: ${maxQuantity} ${product.unit}`}
            error={errors.quantity?.message}
            min={1}
            max={maxQuantity}
          />

          <SelectField label={t.borrowing.project} {...form.register('projectId')}>
            <option value="">{t.borrowing.noProject}</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
            <option value={NEW_PROJECT}>{t.borrowing.newProject}</option>
          </SelectField>

          {form.watch('projectId') === NEW_PROJECT ? (
            <div className="flex flex-col gap-2">
              <TextField
                label={t.borrowing.projectName}
                value={newProjectName}
                onChange={(event) => {
                  setNewProjectName(event.target.value);
                  setDuplicateWarning(null);
                }}
              />
              {duplicateWarning ? (
                <div className="rounded-[--radius-control] bg-pending-subtle px-3 py-2 text-xs text-ink">
                  <p className="font-medium">{t.borrowing.duplicateProjectTitle}</p>
                  <p className="mt-0.5">{t.borrowing.duplicateProjectBody}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => void submit(form.getValues(), true)}
                  >
                    {t.borrowing.createAnyway}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <Checkbox
            label={t.borrowing.returnable}
            {...form.register('isReturnable')}
          />
          <p className="-mt-2 text-xs text-ink-subtle">{t.borrowing.returnableHint}</p>

          {isReturnable ? (
            <TextField
              label={t.borrowing.expectedReturn}
              type="date"
              error={errors.expectedReturnDate?.message}
              {...form.register('expectedReturnDate')}
            />
          ) : null}

          <TextAreaField
            label={t.borrowing.purpose}
            hint={t.borrowing.purposeHint}
            error={errors.purpose?.message}
            {...form.register('purpose')}
          />
        </form>
      )}
    </Dialog>
  );
}
