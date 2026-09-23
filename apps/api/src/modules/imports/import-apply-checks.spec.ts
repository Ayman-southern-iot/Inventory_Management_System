import { describe, expect, it } from 'vitest';
import { ImportIssueCode } from '@ims/shared';
import {
  deltaFromLocked,
  shelfKey,
  staleAgainstLocked,
  type LockedShelf,
} from './import-apply-checks';
import type { ImportPlan, PlannedProduct, PlannedShelf } from './import-validator';

/**
 * The two reads an apply takes from the **locked** row rather than from the preview
 * (`importing_data.md` §5.5 steps 5 and 8).
 *
 * These exist as their own spec because the integration path cannot reach them: the
 * re-validation at confirm is stricter today and rejects a stale job before the transaction
 * opens, so every race an integration test can stage is caught earlier. That makes this the only
 * direct evidence these guards work — and the day the confirm-time check loosens for an
 * unrelated reason, the only thing that would notice.
 */

const PRODUCT = '11111111-1111-4111-8111-000000000001';
const SHELF = '33333333-3333-4333-8333-000000000001';

function shelf(overrides: Partial<PlannedShelf> = {}): PlannedShelf {
  return {
    compartmentId: SHELF,
    storageId: 'MAI-MET-1A-0001',
    location: 'Main Store / Meta / 1A',
    currentOnHand: 10,
    targetOnHand: 4,
    line: 3,
    ...overrides,
  };
}

function plan(shelves: PlannedShelf[], productId: string | null = PRODUCT): ImportPlan {
  const product: PlannedProduct = {
    productId,
    productCode: 'LAP-0001',
    name: 'Lenovo ThinkPad T14',
    description: null,
    unit: 'pcs',
    defaultReturnable: true,
    isActive: true,
    categoryId: null,
    newCategoryIndex: null,
    shelves,
    lines: [3],
  };
  return { products: [product], categoriesToCreate: [], deactivations: [] };
}

const lockedAs = (row: Partial<LockedShelf>): Map<string, LockedShelf> =>
  new Map([
    [shelfKey(PRODUCT, SHELF), { quantity: 10, reserved_qty: 0, quarantined_qty: 0, ...row }],
  ]);

describe('the under-lock re-check (§5.5 step 5)', () => {
  it('passes a target that still clears what the shelf holds', () => {
    expect(
      staleAgainstLocked(plan([shelf({ targetOnHand: 4 })]), lockedAs({ reserved_qty: 4 })),
    ).toEqual([]);
  });

  /**
   * The case this guard exists for: validation said 2 was fine, then a borrow reserved 3 while
   * somebody read the diff. Reserved units are physically on the shelf, so a count below them is
   * not a count.
   */
  it('catches a reservation that grew after validation ran', () => {
    const issues = staleAgainstLocked(
      plan([shelf({ targetOnHand: 2 })]),
      lockedAs({ reserved_qty: 3 }),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe(ImportIssueCode.BELOW_RESERVED);
    expect(issues[0]!.row).toBe(3);
    expect(issues[0]!.message).toMatch(/now holds 3 units that are reserved or quarantined/);
  });

  it('counts quarantined units against the target as well as reserved ones', () => {
    const issues = staleAgainstLocked(
      plan([shelf({ targetOnHand: 2 })]),
      lockedAs({ reserved_qty: 1, quarantined_qty: 2 }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/now holds 3 units/);
  });

  it('names every shelf that has gone stale, not just the first', () => {
    const other = '33333333-3333-4333-8333-000000000002';
    const locked = lockedAs({ reserved_qty: 5 });
    locked.set(shelfKey(PRODUCT, other), {
      quantity: 8,
      reserved_qty: 6,
      quarantined_qty: 0,
    });

    const issues = staleAgainstLocked(
      plan([
        shelf({ targetOnHand: 1 }),
        shelf({
          compartmentId: other,
          location: 'Main Store / Meta / 1B',
          targetOnHand: 0,
          line: 4,
        }),
      ]),
      locked,
    );

    expect(issues.map((i) => i.row)).toEqual([3, 4]);
  });

  /** A product being created holds nothing yet, so there is no locked row and nothing to check. */
  it('says nothing about a shelf it holds no lock on', () => {
    expect(staleAgainstLocked(plan([shelf()]), new Map())).toEqual([]);
    expect(staleAgainstLocked(plan([shelf()], null), lockedAs({ reserved_qty: 9 }))).toEqual([]);
  });
});

describe('the delta (§5.5 step 8)', () => {
  /**
   * **The one that matters.** The plan says the shelf held 10 when a human looked at it; by the
   * time the lock is taken it holds 7. A delta of `4 − 10 = −6` applied to 7 would leave 1, not
   * the 4 the file asked for. Measuring from the locked row is the difference between a count
   * and a guess.
   */
  it('measures from the locked quantity, not from what the preview showed', () => {
    const stale = shelf({ currentOnHand: 10, targetOnHand: 4 });

    expect(deltaFromLocked(PRODUCT, stale, lockedAs({ quantity: 7 }))).toBe(-3);
    // What the naive version would have produced, kept visible so the difference is the test.
    expect(stale.targetOnHand - stale.currentOnHand).toBe(-6);
  });

  it('is positive when the file asks for more than the shelf holds', () => {
    expect(deltaFromLocked(PRODUCT, shelf({ targetOnHand: 12 }), lockedAs({ quantity: 7 }))).toBe(
      5,
    );
  });

  it('is zero when the locked row already matches, so the shelf is skipped', () => {
    expect(deltaFromLocked(PRODUCT, shelf({ targetOnHand: 7 }), lockedAs({ quantity: 7 }))).toBe(0);
  });

  /**
   * An unchanged shelf is never locked, so it is absent from the map. Falling back to zero would
   * turn it into an adjustment of its entire quantity; falling back to the plan's own figure
   * yields zero, which is skipped.
   */
  it('yields zero for a shelf that was never locked because nothing was changing', () => {
    const unchanged = shelf({ currentOnHand: 10, targetOnHand: 10 });
    expect(deltaFromLocked(PRODUCT, unchanged, new Map())).toBe(0);
  });

  it('treats a shelf being created as starting from nothing', () => {
    const fresh = shelf({ currentOnHand: 0, targetOnHand: 6 });
    expect(deltaFromLocked(PRODUCT, fresh, new Map())).toBe(6);
  });
});
