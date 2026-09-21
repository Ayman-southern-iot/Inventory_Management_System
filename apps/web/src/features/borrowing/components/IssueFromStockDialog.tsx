import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Info, LogIn } from 'lucide-react';
import {
  ErrorCode,
  formatLocation,
  issueFromStockSchema,
  type IssueFromStockInput,
  type ProductDetail,
} from '@ims/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { messageForError } from '@/lib/error-message';
import { QuantityField } from '@/features/inventory/components/QuantityField';
import { useCreateProject, useSelectableProjects } from '@/features/projects/api';
import { PersonPicker } from '@/features/users/components/PersonPicker';
import { useIssueFromStock } from '../api';

/**
 * The IM recording a handover that already happened: ten arrive, the CTO takes one off the
 * shelf and says "put it against me".
 *
 * Ayman's ask #4, first half. Distinct from Borrow, which is a *request* somebody raises and
 * the IM decides on — here the item is already in a colleague's hands and the IM is catching
 * the record up. It goes straight to ISSUED, and the person is notified because they never
 * asked for it and the notification is their proof it happened. Distinct again from "Change
 * holder", which moves an already-issued loan and touches no stock; this one moves stock,
 * reserve-then-issue in a single transaction (G-14).
 *
 * Laid out label-left rather than stacked: every row is a short answer, and a column of
 * full-width fields makes a six-line form scroll for no reason.
 */
const NEW_PROJECT = '__new__';

/** One row of the form. The label column is fixed so the controls line up down the dialog. */
function Row({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border py-3 sm:flex-row sm:items-start sm:gap-4">
      <label
        htmlFor={htmlFor}
        className="shrink-0 pt-2 text-sm font-medium text-ink sm:w-28"
      >
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-danger">
            *
          </span>
        ) : null}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function IssueFromStockDialog({
  open,
  onClose,
  product,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductDetail;
}) {
  const toast = useToast();
  const issueFromStock = useIssueFromStock();
  const createProject = useCreateProject();
  const projects = useSelectableProjects();

  /** Held only for the summary line; the form itself carries the id. */
  const [borrowerName, setBorrowerName] = useState('');
  /**
   * What the project select is showing, which is not the same thing as the project on the
   * request. `projectId` goes to the API as `uuid | null`, so the `__new__` sentinel must never
   * be written into the form — zod rejects it, `handleSubmit` short-circuits, and the button
   * appears to do nothing at all. Held beside the form instead.
   */
  const [projectChoice, setProjectChoice] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  /** Only shelves with something available — reserved units are already spoken for. */
  const sources = useMemo(
    () => product.placements.filter((placement) => placement.availableQty > 0),
    [product.placements],
  );

  const form = useForm<IssueFromStockInput>({
    resolver: zodResolver(issueFromStockSchema),
    defaultValues: {
      borrowerId: '',
      productId: product.id,
      compartmentId: '',
      quantity: undefined,
      projectId: null,
      isReturnable: product.defaultReturnable,
      expectedReturnDate: null,
      purpose: null,
    },
  });

  const borrowerId = form.watch('borrowerId');
  const compartmentId = form.watch('compartmentId');
  const quantity = form.watch('quantity');
  const isReturnable = form.watch('isReturnable');
  const expectedReturnDate = form.watch('expectedReturnDate');

  const selected = sources.find((placement) => placement.compartmentId === compartmentId);
  const maxQuantity = selected?.availableQty ?? 0;
  const totalAvailable = useMemo(
    () => sources.reduce((sum, placement) => sum + placement.availableQty, 0),
    [sources],
  );

  useEffect(() => {
    if (!open) return;
    setBorrowerName('');
    setProjectChoice('');
    setNewProjectName('');
    setDuplicateWarning(null);
    form.reset({
      borrowerId: '',
      productId: product.id,
      compartmentId: sources[0]?.compartmentId ?? '',
      quantity: undefined,
      projectId: null,
      isReturnable: product.defaultReturnable,
      expectedReturnDate: null,
      purpose: null,
    });
  }, [open, product, sources, form]);

  // A consumable never comes back, so a stale return date must not linger on the form.
  useEffect(() => {
    if (!isReturnable) form.setValue('expectedReturnDate', null);
  }, [isReturnable, form]);

  /** "+1 week" / "+1 month" — the two answers that cover almost every loan. */
  function setReturnInDays(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    form.setValue('expectedReturnDate', date.toISOString().slice(0, 10), {
      shouldValidate: true,
    });
  }

  async function ensureProject(force = false): Promise<string | null | undefined> {
    if (projectChoice !== NEW_PROJECT) return form.getValues('projectId');
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

  async function submit(values: IssueFromStockInput, forceProject = false) {
    try {
      const projectId = await ensureProject(forceProject);
      if (projectId === undefined) return; // waiting on the duplicate-name decision

      await issueFromStock.mutateAsync({ ...values, projectId });
      toast.success(t.borrowing.issuedFromStock);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;
  const locationLabel = selected
    ? formatLocation({
        roomName: selected.roomName,
        zoneName: selected.zoneName,
        compartmentCode: selected.compartmentCode,
      })
    : null;

  /**
   * The sentence the IM is about to commit, spelled out. Stock movements are not undoable
   * without a compensating entry, so the last thing before the button is a plain reading of
   * what the form currently says.
   */
  const summary =
    quantity && quantity > 0 && locationLabel && borrowerId
      ? t.borrowing.issueSummary
          .replace('{qty}', String(quantity))
          .replace('{unit}', product.unit)
          .replace('{from}', locationLabel)
          .replace('{to}', borrowerName)
      : null;

  return (
    <Dialog
      schema={issueFromStockSchema}
      size="lg"
      open={open}
      onClose={onClose}
      icon={<LogIn aria-hidden className="size-4" />}
      title={t.borrowing.issueFromStock}
      subtitle={`${product.name} · ${totalAvailable} ${t.inventory.availableShort}`}
      footerStart={
        summary ? (
          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <ArrowRight aria-hidden className="size-3.5 shrink-0" />
            {summary}
            {isReturnable && expectedReturnDate
              ? ` · ${t.borrowing.backBy} ${formatDate(expectedReturnDate)}`
              : ''}
          </p>
        ) : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            isLoading={isSubmitting}
            disabled={sources.length === 0}
            onClick={() => void form.handleSubmit((values) => submit(values))()}
          >
            {t.borrowing.issueFromStock}
          </Button>
        </>
      }
    >
      {sources.length === 0 ? (
        <p className="text-sm text-ink-muted">{t.inventory.nothingToMove}</p>
      ) : (
        <form
          id="issue-from-stock-form"
          noValidate
          onSubmit={form.handleSubmit((values) => submit(values))}
        >
          <p className="mb-1 flex items-start gap-2 rounded-[--radius-control] bg-info-subtle px-3 py-2 text-xs text-info">
            <Info aria-hidden className="mt-px size-4 shrink-0" />
            {t.borrowing.issueFromStockHint}
          </p>

          <Row label={t.borrowing.issueTo} required>
            <PersonPicker
              label={t.borrowing.issueTo}
              value={borrowerId}
              onChange={(id, person) => {
                form.setValue('borrowerId', id, { shouldValidate: true });
                setBorrowerName(person.fullName);
              }}
              placeholder={t.borrowing.choosePerson}
              error={errors.borrowerId?.message}
              required
            />
          </Row>

          <Row label={t.borrowing.fromBin} required>
            <SelectField
              label={t.borrowing.fromBin}
              hideLabel
              error={errors.compartmentId?.message}
              {...form.register('compartmentId')}
            >
              {sources.map((placement) => (
                <option key={placement.compartmentId} value={placement.compartmentId}>
                  {formatLocation({
                    roomName: placement.roomName,
                    zoneName: placement.zoneName,
                    compartmentCode: placement.compartmentCode,
                  })}{' '}
                  — {placement.availableQty} {t.inventory.availableShort}
                </option>
              ))}
            </SelectField>
          </Row>

          <Row label={t.borrowing.quantity} required>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-24">
                <QuantityField
                  control={form.control}
                  name="quantity"
                  label={t.borrowing.quantity}
                  hideLabel
                  error={errors.quantity?.message}
                  min={1}
                  max={Math.max(maxQuantity, 1)}
                />
              </div>
              <span className="text-xs text-ink-subtle">
                {product.unit} {t.borrowing.ofAvailable.replace('{n}', String(maxQuantity))}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  form.setValue('quantity', maxQuantity, { shouldValidate: true })
                }
              >
                {t.borrowing.takeAll}
              </Button>
              {/* What the shelf looks like afterwards — the number the IM is really deciding. */}
              <span
                className={cn(
                  'ml-auto text-xs',
                  quantity && quantity > maxQuantity ? 'text-danger' : 'text-ink-subtle',
                )}
              >
                {t.borrowing.leftAfterThis.replace(
                  '{n}',
                  String(Math.max(maxQuantity - (quantity ?? 0), 0)),
                )}
              </span>
            </div>
          </Row>

          <Row label={t.borrowing.returns}>
            <Checkbox label={t.borrowing.expectedBack} {...form.register('isReturnable')} />
            {isReturnable ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-l-2 border-brand pl-3">
                <TextField
                  type="date"
                  label={t.borrowing.returnDate}
                  hideLabel
                  error={errors.expectedReturnDate?.message}
                  {...form.register('expectedReturnDate')}
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => setReturnInDays(7)}>
                  {t.borrowing.plusWeek}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setReturnInDays(30)}>
                  {t.borrowing.plusMonth}
                </Button>
              </div>
            ) : null}
          </Row>

          {/*
            Ayman: the borrow form has a project for any general user, so issuing on their
            behalf must carry one too — otherwise a handover recorded by the IM silently drops
            off the project it belongs to, and the project's item list is wrong.
          */}
          <Row label={t.borrowing.project}>
            <SelectField
              label={t.borrowing.project}
              hideLabel
              value={projectChoice}
              onChange={(event) => {
                const next = event.target.value;
                setProjectChoice(next);
                // Only a real id reaches the form; "new" and "none" are both null until created.
                form.setValue('projectId', next === '' || next === NEW_PROJECT ? null : next);
              }}
            >
              <option value="">{t.borrowing.noProject}</option>
              {(projects.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
              <option value={NEW_PROJECT}>{t.borrowing.newProject}</option>
            </SelectField>

            {projectChoice === NEW_PROJECT ? (
              <div className="mt-2 flex flex-col gap-2">
                <TextField
                  label={t.borrowing.projectName}
                  hint={t.projects.proposalHint}
                  value={newProjectName}
                  onChange={(event) => {
                    setNewProjectName(event.target.value);
                    setDuplicateWarning(null);
                  }}
                />
                {duplicateWarning ? (
                  <div className="rounded-[--radius-control] bg-pending-subtle px-3 py-2 text-xs text-ink">
                    <p className="font-medium">{t.projects.duplicateTitle}</p>
                    <p className="mt-0.5">{t.projects.duplicateBody}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => void submit(form.getValues(), true)}
                    >
                      {t.projects.createAnyway}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Row>

          <div className="pt-3">
            <TextAreaField
              label={t.borrowing.purpose}
              placeholder={t.borrowing.purposePlaceholder}
              error={errors.purpose?.message}
              {...form.register('purpose')}
            />
          </div>
        </form>
      )}
    </Dialog>
  );
}
