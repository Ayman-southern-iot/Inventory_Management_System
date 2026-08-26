import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Controller, type Control, type UseFormRegister } from 'react-hook-form';
import type { Product, SaveRequisitionInput } from '@ims/shared';
import { CellInput } from '@/components/ui/Field';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatBdt } from '@/lib/format';
import { lineTotalOf } from '../lineTotal';

interface Props {
  index: number;
  control: Control<SaveRequisitionInput>;
  register: UseFormRegister<SaveRequisitionInput>;
  products: Product[];
  productId: string | null;
  itemName: string;
  quantity: number | undefined;
  unitPrice: number | undefined;
  onPickProduct: (product: Product | null) => void;
  onRemove: () => void;
  canRemove: boolean;
  errors: { itemName?: string; quantity?: string; estimatedUnitPrice?: string };
}

/**
 * One requisition line, as a real table row.
 *
 * It was a twelve-column grid where each cell carried its own `<label>`, blanked on every row
 * after the first. An empty label still occupies its line box, so rows two onward sat higher
 * than row one, and the line total and delete button needed `pt-6` nudges to look level. That is
 * what the reference design gets right by being a table: the column header is the label, once,
 * and every cell below it simply lines up.
 *
 * The catalogue is a *suggestion*, not a constraint: the requester types freely and picks a
 * product only if one matches. Requirements §3 is explicit that something we do not stock yet
 * must still be requestable, so `productId` stays null in that case and the name is kept.
 */
export function ItemRow({
  index,
  control,
  register,
  products,
  productId,
  itemName,
  quantity,
  unitPrice,
  onPickProduct,
  onRemove,
  canRemove,
  errors,
}: Props) {
  const [showSuggestions, setShowSuggestions] = useState(false);

  const matches = useMemo(() => {
    const term = itemName.trim().toLowerCase();
    if (term.length < 2) return [];
    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(term) ||
          product.productCode.toLowerCase().includes(term),
      )
      .slice(0, 6);
  }, [products, itemName]);

  const linked = productId ? products.find((product) => product.id === productId) : undefined;
  // null while the line is not costable — see lineTotalOf (D-017).
  const lineTotal = lineTotalOf(quantity, unitPrice);
  const rowLabel = String(index + 1);

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="py-2.5 pr-3 align-top">
        {/* `relative` on the cell, so the suggestion list is positioned against this column
            rather than the table. A `<td>` can hold a positioning context; the row cannot. */}
        <div className="relative">
          <CellInput
            label={`${t.requisitions.itemName} ${rowLabel}`}
            placeholder={t.requisitions.itemNamePlaceholder}
            error={errors.itemName}
            autoComplete="off"
            {...register(`items.${index}.itemName` as const, {
              onChange: () => {
                // Editing the text breaks the link to the catalogue entry — otherwise the
                // requisition would claim a product whose name no longer matches.
                if (productId) onPickProduct(null);
                setShowSuggestions(true);
              },
            })}
            onFocus={() => setShowSuggestions(true)}
            // A click on a suggestion has to land before the list closes.
            onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
          />

          {showSuggestions && matches.length > 0 ? (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-[--radius-control] border border-border bg-surface shadow-[--shadow-overlay]">
              {matches.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPickProduct(product);
                      setShowSuggestions(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted"
                  >
                    <span>
                      <span className="font-medium text-ink">{product.name}</span>
                      <span className="ml-2 font-mono text-xs text-ink-subtle">
                        {product.productCode}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'text-xs',
                        product.totalAvailable > 0 ? 'text-success' : 'text-ink-subtle',
                      )}
                    >
                      {product.totalAvailable} {product.unit}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Under the name, where it describes the thing above it. One line, so it cannot push
              the row's height around the way the old per-row hint did. */}
          <p className="mt-1 truncate text-xs">
            {linked ? (
              <span className="text-success">
                {t.requisitions.inStockHint.replace('{n}', String(linked.totalAvailable))}
              </span>
            ) : itemName.trim() ? (
              <span className="text-ink-subtle">{t.requisitions.freeText}</span>
            ) : null}
          </p>
        </div>
      </td>

      <td className="py-2.5 pr-3 align-top">
        <Controller
          control={control}
          name={`items.${index}.quantity` as const}
          render={({ field }) => (
            <CellInput
              label={`${t.requisitions.quantity} ${rowLabel}`}
              type="number"
              inputMode="numeric"
              min={1}
              step="1"
              placeholder="0"
              className="text-right font-mono tabular-nums"
              error={errors.quantity}
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={field.value === undefined || field.value === null ? '' : String(field.value)}
              onChange={(event) =>
                field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
              }
            />
          )}
        />
      </td>

      <td className="py-2.5 pr-3 align-top">
        <Controller
          control={control}
          name={`items.${index}.estimatedUnitPrice` as const}
          render={({ field }) => (
            <CellInput
              label={`${t.requisitions.unitPrice} ${rowLabel}`}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              className="text-right font-mono tabular-nums"
              error={errors.estimatedUnitPrice}
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={field.value === undefined || field.value === null ? '' : String(field.value)}
              onChange={(event) =>
                field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
              }
            />
          )}
        />
      </td>

      {/* Top-padded to sit on the inputs' baseline rather than the cell's top edge. */}
      <td className="whitespace-nowrap py-2.5 pr-2 pt-4 text-right align-top font-mono text-control font-semibold tabular-nums text-ink">
        {lineTotal === null ? t.common.dash : formatBdt(lineTotal)}
      </td>

      <td className="py-2.5 pt-3.5 align-top">
        <button
          type="button"
          aria-label={`${t.requisitions.removeItem} ${rowLabel}`}
          onClick={onRemove}
          disabled={!canRemove}
          className={cn(
            'flex size-8 items-center justify-center rounded-[--radius-control] text-ink-subtle',
            'hover:bg-danger-subtle hover:text-danger',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
            'disabled:hover:text-ink-subtle',
          )}
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </td>
    </tr>
  );
}
