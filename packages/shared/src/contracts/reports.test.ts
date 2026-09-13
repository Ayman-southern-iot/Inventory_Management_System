import { describe, expect, it } from 'vitest';
import { inventoryReportQuerySchema } from './reports.js';

/**
 * Query-string booleans on the inventory report.
 *
 * Reported from the screen: the products list showed seven products with "In stock only"
 * unchecked, and the exported PDF showed five. The web sends the checkbox state faithfully as
 * `inStockOnly=false`, but the schema parsed it with `z.coerce.boolean()`, which reads every
 * non-empty string — including `"false"` — as `true`. The report then dropped every product
 * holding nothing.
 *
 * The same mistake had already been found and fixed once, in the IM portal's `?mine=false`
 * (see common.test.ts). `queryBoolean` exists because of it; these two schemas never adopted it.
 *
 * A parse test rather than an HTTP test: the coercion is the defect, and asserting it here
 * fails for the right reason.
 */
describe('inventoryReportQuerySchema query booleans', () => {
  it('reads inStockOnly=false as false', () => {
    expect(inventoryReportQuerySchema.parse({ inStockOnly: 'false' }).inStockOnly).toBe(false);
  });

  it('reads includeInactive=false as false', () => {
    expect(inventoryReportQuerySchema.parse({ includeInactive: 'false' }).includeInactive).toBe(
      false,
    );
  });

  it('still reads the string "true" as true', () => {
    expect(inventoryReportQuerySchema.parse({ inStockOnly: 'true' }).inStockOnly).toBe(true);
    expect(inventoryReportQuerySchema.parse({ includeInactive: 'true' }).includeInactive).toBe(
      true,
    );
  });

  it('defaults both to false when the query omits them', () => {
    const parsed = inventoryReportQuerySchema.parse({});
    expect(parsed.inStockOnly).toBe(false);
    expect(parsed.includeInactive).toBe(false);
  });

  it('accepts real booleans, so a JSON caller is unaffected', () => {
    expect(inventoryReportQuerySchema.parse({ inStockOnly: true }).inStockOnly).toBe(true);
    expect(inventoryReportQuerySchema.parse({ inStockOnly: false }).inStockOnly).toBe(false);
  });
});
