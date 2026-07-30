import { type Control, Controller, type UseFormRegister } from 'react-hook-form';
import { TextField } from '@/components/ui/Field';
import { t } from '@/i18n/en';
import type { BomGenerateLine } from './types';

/**
 * One row of the BOM line editor. Two cells are editable — unit cost and vendor —
 * everything else is read-only because it is inherited from the source requisition.
 *
 * The `Controller` for `unitCost` coerces the empty string to `null` so the request
 * body matches the API (`z.number().nonnegative().max(...)`) without `NaN` slipping
 * through the wire.
 */
export interface BomLineEditorRowProps {
  index: number;
  control: Control<BomGenerateForm>;
  register: UseFormRegister<BomGenerateForm>;
  itemName: string;
  quantity: number;
  lineTotal: number;
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
  quantity,
  lineTotal,
  errorUnitCost,
  errorVendor,
}: BomLineEditorRowProps) {
  return (
    <tr className="align-top">
      <td className="px-4 py-2.5">
        <p className="font-medium text-ink">{itemName}</p>
        <p className="text-xs text-ink-subtle">
          × {quantity} · {t.boms.lineTotal}{' '}
          <span className="tabular-nums">{lineTotal.toLocaleString()}</span>
        </p>
      </td>
      <td className="px-4 py-2.5 tabular-nums text-ink-muted">{quantity}</td>
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
              error={errorUnitCost}
            />
          )}
        />
      </td>
      <td className="px-4 py-2.5">
        <TextField
          label={t.boms.vendor}
          {...register(`lines.${index}.vendor` as const)}
          error={errorVendor}
        />
      </td>
    </tr>
  );
}