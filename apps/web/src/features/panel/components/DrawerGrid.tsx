import { type CSSProperties } from 'react';
import { t } from '@/i18n/en';
import { type PanelCell, type PanelDrawer } from '../layout';

interface DrawerGridProps {
  drawer: PanelDrawer;
  /** The cell a search sent the person to. */
  litAddress: string | null;
  /** The cell whose contents the side list shows. */
  selectedAddress: string | null;
  partCounts: ReadonlyMap<string, number>;
  onSelectCell: (address: string) => void;
}

/**
 * Geometry, not theme: the row and column counts come from the drawer plan, and Tailwind has no
 * class for a count only known at runtime.
 */
function gridStyle(drawer: PanelDrawer): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${drawer.cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${drawer.rows}, minmax(0, 1fr))`,
  };
}

function cellStyle(cell: PanelCell): CSSProperties {
  return {
    gridRow: `${cell.area.rowStart} / ${cell.area.rowEnd}`,
    gridColumn: `${cell.area.colStart} / ${cell.area.colEnd}`,
  };
}

function cellTone(isLit: boolean, isSelected: boolean): string {
  if (isLit) return 'border-brand bg-brand text-on-brand ring-4 ring-brand';
  if (isSelected) return 'border-brand bg-brand-subtle text-ink ring-2 ring-brand';
  return 'border-border-strong bg-surface text-ink';
}

/**
 * One drawer seen from above, back at the top and the handle at the bottom, the way it looks
 * when pulled open in front of you. Column A is on the left.
 */
export function DrawerGrid({
  drawer,
  litAddress,
  selectedAddress,
  partCounts,
  onSelectCell,
}: DrawerGridProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="text-center text-lg text-ink-muted">{t.panel.drawerBack}</p>
      <div className="grid min-h-0 flex-1 gap-2" style={gridStyle(drawer)}>
        {drawer.cells.map((cell) => {
          const isLit = cell.address === litAddress;
          const count = partCounts.get(cell.address) ?? 0;
          return (
            <button
              key={cell.address}
              type="button"
              data-address={cell.address}
              aria-current={isLit ? 'location' : undefined}
              aria-pressed={cell.address === selectedAddress}
              onClick={() => onSelectCell(cell.address)}
              style={cellStyle(cell)}
              className={`flex min-h-14 flex-col items-start justify-between overflow-hidden rounded-control border-2 p-2 text-left ${cellTone(isLit, cell.address === selectedAddress)}`}
            >
              <span className="text-xl font-bold">{cell.code}</span>
              <span className="line-clamp-2 text-lg leading-tight">{cell.purpose}</span>
              {count > 0 ? (
                <span className="text-lg font-semibold">{t.panel.partsInCell(count)}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="border-t-4 border-border-strong pt-1 text-center text-lg font-semibold text-ink">
        {t.panel.drawerFront}
      </p>
    </div>
  );
}
