import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RequisitionFootprints } from '@ims/shared';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';
import { FrozenFootprints } from './FrozenFootprints';

/**
 * Audit F7. The approval chain on a BOM showed the stage as a raw enum (`INVENTORY_MANAGER`) and
 * the time as a raw UTC instant (`2026-10-04T06:47:40.389Z`), where the rest of the app says
 * "Inventory Manager" and "Oct 4, 2026, 12:47 PM". Its column headers were also typed into the JSX.
 */
const ACTED_AT = '2026-10-04T06:47:40.389Z';

const SOURCE = {
  requisitionId: 'r-1',
  requisitionNo: 'REQ-000001',
  footprints: [
    { stage: 'INVENTORY_MANAGER', slot: null, name: 'Imran Manager', designation: 'Inventory Manager', actedAt: ACTED_AT, onBehalfOf: null },
    { stage: 'APPROVER', slot: 1, name: 'Ayesha Approver', designation: 'Head of Operations', actedAt: null, onBehalfOf: 'Farhan Finance' },
  ],
} as unknown as RequisitionFootprints;

describe('FrozenFootprints', () => {
  it('names the stage in words, not as an enum', () => {
    render(<FrozenFootprints source={SOURCE} />);
    expect(screen.getAllByText(t.requisitions.stage.INVENTORY_MANAGER).length).toBeGreaterThan(0);
    expect(screen.getByText(t.requisitions.stage.APPROVER)).toBeInTheDocument();
    expect(screen.queryByText('INVENTORY_MANAGER')).toBeNull();
    expect(screen.queryByText('APPROVER')).toBeNull();
  });

  it('formats the time like every other time in the app, not as a raw instant', () => {
    render(<FrozenFootprints source={SOURCE} />);
    expect(screen.getByText(formatDateTime(ACTED_AT))).toBeInTheDocument();
    expect(screen.queryByText(ACTED_AT)).toBeNull();
    expect(screen.queryByText(/T06:47/)).toBeNull();
  });

  it('shows a dash where nobody has acted, and the delegate where one did', () => {
    render(<FrozenFootprints source={SOURCE} />);
    expect(screen.getByText('Farhan Finance')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('takes its column headers from the copy file', () => {
    render(<FrozenFootprints source={SOURCE} />);
    for (const header of Object.values(t.boms.footprintHeaders)) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });
});
