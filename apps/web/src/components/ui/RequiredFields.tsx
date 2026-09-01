import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ZodTypeAny } from 'zod';
import { requiredFields } from '@/lib/required-fields';

const RequiredFieldsContext = createContext<ReadonlySet<string> | null>(null);

/**
 * Marks every control inside it that its schema will refuse empty.
 *
 * The alternative was `required` on each field by hand, across the two dozen forms this app
 * has. That is not a one-off cost: it is a list that has to be revisited every time a contract
 * changes, and the failure is silent in the direction that matters — a field quietly stops being
 * marked while the API still rejects it, and the user finds out on submit.
 *
 * So the schema answers instead. Wrap the form once, and each control looks itself up by the
 * `name` react-hook-form already gives it. An explicit `required` prop still wins, for the
 * handful of fields whose requirement is conditional on something the schema cannot see — the
 * reversal reason in the funds dialog is mandatory only for a reversal.
 *
 * Nested names (`items.0.unitCost`) do not match a top-level key and are left unmarked, which is
 * the right answer: a marker on every row of a growing table is noise, and the row's own
 * validation still reports.
 */
export function RequiredFields({ schema, children }: { schema: ZodTypeAny; children: ReactNode }) {
  const required = useMemo(() => requiredFields(schema), [schema]);
  return (
    <RequiredFieldsContext.Provider value={required}>{children}</RequiredFieldsContext.Provider>
  );
}

/**
 * Whether the surrounding schema requires this field.
 *
 * Returns `explicit` untouched when the caller passed one, so a field can always overrule the
 * schema. Outside a provider it is false, which keeps every form that has not been wrapped
 * rendering exactly as it did.
 */
export function useIsRequired(name: string | undefined, explicit: boolean | undefined): boolean {
  const required = useContext(RequiredFieldsContext);
  if (explicit !== undefined) return explicit;
  if (!required || !name) return false;
  return required.has(name);
}
