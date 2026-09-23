import { ImportIssueCode, type ImportIssue } from '@ims/shared';
import type { ImportPlan, PlannedShelf } from './import-validator';

/**
 * §5.5 step 5 and step 8, as pure functions — the two places an apply reads the **locked** row
 * instead of trusting what the preview said.
 *
 * Extracted from `ImportApplyService` for one reason: they are the mechanism a race is supposed
 * to be caught by, and until they were separable the only way to reach them was through a
 * confirm-time re-validation that gets there first. That earlier check is stricter *today*,
 * which is exactly why this needs its own coverage — the day its conditions loosen for an
 * unrelated reason, this stops being a backstop and becomes load-bearing, and nothing would
 * have noticed the difference.
 */

/** What a locked `stock_placements` row tells us. Narrowed so a test need not build the rest. */
export interface LockedShelf {
  quantity: number;
  reserved_qty: number;
  quarantined_qty: number;
}

export function shelfKey(productId: string, compartmentId: string): string {
  return `${productId}:${compartmentId}`;
}

/**
 * Step 5. Every shelf whose target has become impossible since validation ran.
 *
 * Reserved and quarantined units are physically on the shelf, so a count below them is not a
 * count. Validation already checked this — against the numbers as they were then. A borrow
 * landing in between is the one plausible late failure (C21), and catching it here costs
 * microseconds against a transaction that would otherwise do all its work and fail at the end.
 */
export function staleAgainstLocked(
  plan: ImportPlan,
  locked: ReadonlyMap<string, LockedShelf>,
): ImportIssue[] {
  const issues: ImportIssue[] = [];

  for (const product of plan.products) {
    if (product.productId === null) continue;
    for (const shelf of product.shelves) {
      const row = locked.get(shelfKey(product.productId, shelf.compartmentId));
      if (!row) continue;

      const held = row.reserved_qty + row.quarantined_qty;
      if (shelf.targetOnHand >= held) continue;

      issues.push({
        code: ImportIssueCode.BELOW_RESERVED,
        row: shelf.line ?? 2,
        column: 'on_hand',
        value: String(shelf.targetOnHand),
        message: `${shelf.location} now holds ${held} units that are reserved or quarantined — more than when this import was checked. Nothing was changed; re-upload the file.`,
      });
    }
  }

  return issues;
}

/**
 * Step 8. How far this shelf has to move, measured from the row we hold a lock on.
 *
 * **Never from `shelf.currentOnHand`.** That is what the preview showed a human minutes ago;
 * computing a delta from it and handing it to `adjust` applies that difference to whatever the
 * row holds *now*, so any concurrent change is silently doubled or cancelled. It is the exact
 * bug `rules/40-database.md` exists to prevent, and the reason every quantity in this system is
 * read under lock before it is written.
 *
 * **The fallback is `currentOnHand`, not zero**, and that is load-bearing rather than defensive.
 * Only shelves whose target differs from their current count are locked, so an *unchanged* shelf
 * is absent from the map — and falling back to zero would turn it into a full adjustment of its
 * whole quantity. Falling back to what the plan recorded yields a delta of zero, which is
 * skipped, which is correct. For a shelf being created the plan already records zero, so the two
 * agree.
 */
export function deltaFromLocked(
  productId: string,
  shelf: PlannedShelf,
  locked: ReadonlyMap<string, LockedShelf>,
): number {
  const row = locked.get(shelfKey(productId, shelf.compartmentId));
  return shelf.targetOnHand - (row?.quantity ?? shelf.currentOnHand);
}
