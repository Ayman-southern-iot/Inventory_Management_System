import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
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
      transportationCost: null,
      transportationDescription: null,
    },
  });

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  /**
   * The bottom-of-form Total uses `useWatch('items')` rather than `form.watch('items')`.
   * `form.watch` reaches into the form-state proxy, but Controller-wrapped inputs (the
   * `QuantityField` and the `estimatedUnitPrice` controller inside `ItemRow`) update state
   * through `setValue`, and the watch proxy can lag by one render in that path — the
   * per-row `Line total` (which reads through a single indexed `watch`) stays fresh, but
   * the array-level `watch` does not. `useWatch` subscribes through the same callback
   * `useFieldArray` uses, so it re-renders in step with the rows.
   */
  const items = useWatch({ control: form.control, name: 'items' }) as SaveRequisitionInput['items'] | undefined;
  const products: Product[] = useMemo(() => catalogue.data?.items ?? [], [catalogue.data]);

  const itemsTotal = useMemo(
    () =>
      (items ?? []).reduce(
        (sum, item) => sum + (item?.quantity ?? 0) * (item?.estimatedUnitPrice ?? 0),
        0,
      ),
    [items],
  );

  const transportationCost = form.watch('transportationCost');
  const transportationDescription = form.watch('transportationDescription');

  // Treat 0 / empty as "not set" so the total bar and the description-required rule agree
  // with what the API will store. The Zod refinement rejects non-zero cost without a
  // description, but the web clears them client-side to keep the form honest.
  const effectiveTransportation =
    typeof transportationCost === 'number' && transportationCost > 0
      ? transportationCost
      : 0;
  const requestedTotal = itemsTotal + effectiveTransportation;

  // When the cost drops to 0, the description should follow — the Zod refinement allows
  // either both-or-null, but a stale description on a 0 cost is a confusing leftover.
  useEffect(() => {
    if (effectiveTransportation === 0 && transportationDescription) {
      form.setValue('transportationDescription', null, { shouldValidate: true });
    }
  }, [effectiveTransportation, transportationDescription, form]);

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
      transportationCost: existing.data.transportationCost ?? null,
      transportationDescription: existing.data.transportationDescription ?? null,
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
              min={todayLocal()}
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
              {formatBdt(itemsTotal)}
            </span>
          </footer>
        </Panel>

        {/* ----------------------------------------- zone 3: transportation cost */}
        {/* Two-field panel below the items: amount + description. The description is required
            only when the amount is non-zero — Zod's cross-field refinement catches it, and
            the form clears the description when the amount drops to 0 so the totals stay
            honest. */}
        <Panel className="shadow-[--shadow-panel]">
          <header className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-ink">
              {t.requisitions.transportation.heading}
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {t.requisitions.transportation.hint}
            </p>
          </header>

          <div className="grid gap-5 p-5 sm:grid-cols-3">
            <TextField
              label={t.requisitions.transportation.amount}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.01}
              placeholder="0"
              error={errors.transportationCost?.message}
              {...form.register('transportationCost', {
                setValueAs: (value) => {
                  if (value === '' || value === null || value === undefined) return null;
                  const parsed = Number(value);
                  return Number.isFinite(parsed) ? parsed : null;
                },
              })}
            />

            <div className="sm:col-span-2">
              <TextField
                label={t.requisitions.transportation.description}
                placeholder={t.requisitions.transportation.descriptionPlaceholder}
                error={errors.transportationDescription?.message}
                disabled={effectiveTransportation === 0}
                {...form.register('transportationDescription', {
                  setValueAs: (value) => (value === '' ? null : value),
                })}
              />
            </div>
          </div>
        </Panel>

        {/* Final total bar — items + transportation + grand total. Replaces the old single-line
            total once transportation became part of the requested amount. */}
        <div className="rounded-[--radius-panel] border border-border bg-surface px-5 py-4 shadow-[--shadow-panel]">
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-muted">{t.requisitions.transportation.itemsTotal}</dt>
              <dd className="tabular-nums text-ink-muted">{formatBdt(itemsTotal)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-muted">{t.requisitions.transportation.transportationTotal}</dt>
              <dd className="tabular-nums text-ink-muted">{formatBdt(effectiveTransportation)}</dd>
            </div>
            <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
              <dt className="font-medium text-ink">{t.requisitions.transportation.requested}</dt>
              <dd className="text-2xl font-semibold tabular-nums text-ink">
                {formatBdt(requestedTotal)}
              </dd>
            </div>
          </dl>
        </div>

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

/** Local-date YYYY-MM-DD so the native picker rejects past dates without a TZ round-trip. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
