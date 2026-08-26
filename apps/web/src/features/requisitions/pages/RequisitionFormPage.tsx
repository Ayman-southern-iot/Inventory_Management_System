import { useEffect, useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  PAGINATION_MAX_LIMIT,
  RequisitionStatus,
  RequisitionUrgency,
  saveRequisitionSchema,
  type Product,
  type SaveRequisitionInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { DateField } from '@/components/ui/DateField';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { messageForError } from '@/lib/error-message';
import { formatBdt } from '@/lib/format';
import { ROUTES } from '@/routes/paths';
import { useDepartments } from '@/features/admin/api';
import { useProjects } from '@/features/projects/api';
import { useAllProducts } from '@/features/inventory/api';
import { ItemRow } from '../components/ItemRow';
import { lineTotalOf } from '../lineTotal';
import { RequisitionSummary } from '../components/RequisitionSummary';
import { SupportingDocumentField } from '../components/SupportingDocumentField';
import {
  useCreateRequisition,
  useRequisition,
  useApprovalPolicy,
  useSubmitRequisition,
  useUpdateRequisition,
} from '../api';

/**
 * A `<select>` cannot hold null, so its "none" option carries `''`. The shared schema is the
 * API contract and correctly rejects that — `''` is neither a uuid nor null, and `.default(null)`
 * only fires for `undefined`. Coerce at the boundary where the empty string is produced.
 */
const emptyToNull = { setValueAs: (value: string) => (value === '' ? null : value) };

/**
 * The Reason cap. Well under the schema's own 2000, deliberately: approvers read this first and
 * skim, so a short box asks for a sentence rather than an essay. Enforced by `maxLength` and
 * counted below the field, from this one constant so the two cannot disagree.
 */
const REASON_MAX_LENGTH = 280;

const EMPTY_ITEM = {
  productId: null,
  itemName: '',
  quantity: undefined as unknown as number,
  estimatedUnitPrice: undefined as unknown as number,
  note: null,
};

/**
 * The whole catalogue in one page, because `ItemRow` searches it client-side. `limit` is the
 * contract's ceiling, not a number picked here: `listProductsQuerySchema` caps it at
 * `PAGINATION_MAX_LIMIT`, and a literal above that 400s on every load (D-002 — it asked for 200
 * and the picker was empty from 29 July until 23 August). Both constants are exported for
 * `api/list-queries.contract.test.ts`, which parses them through the schemas they are bound by.
 *
 * The picker reads it through `useAllProducts`, which pages until the server runs out, so a
 * catalogue larger than `PAGINATION_MAX_LIMIT` is no longer truncated in silence (D-002).
 * `page`/`limit` stay on this constant because `api/list-queries.contract.test.ts` parses it
 * through `listProductsQuerySchema`; the paging loop overrides both.
 */
export const CATALOGUE_QUERY = {
  page: 1,
  limit: PAGINATION_MAX_LIMIT,
  includeInactive: false,
  inStockOnly: false,
} as const;
export const DEPARTMENTS_QUERY = { page: 1, limit: PAGINATION_MAX_LIMIT, includeInactive: false } as const;

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
  const catalogue = useAllProducts(CATALOGUE_QUERY);

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
  const products: Product[] = useMemo(() => catalogue.data ?? [], [catalogue.data]);

  const itemsTotal = useMemo(
    () =>
      // D-017: a line that is not costable contributes nothing, rather than contributing the
      // product of two rejected numbers. The line itself renders a dash, so the user can see
      // which one is holding the total back instead of reading a confident wrong figure.
      (items ?? []).reduce(
        (sum, item) => sum + (lineTotalOf(item?.quantity, item?.estimatedUnitPrice) ?? 0),
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

  /**
   * D-004: the reset has to wait for the two dropdowns' own queries, not just the requisition.
   * A `<select>` handed a value with no matching `<option>` keeps "", so resetting while the
   * option lists are still in flight silently discarded the user's saved department and project
   * — the values were on the record and in the page header, but not in the form they were
   * editing.
   *
   * Gated on *settled*, not on *data present*: if either query fails, `isPending` still goes
   * false and every other field populates. Blocking on `.data` would leave the whole form empty
   * behind a failed lookup, which trades one defect for a worse one.
   */
  const approvalPolicy = useApprovalPolicy();
  /** Watched rather than read on blur: the counter has to move as the requester types. */
  const reasonLength = (useWatch({ control: form.control, name: 'reason' }) ?? '').length;

  const optionListsSettled = !departments.isPending && !projects.isPending;

  useEffect(() => {
    if (!isEditing || !existing.data || !optionListsSettled) return;
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
  }, [isEditing, existing.data, optionListsSettled, form]);

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
    // Held outside the try so the catch can tell the two failures apart: the save itself failing
    // (nothing exists) and the save succeeding while the submit is refused (a draft exists, and
    // has already taken a reference number).
    let draftId: string | null = null;
    try {
      draftId = await persist(values);
      if (!draftId) return;
      await submitRequisition.mutateAsync({ id: draftId });
      toast.success(t.requisitions.submitted);
      navigate(ROUTES.requisitions.detail(draftId));
    } catch (error) {
      toast.error(messageForError(error));

      /**
       * D-015. Submitting is save-then-submit, so a refused submit still leaves a saved draft
       * holding a reference number — and the requester was told only why the submit failed.
       * QA hit this twice in one session and produced two orphan drafts, because a form that
       * still looks unsaved invites you to press Submit again.
       *
       * The work is worth keeping; doing it silently is the defect. So say it, and land them on
       * the draft, where the reference number is visible and the button says Save rather than
       * offering to create a second one.
       */
      if (draftId) {
        toast.success(t.requisitions.keptAsDraft);
        navigate(ROUTES.requisitions.detail(draftId));
      }
    }
  }

  if (isEditing && existing.isPending) return <LoadingState />;

  const { errors, isSubmitting } = form.formState;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={isEditing ? t.requisitions.editDraft : t.requisitions.newRequisition}
        subtitle={t.requisitions.subtitle}
      />

      {/* Two columns above `lg`, stacked below it. The summary is sticky rather than pinned to
          the bottom of the viewport: the running total matters most while the item rows are
          being typed, which is exactly when a bottom bar would sit on top of them. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <form noValidate className="flex flex-col gap-5">
        {/* ---------------------------------------------- zone 1: the request */}
        <Panel className="shadow-[--shadow-panel]">
          <header className="border-b border-border px-5 py-4">
            <h2 className="text-label font-semibold text-ink">{t.requisitions.detailsHeading}</h2>
            <p className="mt-0.5 text-caption text-ink-muted">{t.requisitions.detailsHint}</p>
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

            {/* Not `<input type="date">`. See DateField: the native control cannot show a past
                date as unreachable before it is clicked, renders differently per browser, and
                changes value on a stray wheel scroll. Controller-wrapped because the picker
                commits a value on Set rather than emitting a DOM change event. */}
            <Controller
              control={form.control}
              name="approvalDeadline"
              render={({ field }) => (
                <DateField
                  label={t.requisitions.approvalDeadline}
                  hint={t.requisitions.approvalDeadlineHint}
                  error={errors.approvalDeadline?.message}
                  placeholder={t.requisitions.selectDate}
                  value={field.value ?? null}
                  onChange={field.onChange}
                />
              )}
            />

            <div className="sm:col-span-2">
              <TextAreaField
                label={t.requisitions.reason}
                hint={t.requisitions.reasonHint}
                error={errors.reason?.message}
                maxLength={REASON_MAX_LENGTH}
                {...form.register('reason')}
              />
              {/* Counts down against the same limit `maxLength` enforces, so the number and the
                  behaviour cannot disagree. Right-aligned under the field, out of the way until
                  it is nearly spent. */}
              <p
                className={cn(
                  'mt-1 text-right text-xs tabular-nums',
                  reasonLength > REASON_MAX_LENGTH * 0.9 ? 'text-pending' : 'text-ink-subtle',
                )}
              >
                {t.requisitions.reasonCounter
                  .replace('{n}', String(reasonLength))
                  .replace('{max}', String(REASON_MAX_LENGTH))}
              </p>
            </div>
          </div>
        </Panel>

        {/* ------------------------------------ zone 1b: supporting document */}
        {/* The field is upload-only: the requester can attach/replace/remove from here, and the
            pointer is auto-saved the moment the upload returns. Rendered for brand-new drafts
            too — but disabled until the first save gives the request a stable id. */}
        <Panel className="shadow-[--shadow-panel]">
          <header className="border-b border-border px-5 py-4">
            <h2 className="text-label font-semibold text-ink">
              {t.requisitions.supportingDocument.fieldHeading}
            </h2>
            <p className="mt-0.5 text-caption text-ink-muted">
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
              <h2 className="text-label font-semibold text-ink">{t.requisitions.itemsHeading}</h2>
              <p className="mt-0.5 text-caption text-ink-muted">{t.requisitions.itemsHint}</p>
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

          {/*
            A failed catalogue used to be indistinguishable from an empty one: the picker just
            had no options and the requester typed free text, so every line reached the
            approvers unlinked from stock and `in_stock_qty_at_submit` stayed null (D-002).
          */}
          {catalogue.isError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-muted px-5 py-3"
            >
              <p className="text-sm text-danger">{t.requisitions.catalogueUnavailable}</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => catalogue.refetch()}>
                {t.common.retry}
              </Button>
            </div>
          ) : null}

          {/*
            A real table, with the column names in one `<thead>` rather than repeated on every
            row. `table-fixed` plus explicit widths keeps the columns from resizing as the
            requester types — a header like "Unit price (BDT)" otherwise wraps to two lines the
            moment a long item name lands beside it, and every row below shifts.
          */}
          <div className="px-5 pb-1 pt-4">
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {[
                    { label: t.requisitions.itemName, width: 'w-[44%]', align: 'text-left' },
                    { label: t.requisitions.quantity, width: 'w-[13%]', align: 'text-right' },
                    { label: t.requisitions.unitPrice, width: 'w-[19%]', align: 'text-right' },
                    { label: t.requisitions.lineTotal, width: 'w-[17%]', align: 'text-right' },
                    { label: '', width: 'w-[7%]', align: 'text-left' },
                  ].map((column, columnIndex) => (
                    <th
                      key={column.label || `actions-${columnIndex}`}
                      scope="col"
                      className={cn(
                        'pb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-subtle',
                        column.width,
                        column.align,
                        columnIndex < 4 && 'pr-3',
                      )}
                    >
                      {/* The last column holds the delete button and has no name to give. */}
                      {column.label || <span className="sr-only">{t.requisitions.removeItem}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
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
              </tbody>
            </table>

            {/* Said once, under the table, instead of under every row. */}
            <p className="mt-2 text-xs text-ink-subtle">{t.requisitions.itemNameHint}</p>
          </div>

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
            <h2 className="text-label font-semibold text-ink">
              {t.requisitions.transportation.heading}
            </h2>
            <p className="mt-0.5 text-caption text-ink-muted">
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

        </form>

        {/* The totals and both actions moved in here. They used to sit at the bottom of the
            form, which meant the figure that decides how many approvers you need was off screen
            for the whole time you were creating it. */}
        <RequisitionSummary
          itemsTotal={itemsTotal}
          transportationTotal={effectiveTransportation}
          requestedTotal={requestedTotal}
          policy={approvalPolicy.data}
          isSubmitting={isSubmitting}
          onSaveDraft={form.handleSubmit(onSaveDraft)}
          onSubmit={form.handleSubmit(onSubmitForApproval)}
        />
      </div>
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
