import { AlertTriangle } from 'lucide-react';
import { t } from '@/i18n/en';
import { type PanelDrawer } from '../layout';

/**
 * Plan drawers with no matching zone in IMS (OQ-P2: right room, zone named by the drawer code).
 * Said out loud, because otherwise such a drawer just looks empty and the panel looks wrong.
 */
export function UnmatchedDrawersNotice({ units }: { units: readonly PanelDrawer[] }) {
  if (units.length === 0) return null;
  return (
    <p
      role="note"
      className="flex items-center gap-3 rounded-control border border-pending bg-pending-subtle px-4 py-2 text-lg text-ink"
    >
      <AlertTriangle aria-hidden className="size-7 shrink-0 text-pending" />
      {t.panel.unmatchedDrawers(units.length, units.map((unit) => unit.code).join(', '))}
    </p>
  );
}
