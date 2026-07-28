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
    const mismatches = await this.reconcile();
    if (mismatches === 0) this.logger.log('Stock reconciliation clean');
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
