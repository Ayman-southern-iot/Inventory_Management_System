import { X } from 'lucide-react';
import { t } from '@/i18n/en';
import { panelLayout } from '@/features/panel/layout';
import type { RoomSelection } from '../model';
import type { RoomStock } from '../stock';
import { RoomCellContents } from './RoomCellContents';

interface RoomDetailsProps {
  selection: RoomSelection;
  stock: RoomStock;
  notReadyMessage: string | null;
  onSelectCell: (address: string) => void;
  onClose: () => void;
}

function Heading({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="font-mono text-2xl font-bold text-ink">{title}</h2>
        <p className="text-sm text-ink-muted">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t.room.close}
        className="rounded-control p-1 text-ink-muted hover:bg-surface-muted hover:text-ink"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** The side list: what is in the selected cell, or which cells of the selected drawer hold parts. */
export function RoomDetails({
  selection,
  stock,
  notReadyMessage,
  onSelectCell,
  onClose,
}: RoomDetailsProps) {
  if (selection === null) {
    return (
      <div className="flex flex-col gap-2 text-sm text-ink-muted">
        <p>{t.room.idle}</p>
        {stock.unmatchedShelves > 0 ? (
          <p>{t.room.unmatchedShelves(stock.unmatchedShelves)}</p>
        ) : null}
      </div>
    );
  }
  if (selection.kind === 'unknown') {
    return (
      <p role="alert" className="text-sm text-ink">
        {t.room.unknownCell(selection.value)}
      </p>
    );
  }
  if (selection.kind === 'cell') {
    const found = panelLayout.cellByAddress.get(selection.address);
    const isShelf = found !== undefined && panelLayout.shelves.includes(found.unit);
    return (
      <section
        aria-label={t.panel.cellContentsTitle(selection.address)}
        className="flex flex-col gap-3"
      >
        <Heading title={selection.address} subtitle={found?.unit.name ?? ''} onClose={onClose} />
        {isShelf ? <p className="text-sm text-ink-muted">{t.room.openShelf}</p> : null}
        <RoomCellContents
          rows={stock.byAddress.get(selection.address) ?? []}
          notReadyMessage={notReadyMessage}
        />
      </section>
    );
  }

  const drawer = panelLayout.unitByCode.get(selection.code);
  const cells = (drawer?.cells ?? []).filter((cell) => stock.byAddress.has(cell.address));
  return (
    <section
      aria-label={t.room.drawerTitle(selection.code, drawer?.name ?? '')}
      className="flex flex-col gap-3"
    >
      <Heading title={selection.code} subtitle={drawer?.name ?? ''} onClose={onClose} />
      {notReadyMessage !== null ? (
        <p className="text-sm text-ink-muted">{notReadyMessage}</p>
      ) : cells.length === 0 ? (
        <p className="text-sm text-ink-muted">{t.room.drawerEmpty}</p>
      ) : (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {t.room.drawerCells}
          </h3>
          <ul className="flex flex-col gap-1">
            {cells.map((cell) => (
              <li key={cell.address}>
                <button
                  type="button"
                  onClick={() => onSelectCell(cell.address)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-control border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-surface-muted"
                >
                  <span className="font-mono font-semibold text-ink">{cell.address}</span>
                  <span className="text-ink-muted">
                    {t.panel.partsInCell(stock.byAddress.get(cell.address)?.length ?? 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
