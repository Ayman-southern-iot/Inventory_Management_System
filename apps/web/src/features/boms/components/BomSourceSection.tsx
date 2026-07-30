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
          'Purpose',
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

      <div className="mt-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t.boms.approvalChainHeading}
        </h4>
        <FrozenFootprints source={source} />
      </div>
    </section>
  );
}
