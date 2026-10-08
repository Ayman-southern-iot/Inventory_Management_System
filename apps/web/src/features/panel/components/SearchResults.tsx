import { t } from '@/i18n/en';
import { type SearchResult, type StockRow } from '../search';

interface SearchResultsProps {
  result: SearchResult;
  onOpenDrawer: (unitCode: string) => void;
  onOpenRow: (row: StockRow) => void;
}

function StockResult({ row, onOpen }: { row: StockRow; onOpen: (row: StockRow) => void }) {
  const isOnPlan = row.address !== null;
  const where = row.address ?? (row.imsLabel === '' ? t.panel.notOnShelf : row.imsLabel);
  return (
    <li>
      <button
        type="button"
        data-address={row.address ?? undefined}
        disabled={!isOnPlan}
        onClick={() => onOpen(row)}
        className="flex min-h-20 w-full items-center justify-between gap-4 rounded-control border border-border-strong bg-surface px-4 py-2 text-left text-ink active:bg-brand-subtle disabled:border-border disabled:bg-surface-muted"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xl font-semibold">{row.name}</span>
          <span className="truncate text-lg text-ink-muted">{row.code}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className={isOnPlan ? 'font-mono text-4xl font-bold' : 'text-lg text-ink-muted'}>
            {where}
          </span>
          {isOnPlan || row.imsLabel !== '' ? (
            <span className="text-lg text-ink-muted">{t.panel.onHand(row.quantity)}</span>
          ) : null}
          {!isOnPlan && row.imsLabel !== '' ? (
            <span className="text-lg text-ink-muted">{t.panel.notOnPlan}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/** Drawers first, when the query names one, then every shelf a matching part sits on. */
export function SearchResults({ result, onOpenDrawer, onOpenRow }: SearchResultsProps) {
  if (result.drawers.length === 0 && result.rows.length === 0) {
    return <p className="p-6 text-center text-2xl text-ink-muted">{t.panel.noMatch}</p>;
  }
  return (
    <ul
      aria-label={t.panel.resultsLabel}
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4"
    >
      {result.drawers.map((drawer) => (
        <li key={drawer.code}>
          <button
            type="button"
            data-unit={drawer.code}
            onClick={() => onOpenDrawer(drawer.code)}
            className="flex min-h-20 w-full items-center justify-between gap-4 rounded-control border-2 border-brand bg-brand-subtle px-4 py-2 text-left text-ink"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-lg text-ink-muted">{t.panel.drawerResult}</span>
              <span className="truncate text-xl font-semibold">{drawer.name}</span>
            </span>
            <span className="font-mono text-4xl font-bold">{drawer.code}</span>
          </button>
        </li>
      ))}
      {result.rows.map((row) => (
        <StockResult key={row.key} row={row} onOpen={onOpenRow} />
      ))}
      {result.hiddenCount > 0 ? (
        <li className="p-2 text-center text-lg text-ink-muted">
          {t.panel.moreResults(result.hiddenCount)}
        </li>
      ) : null}
    </ul>
  );
}
