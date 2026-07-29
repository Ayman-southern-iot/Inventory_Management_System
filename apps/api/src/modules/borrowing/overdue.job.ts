import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BorrowingRepository } from './borrowing.repository';

/**
 * Daily overdue sweep (task 2.8).
 *
 * Only logs for now: OQ-10 says there is no SMTP relay, and in-app notifications arrive with
 * Phase 03's notification table. Writing the job now means the query and the schedule are
 * proven, and delivery becomes a one-line change rather than a new feature.
 */
@Injectable()
export class OverdueBorrowJob {
  private readonly logger = new Logger(OverdueBorrowJob.name);

  constructor(private readonly repo: BorrowingRepository) {}

  // 08:00 Asia/Dhaka — as people arrive, not overnight where it would be missed.
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { name: 'overdue-borrows' })
  async run(): Promise<number> {
    const overdue = await this.repo.findOverdue();
    if (overdue.length === 0) return 0;

    this.logger.warn(`${overdue.length} borrow(s) past their expected return date`);
    for (const row of overdue) {
      this.logger.warn(`  overdue ${row.borrow_no} (requester ${row.requester_id})`);
    }
    return overdue.length;
  }
}
