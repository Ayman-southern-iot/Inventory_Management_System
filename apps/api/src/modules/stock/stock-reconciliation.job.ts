import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StockService } from './stock.service';

/**
 * The nightly invariant check (§7.3.5, plan task 1.8).
 *
 * `SUM(ledger) = placements.quantity` for every (product, compartment). A mismatch means the
 * physical shelf and the database have diverged, which is the one failure this system cannot
 * recover from on its own — so it is an **alert**, not a warning, and it is deliberately loud.
 *
 * Runs in-process. At this scale a queue server would be operational cost with no payoff
 * (DECISIONS.md), and the check is a single indexed query.
 */
@Injectable()
export class StockReconciliationJob {
  private readonly logger = new Logger(StockReconciliationJob.name);

  constructor(private readonly stock: StockService) {}

  // 02:00 Asia/Dhaka — after the working day, before anyone arrives to act on it.
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'stock-reconciliation' })
  async run(): Promise<void> {
    // Both checks always run. Reporting only the first would hide a reservation problem behind
    // an unrelated quantity problem, and these two fail for completely different reasons.
    const [quantity, reservations] = await Promise.all([
      this.reconcile(),
      this.reconcileReservations(),
    ]);
    if (quantity === 0 && reservations === 0) this.logger.log('Stock reconciliation clean');
  }

  /**
   * The reservation invariant: reserved units are held by a pending borrow, or by nothing.
   *
   * Separate from the quantity check because it catches a different failure. `reserved_qty` never
   * appears in the ledger, so `SUM(ledger) = quantity` balances perfectly while units sit reserved
   * against a borrow that was rejected, cancelled or issued minutes ago (gap G-14). The symptom
   * reaches a human as "the shelf has six but the system will only lend me four", which is a
   * miserable thing to debug without this line in a log.
   */
  async reconcileReservations(): Promise<number> {
    const mismatches = await this.stock.findReservationMismatches();
    if (mismatches.length === 0) return 0;

    for (const row of mismatches) {
      const drift = row.reserved_qty - row.expected_qty;
      this.logger.error(
        `RESERVATION MISMATCH product=${row.product_id} compartment=${row.compartment_id} ` +
          `reserved=${row.reserved_qty} pendingBorrows=${row.expected_qty} drift=${drift} ` +
          `(${drift > 0 ? 'units held by nothing' : 'promised more than is reserved'})`,
      );
    }
    this.logger.error(
      `Stock reconciliation found ${mismatches.length} reservation mismatch(es). ` +
        'Pending borrow requests are authoritative; correct by cancelling the phantom request or ' +
        're-reserving, never by editing reserved_qty directly.',
    );
    return mismatches.length;
  }

  /** Exposed so an admin endpoint or a test can run it on demand. Returns the mismatch count. */
  async reconcile(): Promise<number> {
    const mismatches = await this.stock.findReconciliationMismatches();
    if (mismatches.length === 0) return 0;

    // One line per mismatch: whoever reads this at 9am needs the product and compartment, not
    // a summary telling them something is wrong somewhere.
    for (const row of mismatches) {
      this.logger.error(
        `STOCK MISMATCH product=${row.product_id} compartment=${row.compartment_id} ` +
          `ledger=${row.ledger_qty} placement=${row.placement_qty} ` +
          `drift=${row.placement_qty - row.ledger_qty}`,
      );
    }
    this.logger.error(
      `Stock reconciliation found ${mismatches.length} mismatch(es). ` +
        'The ledger is authoritative; correct with a compensating adjustment, never by editing history.',
    );
    return mismatches.length;
  }
}
