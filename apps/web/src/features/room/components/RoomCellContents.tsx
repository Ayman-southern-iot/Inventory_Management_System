import { t } from '@/i18n/en';
import type { RoomStockRow } from '../stock';

interface RoomCellContentsProps {
  rows: RoomStockRow[];
  /** Why IMS's side cannot be shown yet (loading, offline). An unread cell is not an empty one. */
  notReadyMessage: string | null;
}

/** What IMS says is in one cell: quantities, the plan code and the printed storage ID. No names. */
export function RoomCellContents({ rows, notReadyMessage }: RoomCellContentsProps) {
  if (notReadyMessage !== null) return <p className="text-sm text-ink-muted">{notReadyMessage}</p>;
  if (rows.length === 0) return <p className="text-sm text-ink-muted">{t.panel.cellEmpty}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex flex-col gap-1 rounded-control border border-border bg-surface p-3"
        >
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 font-semibold text-ink">{row.name}</span>
            <span className="shrink-0 font-semibold text-ink">{t.panel.onHand(row.quantity)}</span>
          </span>
          <span className="flex items-baseline justify-between gap-3 text-sm text-ink-muted">
            <span className="min-w-0 truncate">{row.code}</span>
            <span className="shrink-0">{t.panel.free(row.available)}</span>
          </span>
          <dl className="grid grid-cols-2 gap-x-3 text-xs text-ink-muted">
            <div>
              <dt>{t.room.planCode}</dt>
              <dd className="font-mono text-ink">{row.address}</dd>
            </div>
            <div>
              <dt>{t.room.storageId}</dt>
              <dd className="font-mono text-ink">{row.storageId}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
