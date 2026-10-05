import type { ApprovalFootprint, RequisitionFootprints } from '@ims/shared';
import { Table } from '@/components/ui/primitives';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';

/**
 * The approval chain as captured when the BOM was generated.
 *
 * Every row is a snapshot: the name, designation, acted-at timestamp, and
 * "on behalf of" delegate are all copied from the approval row at generation
 * time. A rename tomorrow does not touch a BOM printed yesterday — the
 * signature block on the PDF matches this table byte-for-byte.
 */
export function FrozenFootprints({ source }: { source: RequisitionFootprints }) {
  return (
    <div>
      <Table
        headers={[
          t.boms.footprintHeaders.stage,
          t.boms.footprintHeaders.slot,
          t.boms.footprintHeaders.name,
          t.boms.footprintHeaders.designation,
          t.boms.footprintHeaders.actedAt,
          t.boms.footprintHeaders.onBehalfOf,
        ]}
      >
        {source.footprints.length === 0 ? (
          <tr>
            <td
              colSpan={6}
              className="px-4 py-3 text-center text-sm text-ink-subtle"
            >
              —
            </td>
          </tr>
        ) : (
          source.footprints.map((footprint, index) => (
            <FootprintRow key={`${footprint.stage}-${footprint.slot ?? 'x'}-${index}`} footprint={footprint} />
          ))
        )}
      </Table>
    </div>
  );
}

/** The stage in words; an unrecognised one is shown as it came rather than hidden. */
function stageLabel(stage: string): string {
  const stages = t.requisitions.stage as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(stages, stage) ? stages[stage]! : stage;
}

function FootprintRow({ footprint }: { footprint: ApprovalFootprint }) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-sm text-ink">{stageLabel(footprint.stage)}</td>
      <td className="px-4 py-2.5 tabular-nums text-sm text-ink-muted">
        {footprint.slot ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-sm font-medium text-ink">{footprint.name}</td>
      <td className="px-4 py-2.5 text-sm text-ink-muted">{footprint.designation}</td>
      <td className="px-4 py-2.5 text-sm text-ink-muted">
        {footprint.actedAt ? formatDateTime(footprint.actedAt) : '—'}
      </td>
      <td className="px-4 py-2.5 text-sm text-ink-muted">
        {footprint.onBehalfOf ?? '—'}
      </td>
    </tr>
  );
}
