import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Send } from 'lucide-react';
import {
  RequisitionStatus,
  RequisitionUrgency,
  saveRequisitionSchema,
  type Product,
  type SaveRequisitionInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { formatBdt } from '@/lib/format';
import { ROUTES } from '@/routes/paths';
import { useDepartments } from '@/features/admin/api';
import { useProjects } from '@/features/projects/api';
import { useProducts } from '@/features/inventory/api';
import { ItemRow } from '../components/ItemRow';
import { SupportingDocumentField } from '../components/SupportingDocumentField';
import {
  useCreateRequisition,
  useRequisition,
  useSubmitRequisition,
  useUpdateRequisition,
} from '../api';

/**
 * A `<select>` cannot hold null, so its "none" option carries `''`. The shared schema is the
 * API contract and correctly rejects that — `''` is neither a uuid nor null, and `.default(null)`
 * only fires for `undefined`. Coerce at the boundary where the empty string is produced.
 */
const emptyToNull = { setValueAs: (value: string) => (value === '' ? null : value) };

const EMPTY_ITEM = {
  productId: null,
  itemName: '',
  quantity: undefined as unknown as number,
  estimatedUnitPrice: undefined as unknown as number,
  note: null,
};

/** Enough of the catalogue to search client-side; the register is small at this scale. */
const CATALOGUE_QUERY = { page: 1, limit: 200, includeInactive: false, inStockOnly: false } as const;
const DEPARTMENTS_QUERY = { page: 1, limit: 100, includeInactive: false } as const;

/**
 * Task 3.2 — the requisition form, in the two zones requirements §3 scopes:
 * a per-request header, and per-line items.
 */
export function RequisitionFormPage() {
  const { requisitionId } = useParams<{ requisitionId: string }>();
  const isEditing = Boolean(requisitionId);
  const navigate = useNavigate();
  const toast = useToast();

  const existing = useRequisition(requisitionId ?? '');
  const departments = useDepartments(DEPARTMENTS_QUERY);
  const projects = useProjects();
  const catalogue = useProducts(CATALOGUE_QUERY);

  const createRequisition = useCreateRequisition();
  const updateRequisition = useUpdateRequisition();
  const submitRequisition = useSubmitRequisition();

  /**
   * Pre-draft attach. Lifted from `SupportingDocumentField` when the form has no
   * requisition id yet (the user picked a file on the empty form, before saving).
   * Sent to the server as `pendingSupportingDocumentId`; the create service claims
   * the file in the same transaction. Cleared after a successful save so a refresh
   * does not resend a stale id.
   */
  const [pendingSupportingDocumentId, setPendingSupportingDocumentId] = useState<string | null>(null);

  const form = useForm<SaveRequisitionInput>({
    resolver: zodResolver(saveRequisitionSchema),
    defaultValues: {
      departmentId: null,
      projectId: null,
      urgency: RequisitionUrgency.NORMAL,
      approvalDeadline: null,
      reason: null,
      items: [{ ...EMPTY_ITEM }],
    },
  });

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  const items = form.watch('items');
  const products: Product[] = useMemo(() => catalogue.data?.items ?? [], [catalogue.data]);

  const total = useMemo(
    () =>
      (items ?? []).reduce(
        (sum, item) => sum + (item?.quantity ?? 0) * (item?.estimatedUnitPrice ?? 0),
        0,
      ),
    [items],
  );

  useEffect(() => {
    if (!isEditing || !existing.data) return;
    form.reset({
      departmentId: existing.data.departmentId,
      projectId: existing.data.projectId,
      urgency: existing.data.urgency,
      approvalDeadline: existing.data.approvalDeadline,
      reason: existing.data.reason,
      items: existing.data.items.map((item) => ({
        productId: item.productId,
        itemName: item.itemName,
        quantity: item.quantity,
        estimatedUnitPrice: item.estimatedUnitPrice,
        note: item.note,
      })),
    });
  }, [isEditing, existing.data, form]);

  async function persist(values: SaveRequisitionInput): Promise<string | null> {
    if (isEditing && requisitionId) {
      await updateRequisition.mutateAsync({ id: requisitionId, input: values });
      return requisitionId;
    }
    // Pre-draft attach: include the orphan file id only when creating. Updating a
    // draft goes through `updateRequisition` (no field change) and ignores this.
    const created = await createRequisition.mutateAsync({
      ...values,
      pendingSupportingDocumentId,
    });
    // The id is consumed; clear so a refresh doesn't reuse it for a different save.
    setPendingSupportingDocumentId(null);
    return created.id;
  }

  async function onSaveDraft(values: SaveRequisitionInput) {
    try {
      const id = await persist(values);
      toast.success(t.requisitions.draftSaved);
      if (id) navigate(ROUTES.requisitions.detail(id));
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  /**
   * Save then submit. Saving first means the server totals the *stored* lines, so what gets
   * frozen is what is on the record rather than whatever the browser last calculated.
   */
  async function onSubmitForApproval(values: SaveRequisitionInput) {
    try {
      const id = await persist(values);
      if (!id) return;
      await submitRequisition.mutateAsync({ id });
      toast.success(t.requisitions.submitted);
      navigate(ROUTES.requisitions.detail(id));
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  if (isEditing && existing.isPending) return <LoadingState />;

  const { errors, isSubmitting } = form.formState;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={isEditing ? t.requisitions.editDraft : t.requisitions.newRequisition}
        subtitle={t.requisitions.subtitle}
      />

      <form noValidate className="flex flex-col gap-6">
        {/* ---------------------------------------------- zone 1: the request */}
        <Panel className="shadow-[--shadow-panel]">
          <header className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-ink">{t.requisitions.detailsHeading}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">{t.requisitions.detailsHint}</p>
          </header>

          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <SelectField
              label={t.requisitions.department}
              {...form.register('departmentId', emptyToNull)}
            >
              <option value="">{t.users.noDepartment}</option>
              {(departments.data?.items ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </SelectField>

            <SelectField
              label={t.requisitions.project}
              {...form.register('projectId', emptyToNull)}
            >
              <option value="">{t.requisitions.noProject}</option>
              {(projects.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </SelectField>

            <SelectField label={t.requisitions.urgency} {...form.register('urgency')}>
              {Object.values(RequisitionUrgency).map((urgency) => (
                <option key={urgency} value={urgency}>
                  {t.requisitions.urgencyLabel[urgency]}
                </option>
              ))}
            </SelectField>

            <TextField
              label={t.requisitions.approvalDeadline}
              type="date"
              hint={t.requisitions.approvalDeadlineHint}
              error={errors.approvalDeadline?.message}
              {...form.register('approvalDeadline')}
            />

            <div className="sm:col-span-2">
              <TextAreaField
                label={t.requisitions.reason}
                hint={t.requisitions.reasonHint}
                error={errors.reason?.message}
                {...form.register('reason')}
              />
            </div>
          </div>
        </Panel>

        {/* ------------------------------------ zone 1b: supporting document */}
        {/* The field is upload-only: the requester can attach/replace/remove from here, and the
            pointer is auto-saved the moment the upload returns. Rendered for brand-new drafts
            too — but disabled until the first save gives the request a stable id. */}
        <Panel className="shadow-[--shadow-panel]">
          <header className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-ink">
              {t.requisitions.supportingDocument.fieldHeading}
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {t.requisitions.supportingDocument.fieldHint}
            </p>
          </header>
          <div className="p-5">
            <SupportingDocumentField
              requisitionId={requisitionId}
              document={existing.data?.supportingDocument ?? null}
              canEdit={
                // New (no id yet): always editable — orphan-mode. Editing: only DRAFT.
                !requisitionId || existing.data?.status === RequisitionStatus.DRAFT
              }
              onPendingChange={setPendingSupportingDocumentId}
            />
          </div>
        </Panel>

        {/* ------------------------------------------------ zone 2: the items */}
        <Panel className="shadow-[--shadow-panel]">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-ink">{t.requisitions.itemsHeading}</h2>
              <p className="mt-0.5 text-sm text-ink-muted">{t.requisitions.itemsHint}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Plus aria-hidden className="size-4" />}
              onClick={() => append({ ...EMPTY_ITEM })}
            >
              {t.requisitions.addItem}
            </Button>
          </header>

          {fields.map((field, index) => (
            <ItemRowContainer
              key={field.id}
              index={index}
              form={form}
              products={products}
              onPickProduct={(product) =>
                update(index, {
                  ...form.getValues(`items.${index}`),
                  productId: product?.id ?? null,
                  ...(product ? { itemName: product.name } : {}),
                })
              }
              onRemove={() => remove(index)}
              canRemove={fields.length > 1}
            />
          ))}

          {errors.items?.message ? (
            <p role="alert" className="px-4 py-2 text-xs text-danger">
              {errors.items.message}
            </p>
          ) : null}

          <footer className="flex items-baseline justify-between border-t border-border bg-surface-muted px-5 py-4">
            <span className="text-sm font-medium text-ink-muted">{t.requisitions.total}</span>
            <span className="text-2xl font-semibold tabular-nums text-ink">
              {formatBdt(total)}
            </span>
          </footer>
        </Panel>

        <div className="sticky bottom-0 z-10 mt-6 flex items-center justify-between gap-3 rounded-[--radius-panel] border border-border bg-surface px-5 py-4 shadow-[--shadow-panel]">
          <p className="text-xs text-ink-subtle">{t.requisitions.submitHint}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              isLoading={isSubmitting}
              onClick={form.handleSubmit(onSaveDraft)}
            >
              {t.requisitions.saveDraft}
            </Button>
            <Button
              type="button"
              icon={<Send aria-hidden className="size-4" />}
              isLoading={isSubmitting}
              onClick={form.handleSubmit(onSubmitForApproval)}
            >
              {t.requisitions.submit}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

/** Keeps `RequisitionFormPage` readable by holding the per-row wiring in one place. */
function ItemRowContainer({
  index,
  form,
  products,
  onPickProduct,
  onRemove,
  canRemove,
}: {
  index: number;
  form: ReturnType<typeof useForm<SaveRequisitionInput>>;
  products: Product[];
  onPickProduct: (product: Product | null) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const item = form.watch(`items.${index}`);
  const itemErrors = form.formState.errors.items?.[index];

  return (
    <ItemRow
      index={index}
      control={form.control}
      register={form.register}
      products={products}
      productId={item?.productId ?? null}
      itemName={item?.itemName ?? ''}
      quantity={item?.quantity}
      unitPrice={item?.estimatedUnitPrice}
      onPickProduct={onPickProduct}
      onRemove={onRemove}
      canRemove={canRemove}
      errors={{
        itemName: itemErrors?.itemName?.message,
        quantity: itemErrors?.quantity?.message,
        estimatedUnitPrice: itemErrors?.estimatedUnitPrice?.message,
      }}
    />
  );
}
