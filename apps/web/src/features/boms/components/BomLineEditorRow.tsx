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
              // Empty input is treated as the source quantity so the IM does not have
              // to type the original value just to keep the row.
              value={field.value === sourceQuantity ? '' : String(field.value)}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === '') {
                  field.onChange(sourceQuantity);
                  return;
                }
                const parsed = Number(raw);
                if (Number.isFinite(parsed)) {
                  // Clamp to the source so the IM cannot exceed it. The wire zod schema
                  // also enforces this, but we keep the input controlled.
                  field.onChange(Math.max(1, Math.min(sourceQuantity, Math.floor(parsed))));
                }
              }}
              onBlur={field.onBlur}
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