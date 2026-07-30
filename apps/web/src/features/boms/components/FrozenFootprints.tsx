import type { ApprovalFootprint, RequisitionFootprints } from '@ims/shared';
import { Table } from '@/components/ui/primitives';

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
          'Stage',
          'Slot',
          'Name',
          'Designation',
          'Acted at',
          'On behalf of',
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

function FootprintRow({ footprint }: { footprint: ApprovalFootprint }) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-sm text-ink">{footprint.stage}</td>
      <td className="px-4 py-2.5 tabular-nums text-sm text-ink-muted">
        {footprint.slot ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-sm font-medium text-ink">{footprint.name}</td>
      <td className="px-4 py-2.5 text-sm text-ink-muted">{footprint.designation}</td>
      <td className="px-4 py-2.5 text-sm text-ink-muted">
        {footprint.actedAt ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-sm text-ink-muted">
        {footprint.onBehalfOf ?? '—'}
      </td>
    </tr>
  );
}
