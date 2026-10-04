import { ArrowLeft } from 'lucide-react';
import { t } from '@/i18n/en';
import { type PanelDrawer } from '../layout';
import { type StockRow } from '../search';
import { CellContents } from './CellContents';
import { DrawerGrid } from './DrawerGrid';

interface DrawerViewProps {
  drawer: PanelDrawer;
  litAddress: string | null;
  selectedAddress: string | null;
  focusProductId: string | null;
  rowsByAddress: ReadonlyMap<string, StockRow[]>;
  partCounts: ReadonlyMap<string, number>;
  onSelectCell: (address: string) => void;
  onBack: () => void;
}

/** One drawer's grid on the left, the chosen cell's contents on the right. */
export function DrawerView({
  drawer,
  litAddress,
  selectedAddress,
  focusProductId,
  rowsByAddress,
  partCounts,
  onSelectCell,
  onBack,
}: DrawerViewProps) {
  return (
    <div className="flex min-h-0 flex-1 gap-4 p-4">
      <div className="flex min-h-0 min-w-0 flex-3 flex-col gap-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="flex h-14 items-center gap-2 rounded-control border border-border-strong bg-surface px-4 text-xl text-ink"
          >
            <ArrowLeft aria-hidden className="size-7" />
            {t.panel.backToOverview}
          </button>
          {drawer.bandColour === null ? null : (
            <span
              aria-hidden
              className="size-10 shrink-0 rounded-control border border-border-strong"
              // The drawer front's colour band: data from the plan, not a theme token.
              style={{ backgroundColor: drawer.bandColour }}
            />
          )}
          <h1 className="min-w-0 truncate text-3xl font-bold text-ink">
            <span className="font-mono">{drawer.code}</span> · {drawer.name}
          </h1>
        </div>
        <DrawerGrid
          drawer={drawer}
          litAddress={litAddress}
          selectedAddress={selectedAddress}
          partCounts={partCounts}
          onSelectCell={onSelectCell}
        />
      </div>
      <aside className="flex min-h-0 min-w-0 flex-2 flex-col border-l border-border pl-4">
        <CellContents
          address={selectedAddress}
          rows={selectedAddress === null ? [] : (rowsByAddress.get(selectedAddress) ?? [])}
          focusProductId={focusProductId}
        />
      </aside>
    </div>
  );
}
