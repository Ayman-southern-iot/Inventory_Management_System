import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { Controller, type Control, type UseFormRegister } from 'react-hook-form';
import type { Product, SaveRequisitionInput } from '@ims/shared';
import { CellInput } from '@/components/ui/Field';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatBdt } from '@/lib/format';
import { useAnchoredPosition } from '@/lib/useAnchoredPosition';
import { exactCatalogueMatch, nearestCatalogueMatch, rankMatches } from '@/lib/catalogueMatch';
import { lineTotalOf } from '../lineTotal';

/** The suggestion list matches the Item column, which is 44% of a max-w-6xl form. */
const SUGGESTION_WIDTH_PX = 420;

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
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const { anchorRef, popoverRef, position } = useAnchoredPosition<HTMLDivElement, HTMLUListElement>(
    open,
    SUGGESTION_WIDTH_PX,
  );

  /**
   * Every catalogue product, ranked — not a filtered slice of six.
   *
   * Opening on focus with no term shows the whole catalogue, which is what makes this behave like
   * a search box rather than a hint that appears if you guess enough characters. The list scrolls;
   * it is not truncated, because a silent cut is what D-002 was and it is also how someone
   * concludes we do not stock a thing and types their own name for it.
   *
   * Stock never filters. An item we hold none of is precisely the thing a requisition is for.
   */
  const matches = useMemo(() => rankMatches(products, itemName), [products, itemName]);

  /**
   * Gated on there being a term, not on the catalogue being non-empty.
   *
   * Nothing typed, nothing shown (Ayman, 2026-09-01). But a term that matches nothing still
   * opens the list, because that is where "nothing in the catalogue matches, it will be
   * requested as a new item" is said — and that sentence is the whole defence against somebody
   * concluding we do not stock a thing and inventing their own name for it.
   */
  const isOpen = open && itemName.trim().length > 0;

  /**
   * The catalogue entry the typed text is probably meant to be, while still unlinked.
   *
   * This is the Arduino case as Ayman put it: one person picks "Arduino Uno R3" from the list,
   * another types "arduino uno" and never opens it. Both mean one product; without this they
   * become two lines nothing can reconcile, on two requisitions, in two months' reporting.
   *
   * An *exact* name needs no suggestion — `commitOnBlur` links it outright. This is the near
   * miss, where only the requester can say whether they meant the R3.
   */
  const nearMatch = useMemo(
    () => (productId ? undefined : nearestCatalogueMatch(products, itemName)),
    [productId, products, itemName],
  );

  function select(product: Product) {
    onPickProduct(product);
    setOpen(false);
  }

  /**
   * Leaving the field settles it. An exact catalogue name is linked automatically, so the
   * duplicate never reaches the server — the requester does not have to know the list existed,
   * only to have typed the right name.
   *
   * Deferred, because blur fires before a click on the list lands. `onMouseDown` on the options
   * handles the click itself; this timeout is what lets the two coexist.
   */
  function commitOnBlur() {
    window.setTimeout(() => {
      setOpen(false);
      if (!productId) {
        const exact = exactCatalogueMatch(products, itemName);
        if (exact) onPickProduct(exact);
      }
    }, 150);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!isOpen || matches.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => (current + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      // Only swallowed when a suggestion is actually highlighted, so Enter still submits the
      // form when the list is not being used.
      const picked = matches[highlighted];
      if (picked) {
        event.preventDefault();
        select(picked);
      }
    }
  }

  const linked = productId ? products.find((product) => product.id === productId) : undefined;
  // null while the line is not costable — see lineTotalOf (D-017).
  const lineTotal = lineTotalOf(quantity, unitPrice);
  const rowLabel = String(index + 1);

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="py-2.5 pr-3 align-top">
        <div ref={anchorRef}>
          <CellInput
            label={`${t.requisitions.itemName} ${rowLabel}`}
            placeholder={t.requisitions.itemNamePlaceholder}
            error={errors.itemName}
            autoComplete="off"
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            aria-controls={isOpen ? listId : undefined}
            aria-activedescendant={
              isOpen && highlighted >= 0 ? `${listId}-option-${highlighted}` : undefined
            }
            {...register(`items.${index}.itemName` as const, {
              onChange: () => {
                // Editing the text breaks the link to the catalogue entry — otherwise the
                // requisition would claim a product whose name no longer matches.
                if (productId) onPickProduct(null);
                setOpen(true);
                setHighlighted(0);
              },
            })}
            // Opens on focus, before a character is typed: the catalogue is the point of this
            // field, and a list you have to earn is one people give up on and free-type instead.
            onFocus={() => {
              setOpen(true);
              setHighlighted(0);
            }}
            onKeyDown={onKeyDown}
            onBlur={commitOnBlur}
          />

          {/* Portalled for the same reason as the date picker: `Panel` is `overflow-hidden`, so
              a list rendered inside the card is clipped by it. */}
          {isOpen
            ? createPortal(
                <ul
                  ref={popoverRef}
                  id={listId}
                  role="listbox"
                  aria-label={t.requisitions.itemName}
                  style={{
                    top: position?.top ?? 0,
                    left: position?.left ?? 0,
                    width: anchorRef.current?.offsetWidth,
                  }}
                  className={cn(
                    'fixed z-50 max-h-64 overflow-y-auto rounded-[--radius-control] border',
                    'border-border bg-surface py-1 shadow-[--shadow-overlay]',
                    position ? 'visible' : 'invisible',
                  )}
                >
                  {matches.map((product, matchIndex) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        id={`${listId}-option-${matchIndex}`}
                        role="option"
                        aria-selected={matchIndex === highlighted}
                        // `onMouseDown` and not `onClick`: the input's blur fires first
                        // otherwise, and the list is gone before the click lands.
                        onMouseDown={(event) => {
                          event.preventDefault();
                          select(product);
                        }}
                        onMouseEnter={() => setHighlighted(matchIndex)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                          matchIndex === highlighted && 'bg-brand-subtle',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{product.name}</span>
                          <span className="ml-2 font-mono text-xs text-ink-subtle">
                            {product.productCode}
                          </span>
                        </span>
                        {/* Stock is shown but never filters the list: an item we hold none of is
                            exactly the thing someone needs to raise a requisition for. */}
                        <span
                          className={cn(
                            'shrink-0 text-xs',
                            product.totalAvailable > 0 ? 'text-success' : 'text-ink-subtle',
                          )}
                        >
                          {product.totalAvailable > 0
                            ? `${product.totalAvailable} ${product.unit}`
                            : t.requisitions.outOfStock}
                        </span>
                      </button>
                    </li>
                  ))}

                  {matches.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-ink-subtle">
                      {t.requisitions.noCatalogueMatch}
                    </li>
                  ) : null}
                </ul>,
                document.body,
              )
            : null}

          {/* One line under the name, describing the thing above it. */}
          <p className="mt-1 truncate text-xs">
            {linked ? (
              <span className="text-success">
                {linked.totalAvailable > 0
                  ? t.requisitions.inStockHint.replace('{n}', String(linked.totalAvailable))
                  : t.requisitions.linkedOutOfStock}
              </span>
            ) : nearMatch ? (
              /* The duplicate guard. Someone typing "arduino uno r3" freehand when the catalogue
                 already holds "Arduino Uno R3" is how one product becomes three, and an exact
                 match is linked automatically on blur — so this only appears for a genuine near
                 miss, where the decision has to be the requester's. */
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  select(nearMatch);
                }}
                className="truncate text-pending underline decoration-dotted underline-offset-2"
              >
                {t.requisitions.didYouMean.replace('{name}', nearMatch.name)}
              </button>
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
              className="tabular-nums"
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
              className="tabular-nums"
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
      <td className="whitespace-nowrap py-2.5 pr-2 pt-4 text-right align-top text-sm font-medium tabular-nums text-ink">
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
