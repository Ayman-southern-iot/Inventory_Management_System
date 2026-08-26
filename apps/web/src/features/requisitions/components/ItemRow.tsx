import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Controller, type Control, type UseFormRegister } from 'react-hook-form';
import type { Product, SaveRequisitionInput } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatBdt } from '@/lib/format';
import { QuantityField } from '@/features/inventory/components/QuantityField';
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
 * One requisition line.
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

  return (
    <div className="grid grid-cols-1 items-start gap-3 border-b border-border px-5 py-4 last:border-b-0 sm:grid-cols-12">
      <div className="relative sm:col-span-5">
        <TextField
          label={index === 0 ? t.requisitions.itemName : ''}
          hint={index === 0 ? t.requisitions.itemNameHint : undefined}
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
      </div>

      <div className="sm:col-span-2">
        <QuantityField
          control={control}
          name={`items.${index}.quantity` as const}
          label={index === 0 ? t.requisitions.quantity : ''}
          error={errors.quantity}
          min={1}
        />
      </div>

      <div className="sm:col-span-2">
        <Controller
          control={control}
          name={`items.${index}.estimatedUnitPrice` as const}
          render={({ field }) => (
            <TextField
              label={index === 0 ? t.requisitions.unitPrice : ''}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
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
      </div>

      <div className="sm:col-span-2 sm:pt-6">
        <p className="text-xs text-ink-subtle">{t.requisitions.lineTotal}</p>
        <p className="text-right tabular-nums font-medium text-ink">
          {lineTotal === null ? t.common.dash : formatBdt(lineTotal)}
        </p>
      </div>

      <div className="sm:col-span-1 sm:pt-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${t.requisitions.removeItem} ${index + 1}`}
          icon={<Trash2 aria-hidden className="size-4" />}
          onClick={onRemove}
          disabled={!canRemove}
        />
      </div>

      <div className="sm:col-span-12">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {linked ? (
            <>
              <span className="rounded-full bg-info-subtle px-2 py-0.5 text-info">
                {t.requisitions.fromCatalogue}
              </span>
              {/* Advisory, and deliberately not a blocker — the requester may need more than
                  we hold, or a second one. */}
              {linked.totalAvailable > 0 ? (
                <span className="text-success">
                  {t.requisitions.inStockHint.replace('{n}', String(linked.totalAvailable))} ·{' '}
                  <span className="text-ink-subtle">{t.requisitions.inStockAdvisory}</span>
                </span>
              ) : null}
            </>
          ) : (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-ink-muted">
              {t.requisitions.freeText}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

