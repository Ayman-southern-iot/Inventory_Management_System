import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import {
  type BomCandidate,
  type GenerateBomInput,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Field';
import { PageHeader, Panel } from '@/components/ui/primitives';
import {
  EmptyState,
  QueryBoundary,
} from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { ROUTES } from '@/routes/paths';
import { useGenerateBom, useBomCandidates } from './api';
import { BomLineEditorRow } from './components/BomLineEditorRow';
import {
  type BomGenerateLine,
  linesFromCandidate,
} from './components/types';

interface BomGenerateForm {
  lines: BomGenerateLine[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The IM's BOM creation flow:
 *
 *  1. The picker (zone 1) lists every approved requisition not on a live BOM. Ticking
 *     pulls its lines into the editor (zone 2).
 *  2. The editor (zone 2) shows one row per line, grouped by source. Two cells are
 *     editable — unit cost and vendor — everything else is inherited.
 *  3. The totals footer tracks approved / subtotal / variance live. If subtotal goes
 *     past the tolerance ceiling, the variance badge switches to danger and a one-
 *     line warning replaces the placeholder text. Submitting still sends the form —
 *     the API bounces it back with 409 BOM_OVER_BUDGET, and the screen stays so the
 *     IM can adjust.
 *
 * After a successful generate, the response is the new BOM detail; we navigate to it
 * so the IM lands on the detail page where rendering + downloading the PDF live.
 */
export function BomGeneratePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const candidates = useBomCandidates();
  const generate = useGenerateBom();

  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());

  const form = useForm<BomGenerateForm>({
    defaultValues: { lines: [] },
  });
  const { control, register, reset, watch } = form;
  const fieldArray = useFieldArray({ control, name: 'lines' });

  const lines = watch('lines');

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
        (sum, line) => sum + (line?.unitCost ?? 0) * (line?.quantity ?? 0),
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

  // The plan does not call for fetching the tolerance from the API here — the API itself
  // enforces it. The UI shows a static 10% (the product default) so the IM gets a
  // visual heads-up before submitting. A future setting-aware banner can read this
  // from the settings page.
  const TOLERANCE_PCT = 10;
  const ceiling = round2(approvedTotal * (1 + TOLERANCE_PCT / 100));
  const overTolerance =
    approvedTotal > 0 && round2(subtotal) > ceiling;

  function toggleCandidate(candidate: BomCandidate, checked: boolean) {
    setPickedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(candidate.requisitionId);
      else next.delete(candidate.requisitionId);
      return next;
    });
  }

  async function onSubmit() {
    const present = (lines ?? []).filter((line) => line.unitCost !== null);
    if (present.length === 0) return;

    const payload: GenerateBomInput = {
      requisitionIds: Array.from(new Set(present.map((line) => line.requisitionId))),
      lines: present.map((line) => ({
        requisitionItemId: line.requisitionItemId,
        unitCost: line.unitCost ?? 0,
        vendor: line.vendor,
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
                          errors={form.formState.errors.lines as Array<{ unitCost?: { message?: string }; vendor?: { message?: string } }> | undefined}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <footer className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-border px-4 py-3 sm:grid-cols-4">
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
                    label={t.boms.ceiling.replace('{pct}', String(TOLERANCE_PCT))}
                    value={ceiling.toLocaleString()}
                  />
                  <TotalsCell
                    label={t.boms.variance}
                    value={`${(round2(subtotal) - approvedTotal).toLocaleString()} (${
                      approvedTotal === 0
                        ? 'n/a'
                        : `${(((round2(subtotal) - approvedTotal) / approvedTotal) * 100).toFixed(1)}%`
                    })`}
                    danger={overTolerance}
                  />
                </footer>
                {overTolerance ? (
                  <p
                    role="alert"
                    className="border-t border-border bg-danger-subtle px-4 py-2 text-xs text-danger"
                  >
                    {t.boms.bounceWarning}
                  </p>
                ) : null}
              </Panel>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                type="button"
                icon={<Send aria-hidden className="size-4" />}
                isLoading={generate.isPending}
                disabled={lines.length === 0}
                onClick={onSubmit}
              >
                {t.boms.generate}
              </Button>
            </div>
          </div>
        )}
      </QueryBoundary>
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
    | Array<{ unitCost?: { message?: string }; vendor?: { message?: string } }>
    | undefined;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={4}
          className="bg-surface-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted"
        >
          {requisitionNo}
        </td>
      </tr>
      {rows.map((line) => {
        const idx = indexOf(line);
        const lineTotal = (line.unitCost ?? 0) * line.quantity;
        const rowErrors = errors?.[idx];
        return (
          <BomLineEditorRow
            key={`${line.requisitionItemId}-${idx}`}
            index={idx}
            control={control as never}
            register={register}
            itemName={line.itemName}
            quantity={line.quantity}
            lineTotal={lineTotal}
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
  danger = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  danger?: boolean;
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
            : danger
              ? 'text-base font-semibold tabular-nums text-danger'
              : 'text-base tabular-nums text-ink'
        }
      >
        {value}
      </p>
    </div>
  );
}

