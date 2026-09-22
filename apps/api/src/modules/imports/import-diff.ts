import type { ImportDiff, ImportIssue } from '@ims/shared';
import { CATEGORY_PATH_SEPARATOR } from './import-format';
import { lookupKey, type ImportLookups } from './import-lookups';
import type { ImportPlan } from './import-validator';

/**
 * The plan, counted — what the person approving an import is actually shown
 * (`importing_data.md` §5.4).
 *
 * **Every number here answers "what changes", never "what the file mentions".** Re-importing an
 * unedited export has to read zero across the board (I11, C46): a preview that says "40 products
 * updated" when nothing differs is a preview people stop reading, and the whole point of the
 * human gate is that somebody reads it.
 *
 * Pure, and computed from the plan rather than from the rows, so the diff and the apply can
 * never disagree about what is about to happen — they are counting the same object.
 */
export function buildImportDiff(
  plan: ImportPlan,
  lookups: ImportLookups,
  warnings: ImportIssue[],
): ImportDiff {
  let productsCreated = 0;
  let productsUpdated = 0;
  let productsRenamed = 0;
  let productsRecategorised = 0;
  let shelvesChanged = 0;
  let unitsAdded = 0;
  let unitsRemoved = 0;
  let deactivatedByRow = 0;

  for (const product of plan.products) {
    if (product.productId === null) productsCreated += 1;

    for (const shelf of product.shelves) {
      const delta = shelf.targetOnHand - shelf.currentOnHand;
      if (delta === 0) continue; // C28: `adjust` throws on a zero delta, so it is not a change.
      shelvesChanged += 1;
      if (delta > 0) unitsAdded += delta;
      else unitsRemoved += -delta;
    }

    const existing = product.productId ? lookups.productById.get(product.productId) : undefined;
    if (!existing) continue;

    const renamed = lookupKey(existing.name) !== lookupKey(product.name);
    /*
     * A product filed into a category this import is creating is recategorised by definition —
     * a category that does not exist yet cannot be the one it is already in. Comparing the two
     * id fields would miss it, and would miss it hardest in the case that matters: an
     * uncategorised product being filed for the first time, where both sides read null.
     */
    const recategorised =
      product.newCategoryIndex !== null || (existing.categoryId ?? null) !== product.categoryId;

    if (renamed) productsRenamed += 1;
    if (recategorised) productsRecategorised += 1;
    if (existing.isActive && !product.isActive) deactivatedByRow += 1;

    const changed =
      renamed ||
      recategorised ||
      lookupKey(existing.unit) !== lookupKey(product.unit) ||
      existing.isActive !== product.isActive ||
      existing.defaultReturnable !== product.defaultReturnable ||
      (existing.description ?? '') !== (product.description ?? '') ||
      (product.productCode !== null &&
        lookupKey(existing.productCode) !== lookupKey(product.productCode)) ||
      product.shelves.some((shelf) => shelf.targetOnHand !== shelf.currentOnHand);

    if (changed) productsUpdated += 1;
  }

  return {
    productsCreated,
    productsUpdated,
    /*
     * A row marked Inactive and a product the file simply left out are the same outcome to the
     * person approving — something that was in the catalogue will not be after this — so they
     * are one number. The ones worth singling out (still on loan, still holding stock) arrive
     * as warnings beside it.
     */
    productsDeactivated: deactivatedByRow + plan.deactivations.length,
    productsRenamed,
    productsRecategorised,
    categoriesCreated: plan.categoriesToCreate.map((category) =>
      category.path.join(CATEGORY_PATH_SEPARATOR),
    ),
    shelvesChanged,
    unitsAdded,
    unitsRemoved,
    warnings,
  };
}
