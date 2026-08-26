import type { BomLine, RequisitionFootprints } from '@ims/shared';
import { Table } from '@/components/ui/primitives';
import { t } from '@/i18n/en';
import { FrozenFootprints } from './FrozenFootprints';

/**
 * One source requisition on the BOM detail page.
 *
 * The line items are read-only — once the BOM is generated the IM only
 * renders, voids, or leaves them. The frozen approval chain sits below the
 * lines so the legal record is on the same screen.
 */
export function BomSourceSection({
  source,
  lines,
}: {
  source: RequisitionFootprints;
  lines: BomLine[];
}) {
  return (
    <section className="px-4 py-4">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-ink-muted">{source.requisitionNo}</span>
        <span className="text-sm font-medium text-ink">{source.requesterName}</span>
        {source.departmentName ? (
          <span className="text-xs text-ink-subtle">· {source.departmentName}</span>
        ) : null}
        {/*
          D-027. requirements §9's field table requires Linked project on the BOM, auto-filled
          from the request. The PDF carried it and `requisitionFootprintsSchema.projectName` is
          documented as "printed in the BOM header" — the header simply never rendered it, so the
          web BOM and the printed one disagreed about a REQUIRED field.

          Always shown, never hidden when null: no project means personal development (Ayman's
          ruling, 2026-08-26), which is an answer rather than a blank.
        */}
        <span className="text-xs text-ink-subtle">
          · {source.projectName ?? t.requisitions.noProject}
        </span>
        {source.approvedAmount !== null ? (
          <span className="ml-auto text-xs text-ink-muted">
            <span className="tabular-nums text-ink">
              {source.approvedAmount.toLocaleString()}
            </span>{' '}
            {t.boms.approved}
          </span>
        ) : null}
      </header>

      <Table
        headers={[
          'Item',
          'Qty',
          t.boms.unitCost,
          t.boms.lineTotal,
          t.boms.vendor,
          t.boms.purpose,
        ]}
      >
        {lines.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-4 py-3 text-center text-sm text-ink-subtle">
              —
            </td>
          </tr>
        ) : (
          lines.map((line) => (
            <tr key={line.id}>
              <td className="px-4 py-2.5 text-ink">
                <span className="font-medium">{line.itemName}</span>
                {line.projectName ? (
                  <span className="ml-2 text-xs text-ink-subtle">
                    · {line.projectName}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                {line.quantity}
              </td>
              <td className="px-4 py-2.5 tabular-nums text-ink">
                {line.unitCost.toLocaleString()}
              </td>
              <td className="px-4 py-2.5 tabular-nums text-ink">
                {line.totalCost.toLocaleString()}
              </td>
              <td className="px-4 py-2.5 text-ink-muted">
                {line.vendor ?? '—'}
              </td>
              <td className="px-4 py-2.5 text-ink-muted">
                {line.purpose ?? '—'}
              </td>
            </tr>
          ))
        )}
      </Table>

      {/* Per-source breakdown mirrors the printed PDF so IM/Accounts see the same numbers
          online as in the document they sign: transportation first (only when non-zero),
          then items subtotal, then total amount. The Transportation row carries the
          description as a right-aligned hint so the IM can read what the cost covered
          without leaving the table. */}
      <SourceTotals source={source} lines={lines} />

      <div className="mt-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t.boms.approvalChainHeading}
        </h4>
        <FrozenFootprints source={source} />
      </div>
    </section>
  );
}

/**
 * Per-source totals. The component exists so the breakdown can be tested in isolation —
 * the table above has too many cells to assert against, but the totals block has a small
 * fixed surface.
 */
function SourceTotals({
  source,
  lines,
}: {
  source: RequisitionFootprints;
  lines: BomLine[];
}) {
  const itemsSubtotal = lines.reduce((sum, line) => sum + line.totalCost, 0);
  const transportation = source.transportationCost ?? 0;
  const total = itemsSubtotal + transportation;
  const hasTransport = transportation > 0;

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-sm">
      {hasTransport ? (
        <TotalsRow
          label={t.boms.transportation}
          value={transportation}
          hint={source.transportationDescription ?? null}
          muted
        />
      ) : null}
      <TotalsRow label={t.boms.itemsSubtotal} value={itemsSubtotal} muted />
      <TotalsRow label={t.boms.totalAmount} value={total} emphasis />
    </div>
  );
}

function TotalsRow({
  label,
  value,
  hint = null,
  muted = false,
  emphasis = false,
}: {
  label: string;
  value: number;
  hint?: string | null;
  muted?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={muted ? 'text-ink-muted' : 'text-ink'}>
        {label}
        {hint ? (
          <span className="ml-2 text-xs italic text-ink-subtle">— {hint}</span>
        ) : null}
      </span>
      <span
        className={
          emphasis
            ? 'font-semibold tabular-nums text-ink'
            : muted
              ? 'tabular-nums text-ink-muted'
              : 'tabular-nums text-ink'
        }
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}
