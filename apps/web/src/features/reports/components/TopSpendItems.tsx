import type { TopSpendItems as TopSpendItemsData } from '@ims/shared';
import { t } from '@/i18n/en';
import { formatBdt, formatQuantity } from '@/lib/format';

/**
 * What the money went on, ranked.
 *
 * Bars are scaled to the top row, so the list reads as "this one, then these" — against the total
 * every bar would be short and the ranking, which is the only thing this panel is for, would be
 * the hardest thing to see.
 */
export function TopSpendItems({ data }: { data: TopSpendItemsData }) {
  const { items } = data;
  const widest = items.reduce((max, item) => Math.max(max, item.spend), 0);

  if (items.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-ink-subtle">{t.expenses.topItemsEmpty}</p>;
  }

  return (
    <ol className="flex flex-col gap-3 px-4 pb-4">
      {items.map((item) => (
        <li key={item.productId ?? 'uncatalogued'}>
          <div className="flex items-baseline justify-between gap-4">
            <p className="truncate text-sm text-ink">
              {/* Null means the line was free text with no catalogue product behind it. The copy
                  lives here rather than in the query, which is why the API sends null. */}
              {item.name ?? t.expenses.topItemsUncatalogued}
            </p>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
              {formatBdt(item.spend)}
            </p>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-surface-muted">
              <div
                className="h-1.5 rounded-full bg-brand"
                style={{ width: widest > 0 ? `${(item.spend / widest) * 100}%` : '0%' }}
              />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-ink-subtle">
              {formatQuantity(item.quantity)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
