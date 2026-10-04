import { t } from '@/i18n/en';
import { type PanelDrawer, type PanelLayout } from '../layout';

interface CabinetOverviewProps {
  layout: PanelLayout;
  onOpen: (unitCode: string) => void;
}

/**
 * The colour band painted on the physical drawer front. Data from the drawer plan, not a design
 * token: it has to match the drawer, in light and dark alike, so it is not themeable.
 */
function BandSwatch({ colour }: { colour: string | null }) {
  if (colour === null) return null;
  return (
    <span
      aria-hidden
      className="w-4 self-stretch rounded-l-control border-r border-border-strong"
      style={{ backgroundColor: colour }}
    />
  );
}

function UnitButton({ unit, onOpen }: { unit: PanelDrawer; onOpen: (code: string) => void }) {
  return (
    <button
      type="button"
      data-unit={unit.code}
      onClick={() => onOpen(unit.code)}
      className="flex min-h-20 flex-1 items-stretch rounded-control border border-border-strong bg-surface text-left text-ink active:bg-brand-subtle"
    >
      <BandSwatch colour={unit.bandColour} />
      <span className="flex min-w-0 flex-col justify-center gap-1 px-3 py-2">
        <span className="font-mono text-3xl font-bold">{unit.code}</span>
        <span className="line-clamp-2 text-lg leading-tight text-ink-muted">{unit.name}</span>
      </span>
    </button>
  );
}

/** Three cabinets of five drawers, plus the open shelves, as they stand in the lab. */
export function CabinetOverview({ layout, onOpen }: CabinetOverviewProps) {
  return (
    <div className="flex min-h-0 flex-1 gap-4 p-4">
      {layout.cabinets.map((cabinet) => (
        <section
          key={cabinet.id}
          aria-label={cabinet.name}
          className="flex min-w-0 flex-3 flex-col gap-2"
        >
          <h2 className="text-2xl font-bold text-ink">{cabinet.name}</h2>
          <p className="text-lg text-ink-muted">{cabinet.sub}</p>
          {cabinet.drawers.map((drawer) => (
            <UnitButton key={drawer.code} unit={drawer} onOpen={onOpen} />
          ))}
        </section>
      ))}
      {layout.shelves.length > 0 ? (
        <section aria-label={t.panel.openShelves} className="flex min-w-0 flex-2 flex-col gap-2">
          <h2 className="text-2xl font-bold text-ink">{t.panel.openShelves}</h2>
          {layout.shelves.map((shelf) => (
            <UnitButton key={shelf.code} unit={shelf} onOpen={onOpen} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
