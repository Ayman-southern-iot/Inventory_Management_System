import { useCallback, useMemo, useState } from 'react';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { isUnreachable, usePanelCatalogue } from '../api';
import { CabinetOverview } from '../components/CabinetOverview';
import { DrawerView } from '../components/DrawerView';
import { OnScreenKeyboard } from '@/components/ui/OnScreenKeyboard';
import { PanelNotice } from '../components/PanelNotice';
import { PanelSearchBar } from '../components/PanelSearchBar';
import { PanelStatusBanner } from '../components/PanelStatusBanner';
import { SearchResults } from '../components/SearchResults';
import { PANEL_IDLE_RESET_MS, PANEL_MAX_RESULTS, PANEL_SEARCH_DEBOUNCE_MS } from '../constants';
import { useIdleReset } from '../hooks/useIdleReset';
import { useSettledQuery } from '../hooks/useSettledQuery';
import { unmatchedUnits } from '../address';
import { panelLayout } from '../layout';
import { buildIndex, searchPanel, type StockRow } from '../search';

type View =
  /** The cabinet overview, or search results while there is a query. */
  | { kind: 'browse' }
  | {
      kind: 'unit';
      code: string;
      litAddress: string | null;
      selectedAddress: string | null;
      focusProductId: string | null;
    };

const BROWSE: View = { kind: 'browse' };

/**
 * `/panel`: "where is X?" on the lab's wall panel. Read-only by design — there is no control on
 * this screen that changes stock — and it never shows who holds anything (K2).
 */
export function PanelPage() {
  const [query, setQuery] = useState('');
  const [isKeyboardOpen, setKeyboardOpen] = useState(false);
  const [view, setView] = useState<View>(BROWSE);
  const settledQuery = useSettledQuery(query, PANEL_SEARCH_DEBOUNCE_MS);
  const catalogue = usePanelCatalogue();

  const index = useMemo(
    () => buildIndex(catalogue.data?.products ?? [], panelLayout),
    [catalogue.data],
  );
  const result = useMemo(
    () => searchPanel(index, panelLayout, settledQuery, PANEL_MAX_RESULTS),
    [index, settledQuery],
  );
  const unmatched = useMemo(
    () =>
      catalogue.data === undefined ? [] : unmatchedUnits(catalogue.data.locations, panelLayout),
    [catalogue.data],
  );
  const partCounts = useMemo(
    () => new Map([...index.rowsByAddress].map(([address, rows]) => [address, rows.length])),
    [index],
  );

  const reset = useCallback(() => {
    // Focus left in the field would swallow the next person's first tap (no focus event).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setQuery('');
    setKeyboardOpen(false);
    setView(BROWSE);
  }, []);
  useIdleReset(reset, PANEL_IDLE_RESET_MS);

  const edit = (next: string) => {
    setQuery(next);
    setView(BROWSE);
  };
  const openUnit = (code: string) => {
    setKeyboardOpen(false);
    setView({ kind: 'unit', code, litAddress: null, selectedAddress: null, focusProductId: null });
  };
  const openRow = (row: StockRow) => {
    const found = row.address === null ? undefined : panelLayout.cellByAddress.get(row.address);
    if (found === undefined) return;
    setKeyboardOpen(false);
    setView({
      kind: 'unit',
      code: found.unit.code,
      litAddress: row.address,
      selectedAddress: row.address,
      focusProductId: row.productId,
    });
  };

  const unreachable = isUnreachable(catalogue.error);
  const unit = view.kind === 'unit' ? panelLayout.unitByCode.get(view.code) : undefined;
  /** What to say where IMS data would be, before any has been read. */
  const notReadyMessage =
    catalogue.data !== undefined
      ? null
      : unreachable
        ? t.states.offlineTitle
        : catalogue.isError
          ? messageForError(catalogue.error)
          : t.panel.loading;

  let main;
  if (view.kind === 'unit' && unit !== undefined) {
    main = (
      <DrawerView
        drawer={unit}
        litAddress={view.litAddress}
        selectedAddress={view.selectedAddress}
        focusProductId={view.focusProductId}
        rowsByAddress={index.rowsByAddress}
        partCounts={partCounts}
        notReadyMessage={notReadyMessage}
        onSelectCell={(address) => setView({ ...view, selectedAddress: address })}
        onBack={() => setView(BROWSE)}
      />
    );
  } else if (settledQuery.trim() === '') {
    main = <CabinetOverview layout={panelLayout} unmatched={unmatched} onOpen={openUnit} />;
  } else if (catalogue.data !== undefined || result.drawers.length > 0) {
    // Drawers come from the plan, so a drawer code is answered even before IMS is read.
    main = <SearchResults result={result} onOpenDrawer={openUnit} onOpenRow={openRow} />;
  } else if (catalogue.isError && !unreachable) {
    main = (
      <PanelNotice
        message={messageForError(catalogue.error)}
        onRetry={() => void catalogue.refetch()}
        isAlert
      />
    );
  } else {
    // Unreachable with nothing cached yet: the banner above says why, this says what to expect.
    main = <PanelNotice message={unreachable ? t.states.offlineTitle : t.panel.loading} />;
  }

  return (
    <div
      data-panel-theme
      className="flex h-dvh flex-col overflow-hidden bg-canvas text-lg text-ink"
    >
      <h1 className="sr-only">{t.panel.pageTitle}</h1>
      <PanelSearchBar
        value={query}
        isKeyboardOpen={isKeyboardOpen}
        onChange={edit}
        onClear={() => edit('')}
        onToggleKeyboard={() => setKeyboardOpen((open) => !open)}
        onActivate={() => setKeyboardOpen(true)}
      />
      <PanelStatusBanner
        isUnreachable={unreachable}
        hasError={catalogue.isError}
        error={catalogue.error}
        dataUpdatedAt={catalogue.dataUpdatedAt}
      />
      <main className="flex min-h-0 flex-1 flex-col">{main}</main>
      {isKeyboardOpen ? (
        <OnScreenKeyboard
          onKey={(text) => edit(query + text)}
          onBackspace={() => edit(query.slice(0, -1))}
          onClear={() => edit('')}
        />
      ) : null}
    </div>
  );
}
