import { useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { isUnreachable, usePanelCatalogue } from '@/features/panel/api';
import { unmatchedUnits } from '@/features/panel/address';
import { PanelStatusBanner } from '@/features/panel/components/PanelStatusBanner';
import { UnmatchedDrawersNotice } from '@/features/panel/components/UnmatchedDrawersNotice';
import { panelLayout } from '@/features/panel/layout';
import { buildIndex, searchPanel } from '@/features/panel/search';
import { useRoomModel } from '../api';
import { ROOM_MAX_RESULTS } from '../constants';
import { useRoomSelection, useRoomShortcuts } from '../hooks/useRoomSelection';
import { sceneFocusOf } from '../model';
import { buildRoomStock } from '../stock';
import { RoomDetails } from './RoomDetails';
import { RoomSearch, type RoomSearchChoice } from './RoomSearch';
import { RoomStage } from './RoomStage';

/** Set on the root once the first frame is drawn: the load-time measurement keys on it. */
export const ROOM_READY_MARK = 'room-first-frame';

/** `/room` on a wide screen: the 3D room with live stock, the panel's search, and the side list. */
export function RoomView() {
  const model = useRoomModel();
  const catalogue = usePanelCatalogue();
  const [query, setQuery] = useState('');
  const [isReady, setReady] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const products = catalogue.data?.products;
  const stock = useMemo(() => buildRoomStock(products ?? [], panelLayout), [products]);
  const index = useMemo(() => buildIndex(products ?? [], panelLayout), [products]);
  const result = useMemo(
    () => searchPanel(index, panelLayout, query, ROOM_MAX_RESULTS),
    [index, query],
  );

  const { selection, flightRequest, selectCell, selectDrawer, clearSelection, resetView } =
    useRoomSelection();
  useRoomShortcuts(searchRef, clearSelection);
  const focus = sceneFocusOf(selection, model.data);

  const choose = (choice: RoomSearchChoice) => {
    if (choice.kind === 'row' && choice.row.address === null) return;
    setQuery('');
    searchRef.current?.blur();
    if (choice.kind === 'row') selectCell(choice.row.address!);
    // An open shelf is one cell with nothing to open: select the cell itself.
    else if (panelLayout.shelves.includes(choice.drawer))
      selectCell(choice.drawer.cells[0]!.address);
    else selectDrawer(choice.drawer.code);
  };

  // A plan drawer with no zone in IMS would otherwise look empty; the panel says so, and so does this.
  const unmatched = useMemo(
    () =>
      catalogue.data === undefined ? [] : unmatchedUnits(catalogue.data.locations, panelLayout),
    [catalogue.data],
  );
  const unreachable = isUnreachable(catalogue.error);
  const notReadyMessage =
    catalogue.data !== undefined
      ? null
      : unreachable
        ? t.states.offlineTitle
        : catalogue.isError
          ? messageForError(catalogue.error)
          : t.panel.loading;

  return (
    <section
      data-room-theme
      data-room-ready={isReady ? 'true' : undefined}
      className="flex flex-col gap-3 rounded-panel border border-border bg-canvas p-3 text-ink"
    >
      <h1 className="sr-only">{t.room.pageTitle}</h1>
      <div className="flex items-center gap-3">
        <RoomSearch
          ref={searchRef}
          value={query}
          result={result}
          onChange={setQuery}
          onChoose={choose}
          onEscapeEmpty={clearSelection}
        />
        <Button
          variant="secondary"
          icon={<RotateCcw aria-hidden className="size-4" />}
          onClick={resetView}
        >
          {t.room.resetView}
        </Button>
      </div>
      <UnmatchedDrawersNotice units={unmatched} />
      <PanelStatusBanner
        isUnreachable={unreachable}
        hasError={catalogue.isError}
        error={catalogue.error}
        dataUpdatedAt={catalogue.dataUpdatedAt}
      />
      <div className="flex gap-3">
        <div className="relative aspect-4/3 min-w-0 flex-1 overflow-hidden rounded-control bg-surface">
          <RoomStage
            model={model.data}
            isPending={model.isPending}
            isError={model.isError}
            onRetry={() => void model.refetch()}
            focus={focus}
            flightRequest={flightRequest}
            stockedAddresses={stock.stockedAddresses}
            partsByDrawer={stock.partsByDrawer}
            onPick={(pick) =>
              pick.kind === 'cell' ? selectCell(pick.address) : selectDrawer(pick.code)
            }
            onReady={() => {
              performance.mark(ROOM_READY_MARK);
              setReady(true);
            }}
          />
        </div>
        <aside aria-label={t.room.pageTitle} className="relative w-80 shrink-0">
          <div className="absolute inset-0 overflow-y-auto pr-1">
            <RoomDetails
              selection={selection}
              stock={stock}
              notReadyMessage={notReadyMessage}
              onSelectCell={selectCell}
              onClose={clearSelection}
            />
          </div>
        </aside>
      </div>
    </section>
  );
}
