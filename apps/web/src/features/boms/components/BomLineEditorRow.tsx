import { useState } from 'react';
import { type Control, Controller, type UseFormRegister } from 'react-hook-form';
import { Checkbox, TextField } from '@/components/ui/Field';
import { t } from '@/i18n/en';
import type { BomGenerateLine } from './types';

/**
 * One row of the BOM line editor. Four cells are editable — quantity (clamped to
 * [1, sourceQuantity]), unit cost, vendor, and a removed checkbox that drops the
 * line from the generated BOM.
 *
 * The `Controller` for `unitCost` coerces the empty string to `null` so the request
 * body matches the API (`z.number().nonnegative().max(...)`) without `NaN` slipping
 * through the wire. Same trick for `quantity` — the field is always an integer ≥ 1,
 * and an empty input is treated as the source quantity so the IM does not have to
 * touch a row just to keep it.
 *
 * That convention needs `quantityCleared`, and D-028 is what happens without it. The display
 * used to be derived from the value — empty whenever the value equalled the source — so typing
 * the source quantity blanked the box under the IM's cursor, and on a line whose source is 1
 * the only legal value was the one that cleared. The value cannot tell you whether the box is
 * empty, because it is the same number either way; only the IM having emptied it can. Blur
 * resets the flag, so a field left empty goes back to showing the figure that will be sent.
 *
 * Source `requisition_items.quantity` is never modified — these edits live only on the
 * BOM line. The office is small; the IM coordinates budget changes verbally.
 */
export interface BomLineEditorRowProps {
  index: number;
  control: Control<BomGenerateForm>;
  register: UseFormRegister<BomGenerateForm>;
  itemName: string;
  sourceQuantity: number;
  removed: boolean;
  lineTotal: number;
  errorQuantity?: string;
  errorUnitCost?: string;
  errorVendor?: string;
}

interface BomGenerateForm {
  lines: BomGenerateLine[];
}

export function BomLineEditorRow({
  index,
  control,
  register,
  itemName,
  sourceQuantity,
  removed,
  lineTotal,
  errorQuantity,
  errorUnitCost,
  errorVendor,
}: BomLineEditorRowProps) {
  // True only while the IM has actually emptied the quantity box — see the note above.
  const [quantityCleared, setQuantityCleared] = useState(false);
  return (
    <tr className={removed ? 'align-top opacity-50' : 'align-top'}>
      <td className="px-4 py-2.5">
        <p className="font-medium text-ink">{itemName}</p>
        <p className="text-xs text-ink-subtle">
          {t.boms.lineTotal}{' '}
          <span className="tabular-nums">{lineTotal.toLocaleString()}</span>
        </p>
      </td>
      <td className="px-4 py-2.5">
        <Controller
          control={control}
          name={`lines.${index}.quantity` as const}
          render={({ field }) => (
            <TextField
              label={t.boms.lineQuantityLabel}
              type="number"
              min={1}
              max={sourceQuantity}
              step={1}
              value={quantityCleared ? '' : String(field.value)}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === '') {
                  // Emptying the box still means "keep the source quantity" — the form
                  // carries it, and the box stays visibly empty until focus leaves.
                  setQuantityCleared(true);
                  field.onChange(sourceQuantity);
                  return;
                }
                setQuantityCleared(false);
                const parsed = Number(raw);
                if (Number.isFinite(parsed)) {
                  // Clamp to the source so the IM cannot exceed it. The wire zod schema
                  // also enforces this, but we keep the input controlled.
                  field.onChange(Math.max(1, Math.min(sourceQuantity, Math.floor(parsed))));
                }
              }}
              onBlur={() => {
                // Show what will actually be submitted, rather than leaving a blank box
                // over a real value.
                setQuantityCleared(false);
                field.onBlur();
              }}
              disabled={removed}
              error={errorQuantity}
              // The IM edits quantity per line and routinely forgets what the requisition
              // asked for. Read-only hint keeps the source figure visible next to the input
              // so the IM never has to flip back to the requisition form to double-check.
              hint={t.boms.lineSourceQuantityHint.replace('{qty}', String(sourceQuantity))}
            />
          )}
        />
      </td>
      <td className="px-4 py-2.5">
        <Controller
          control={control}
          name={`lines.${index}.unitCost` as const}
          render={({ field }) => (
            <TextField
              label={t.boms.unitCost}
              type="number"
              min={0}
              step="0.01"
              value={field.value === null ? '' : String(field.value)}
              onChange={(event) => {
                const raw = event.target.value;
                field.onChange(raw === '' ? null : Number(raw));
              }}
              onBlur={field.onBlur}
              disabled={removed}
              error={errorUnitCost}
            />
          )}
        />
      </td>
      <td className="px-4 py-2.5">
        <TextField
          label={t.boms.vendor}
          {...register(`lines.${index}.vendor` as const)}
          disabled={removed}
          error={errorVendor}
        />
      </td>
      <td className="px-4 py-2.5">
        <Checkbox
          label={t.boms.removeLineLabel}
          {...register(`lines.${index}.removed` as const)}
        />
      </td>
    </tr>
  );
}