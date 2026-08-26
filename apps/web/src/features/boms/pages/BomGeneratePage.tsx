import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Undo2 } from 'lucide-react';
import {
  type BomCandidate,
  type GenerateBomInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Checkbox, TextAreaField } from '@/components/ui/Field';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/Dialog';
import {
  EmptyState,
  QueryBoundary,
} from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { ROUTES } from '@/routes/paths';
import { useBomCandidates, useGenerateBom, useSendBackForRevision } from '../api';
import { BomLineEditorRow } from '../components/BomLineEditorRow';
import {
  type BomGenerateLine,
  linesFromCandidate,
} from '../components/types';

interface BomGenerateForm {
  lines: BomGenerateLine[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The IM's BOM creation flow:
 *
 *  1. The picker (zone 1) lists every approved requisition not on a live BOM. Ticking
 *     pulls its lines into the editor (zone 2).
 *  2. The editor (zone 2) shows one row per line, grouped by source. Four cells are
 *     editable — quantity (a shrink only, clamped to [1, sourceQuantity]), unit cost,
 *     vendor, and a "Drop from BOM" checkbox. Removing a line filters it out of the
 *     submit payload; source `requisition_items.quantity` is never modified.
 *  3. The totals footer tracks approved / subtotal / variance live.
 *  4. Submit sends the form. The API bounces it back with 409 BOM_OVER_BUDGET if the
 *     subtotal still exceeds the budget, and the screen stays so the IM can adjust.
 *
 * 1-item + over-budget branches out of the normal flow: there is only one line and it
 * cannot shrink, so the Generate button is replaced by "Send back for revision", which
 * calls `POST /requisitions/:id/send-back-for-revision` to flip the requisition back to
 * DRAFT for budget revision by the requester.
 *
 * After a successful generate, the response is the new BOM detail; we navigate to it
 * so the IM lands on the detail page where rendering + downloading the PDF live.
 */
export function BomGeneratePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const candidates = useBomCandidates();
  const generate = useGenerateBom();
  const sendBack = useSendBackForRevision();

  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [sendBackFor, setSendBackFor] = useState<{ id: string; no: string } | null>(null);
  const [sendBackReason, setSendBackReason] = useState('');

  const form = useForm<BomGenerateForm>({
    defaultValues: { lines: [] },
  });
  const { control, register, reset } = form;
  const fieldArray = useFieldArray({ control, name: 'lines' });

  /**
   * D-026: `useWatch`, not `watch('lines')`.
   *
   * `watch` handed back the same array of the same line objects on every render, mutated in
   * place. The rows still looked right because each row reads `line.unitCost` during render and
   * so saw the mutation — but `useMemo(..., [lines])` compares the array *reference*, which
   * never changed, so every derived number below was computed once and then frozen. The IM
   * watched line totals move while BOM SUBTOTAL and VARIANCE stayed at their opening figures.
   *
   * `useWatch` returns a fresh structure per change, so the memos below invalidate honestly.
   */
  const lines = useWatch({ control, name: 'lines' });

  /**
   * Toggling a candidate synchronises the line list. We rebuild from scratch on every
   * tick / untick rather than try to splice — the IM is picking a few items out of a
   * small set, and rebuilding makes the rows always match the snapshot the picker
   * currently represents.
   */
  useEffect(() => {
    if (!candidates.data) return;
    const picked = candidates.data.filter((c) => pickedIds.has(c.requisitionId));
    const next = picked.flatMap(linesFromCandidate);
    reset({ lines: next });
    // intentionally excludes `reset` — it is stable, and `picked` derives from `candidates`
  }, [candidates.data, pickedIds]);

  const subtotal = useMemo(
    () =>
      (lines ?? []).reduce(
        // Removed lines don't count — they don't enter the BOM. Quantity overrides do.
        (sum, line) =>
          line?.removed ? sum : sum + (line?.unitCost ?? 0) * (line?.quantity ?? 0),
        0,
      ),
    [lines],
  );

  const approvedTotal = useMemo(
    () =>
      round2(
        (candidates.data ?? [])
          .filter((c) => pickedIds.has(c.requisitionId))
          .reduce((sum, c) => sum + (c.approvedAmount ?? 0), 0),
      ),
    [candidates.data, pickedIds],
  );

  /**
   * 1-item + over-budget detection, per picked candidate. A single-line requisition
   * whose item subtotal exceeds its approved amount at any feasible unit price must
   * bounce — there is no shrink to apply. Multi-item requisitions stay on the
   * normal generate path; the IM can shrink qty or remove lines until it fits.
   */
  const singleOverBudget = useMemo(() => {
    if (!candidates.data) return null;
    for (const candidate of candidates.data) {
      if (!pickedIds.has(candidate.requisitionId)) continue;
      if (candidate.items.length !== 1) continue;
      const item = candidate.items[0]!;
      const requestedSubtotal = item.quantity * item.estimatedUnitPrice;
      const approved = candidate.approvedAmount ?? 0;
      if (requestedSubtotal > approved && approved > 0) {
        return {
          id: candidate.requisitionId,
          no: candidate.requisitionNo,
        };
      }
    }
    return null;
  }, [candidates.data, pickedIds]);

  function toggleCandidate(candidate: BomCandidate, checked: boolean) {
    setPickedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(candidate.requisitionId);
      else next.delete(candidate.requisitionId);
      return next;
    });
  }

  async function onSubmit() {
    // Only live (non-removed) lines go on the wire. Removed lines are filtered out
    // so the IM can drop a line entirely without leaving the payload shape ambiguous.
    const present = (lines ?? []).filter((line) => !line.removed && line.unitCost !== null);
    if (present.length === 0) return;

    const payload: GenerateBomInput = {
      requisitionIds: Array.from(new Set(present.map((line) => line.requisitionId))),
      lines: present.map((line) => ({
        requisitionItemId: line.requisitionItemId,
        // Quantity override is BOM-local: it ships on the wire as an integer ≥ 1 (or
        // undefined when equal to source, which the server reads from the source
        // requisition item — keeps the audit trail obvious).
        quantity: line.quantity === line.sourceQuantity ? undefined : line.quantity,
        unitCost: line.unitCost ?? 0,
        vendor: line.vendor,
        // Always send the explicit boolean so the wire shape is unambiguous; the
        // server treats `false` the same as "not removed".
        removed: false,
      })),
    };

    try {
      const result = await generate.mutateAsync(payload);
      toast.success(t.boms.generatedToast);
      navigate(ROUTES.boms.detail(result.id));
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  async function onConfirmSendBack() {
    if (!sendBackFor) return;
    if (sendBackReason.trim().length < 3) return;
    try {
      await sendBack.mutateAsync({
        id: sendBackFor.id,
        input: { reason: sendBackReason.trim() },
      });
      toast.success(t.boms.sendBackDialog.successToast);
      // The candidate has flipped to DRAFT — remove it from the picker so the IM
      // lands on a clean editor.
      setPickedIds((current) => {
        const next = new Set(current);
        next.delete(sendBackFor.id);
        return next;
      });
      setSendBackFor(null);
      setSendBackReason('');
      navigate(ROUTES.requisitions.detail(sendBackFor.id));
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const groupedBySource = useMemo(() => {
    const out = new Map<string, { requisitionNo: string; lines: BomGenerateLine[] }>();
    (lines ?? []).forEach((line) => {
      const group =
        out.get(line.requisitionId) ?? {
          requisitionNo: line.requisitionNo,
          lines: [],
        };
      group.lines.push(line);
      out.set(line.requisitionId, group);
    });
    return Array.from(out.entries());
  }, [lines]);

  const showSendBack = singleOverBudget !== null;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to={ROUTES.boms.all}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.boms.title}
      </Link>

      <PageHeader title={t.boms.newBom} subtitle={t.boms.subtitle} />

      <QueryBoundary
        isLoading={candidates.isPending}
        error={candidates.error}
        data={candidates.data}
        onRetry={() => void candidates.refetch()}
      >
        {(items) => (
          <div className="flex flex-col gap-6">
            <Panel>
              <header className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-ink">
                  {t.boms.pickRequisitions}
                </h2>
                <p className="text-xs text-ink-subtle">
                  {t.boms.pickRequisitionsHint}
                </p>
              </header>
              <div className="divide-y divide-border">
                {items.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      title={t.boms.emptyCandidatesTitle}
                      body={t.boms.emptyCandidatesBody}
                    />
                  </div>
                ) : (
                  items.map((candidate) => (
                    <PickerRow
                      key={candidate.requisitionId}
                      candidate={candidate}
                      checked={pickedIds.has(candidate.requisitionId)}
                      onToggle={(checked) => toggleCandidate(candidate, checked)}
                    />
                  ))
                )}
              </div>
            </Panel>

            {groupedBySource.length > 0 ? (
              <Panel>
                <header className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink">
                    {t.boms.lineEditorHeading}
                  </h2>
                  <p className="text-xs text-ink-subtle">
                    {t.boms.lineEditorHint}
                  </p>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <tbody className="divide-y divide-border">
                      {groupedBySource.map(([requisitionId, group]) => (
                        <SourceGroup
                          key={requisitionId}
                          requisitionNo={group.requisitionNo}
                          rows={group.lines}
                          // Use the absolute index in `fieldArray.fields` so RHF's
                          // `register` writes to the right slot.
                          indexOf={(line) =>
                            fieldArray.fields.findIndex(
                              (field) => field.requisitionItemId === line.requisitionItemId,
                            )
                          }
                          control={control}
                          register={register}
                          errors={
                            form.formState.errors.lines as Array<{
                              quantity?: { message?: string };
                              unitCost?: { message?: string };
                              vendor?: { message?: string };
                            }> | undefined
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <footer className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-border px-4 py-3 sm:grid-cols-3">
                  <TotalsCell
                    label={t.boms.approvedTotal}
                    value={approvedTotal.toLocaleString()}
                  />
                  <TotalsCell
                    label={t.boms.bomSubtotal}
                    value={round2(subtotal).toLocaleString()}
                    emphasis
                  />
                  <TotalsCell
                    label={t.boms.variance}
                    value={`${(round2(subtotal) - approvedTotal).toLocaleString()} (${
                      approvedTotal === 0
                        ? 'n/a'
                        : `${(((round2(subtotal) - approvedTotal) / approvedTotal) * 100).toFixed(1)}%`
                    })`}
                  />
                </footer>
              </Panel>
            ) : null}

            {showSendBack && singleOverBudget ? (
              <div className="rounded-[--radius-panel] border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink">
                <p className="font-medium">{t.boms.sendBackForRevision}</p>
                <p className="mt-0.5 text-ink-muted">{t.boms.sendBackHint}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3">
              {showSendBack && singleOverBudget ? (
                <Button
                  type="button"
                  variant="secondary"
                  icon={<Undo2 aria-hidden className="size-4" />}
                  isLoading={sendBack.isPending}
                  onClick={() => {
                    setSendBackFor({
                      id: singleOverBudget.id,
                      no: singleOverBudget.no,
                    });
                    setSendBackReason('');
                  }}
                >
                  {t.boms.sendBackForRevision}
                </Button>
              ) : (
                <Button
                  type="button"
                  icon={<Send aria-hidden className="size-4" />}
                  isLoading={generate.isPending}
                  disabled={lines.length === 0}
                  onClick={onSubmit}
                >
                  {t.boms.generate}
                </Button>
              )}
            </div>
          </div>
        )}
      </QueryBoundary>

      <Dialog
        open={sendBackFor !== null}
        title={
          sendBackFor
            ? `${t.boms.sendBackDialog.title} · ${sendBackFor.no}`
            : t.boms.sendBackDialog.title
        }
        onClose={() => {
          if (sendBack.isPending) return;
          setSendBackFor(null);
          setSendBackReason('');
        }}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSendBackFor(null);
                setSendBackReason('');
              }}
              disabled={sendBack.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              icon={<Undo2 aria-hidden className="size-4" />}
              isLoading={sendBack.isPending}
              disabled={sendBackReason.trim().length < 3}
              onClick={onConfirmSendBack}
            >
              {t.boms.sendBackDialog.confirm}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{t.boms.sendBackDialog.body}</p>
          <TextAreaField
            label={t.boms.sendBackDialog.reasonLabel}
            hint={t.boms.sendBackDialog.reasonHint}
            value={sendBackReason}
            onChange={(event) => setSendBackReason(event.target.value)}
            rows={4}
          />
        </div>
      </Dialog>
    </div>
  );
}

function PickerRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: BomCandidate;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-muted/50">
      <Checkbox
        label=""
        checked={checked}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-xs text-ink-muted">
            {candidate.requisitionNo}
          </span>
          <span className="text-sm font-medium text-ink">
            {candidate.requesterName}
          </span>
          {candidate.departmentName ? (
            <span className="text-xs text-ink-subtle">
              {candidate.departmentName}
            </span>
          ) : null}
          {candidate.projectName ? (
            <span className="text-xs text-ink-subtle">
              · {candidate.projectName}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">
          {candidate.items.length}{' '}
          {candidate.items.length === 1 ? 'item' : 'items'}
          {' · '}
          <span className="tabular-nums text-ink">
            {(candidate.approvedAmount ?? 0).toLocaleString()}
          </span>{' '}
          {t.boms.approved}
        </p>
      </div>
    </label>
  );
}

function SourceGroup({
  requisitionNo,
  rows,
  indexOf,
  control,
  register,
  errors,
}: {
  requisitionNo: string;
  rows: BomGenerateLine[];
  indexOf: (line: BomGenerateLine) => number;
  control: ReturnType<typeof useForm<BomGenerateForm>>['control'];
  register: ReturnType<typeof useForm<BomGenerateForm>>['register'];
  errors:
    | Array<{
        quantity?: { message?: string };
        unitCost?: { message?: string };
        vendor?: { message?: string };
      }>
    | undefined;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={5}
          className="bg-surface-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted"
        >
          {requisitionNo}
        </td>
      </tr>
      {rows.map((line) => {
        const idx = indexOf(line);
        // The line total reflects the IM's quantity override. Removed lines total 0
        // because they don't enter the BOM — they're listed only for clarity.
        const lineTotal = line.removed
          ? 0
          : (line.unitCost ?? 0) * line.quantity;
        const rowErrors = errors?.[idx];
        return (
          <BomLineEditorRow
            key={`${line.requisitionItemId}-${idx}`}
            index={idx}
            control={control as never}
            register={register}
            itemName={line.itemName}
            sourceQuantity={line.sourceQuantity}
            removed={line.removed}
            lineTotal={lineTotal}
            errorQuantity={rowErrors?.quantity?.message}
            errorUnitCost={rowErrors?.unitCost?.message}
            errorVendor={rowErrors?.vendor?.message}
          />
        );
      })}
    </>
  );
}

function TotalsCell({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </p>
      <p
        className={
          emphasis
            ? 'text-lg font-semibold tabular-nums text-ink'
            : 'text-base tabular-nums text-ink'
        }
      >
        {value}
      </p>
    </div>
  );
}