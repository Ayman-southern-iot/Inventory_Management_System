import { Injectable } from '@nestjs/common';
import type { PersonalRecord } from '@ims/shared';
import { DashboardRepository } from './dashboard.repository';

/**
 * The signed-in person's own record.
 *
 * Thin on purpose: there is no rule to apply here, only three aggregates to fetch. The one
 * decision worth stating is that they run **concurrently** — they touch different tables, none
 * depends on another, and the dashboard is the first screen after sign-in, so three serial round
 * trips would be the slowest thing about it for no reason.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly repo: DashboardRepository) {}

  async personalRecord(userId: string): Promise<PersonalRecord> {
    const [requisitions, borrowing, spend] = await Promise.all([
      this.repo.requisitionsFor(userId),
      this.repo.borrowingFor(userId),
      this.repo.spendFor(userId),
    ]);

    return { requisitions, borrowing, spend };
  }
}
