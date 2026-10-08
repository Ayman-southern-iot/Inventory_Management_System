import { t } from '@/i18n/en';
import { type StockRow } from '../search';

interface CellContentsProps {
  address: string | null;
  rows: StockRow[];
  /** The part a search came for, marked in the list. */
  focusProductId: string | null;
  /** Why IMS's side cannot be shown yet (loading, offline). An unread cell is not an empty one. */
  notReadyMessage: string | null;
}

/** What IMS says is in one cell. Quantities only; never who has taken any of it. */
export function CellContents({
  address,
  rows,
  focusProductId,
  notReadyMessage,
}: CellContentsProps) {
  if (address === null) {
    return <p className="p-4 text-lg text-ink-muted">{t.panel.pickCell}</p>;
  }
  return (
    <section aria-labelledby="panel-cell-title" className="flex min-h-0 flex-col gap-3">
      <h2 id="panel-cell-title" className="font-mono text-4xl font-bold text-ink">
        {t.panel.cellContentsTitle(address)}
      </h2>
      {notReadyMessage !== null ? (
        <p className="text-lg text-ink-muted">{notReadyMessage}</p>
      ) : rows.length === 0 ? (
        <p className="text-lg text-ink-muted">{t.panel.cellEmpty}</p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {rows.map((row) => (
            <li
              key={row.key}
              aria-current={row.productId === focusProductId ? 'true' : undefined}
              className={`flex items-center justify-between gap-3 rounded-control border p-3 ${row.productId === focusProductId ? 'border-brand bg-brand-subtle' : 'border-border bg-surface'}`}
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-xl font-semibold text-ink">{row.name}</span>
                <span className="text-lg text-ink-muted">{row.code}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="text-2xl font-bold text-ink">{t.panel.onHand(row.quantity)}</span>
                <span className="text-lg text-ink-muted">{t.panel.free(row.available)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
