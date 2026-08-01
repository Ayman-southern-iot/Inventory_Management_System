import { Inject, Injectable } from '@nestjs/common';
import type { ExpenseBucket, ExpenseReport, ExpenseReportQuery } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { ReportsRepository, toNumbers } from './reports.repository';

/** Cents-level rounding, so the report agrees with the NUMERIC(14,2) columns behind it. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly repo: ReportsRepository,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async expenses(query: ExpenseReportQuery): Promise<ExpenseReport> {
    // The dates are calendar days in the business's own zone; Postgres resolves them to instants.
    const rows = await this.repo.expenses(query, this.config.reportingTimeZone);

    const buckets: ExpenseBucket[] = rows.map((row) => {
      const values = toNumbers(row);
      return {
        ...values,
        requested: round2(values.requested),
        approved: round2(values.approved),
        funded: round2(values.funded),
        spent: round2(values.spent),
        returned: round2(values.returned),
        netCash: round2(values.funded - values.returned),
      };
    });

    // Totalled from the buckets, not by a second query. A separate SUM would be a second chance
    // to disagree with the rows on screen, which is exactly the failure that makes a report
    // untrustworthy.
    const totals = buckets.reduce(
      (sum, bucket) => ({
        requisitionCount: sum.requisitionCount + bucket.requisitionCount,
        requested: round2(sum.requested + bucket.requested),
        approved: round2(sum.approved + bucket.approved),
        funded: round2(sum.funded + bucket.funded),
        spent: round2(sum.spent + bucket.spent),
        returned: round2(sum.returned + bucket.returned),
        netCash: round2(sum.netCash + bucket.netCash),
      }),
      {
        requisitionCount: 0,
        requested: 0,
        approved: 0,
        funded: 0,
        spent: 0,
        returned: 0,
        netCash: 0,
      },
    );

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      groupBy: query.groupBy,
      buckets,
      totals,
    };
  }
}
