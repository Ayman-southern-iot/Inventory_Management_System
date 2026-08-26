import { Inject, Injectable } from '@nestjs/common';
import type {
  ExpenseBucket,
  ExpenseReport,
  ExpenseReportQuery,
  InventoryReport,
  InventoryReportQuery,
  InventoryReportRow,
} from '@ims/shared';
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

  /**
   * The inventory report (EX-02, requirements §10): current stock by product, with the location
   * breakdown underneath each one.
   *
   * The repository returns one row per placement, so the fold below is what turns "product ×
   * compartment" back into "product, and where it is" — the shape `docs/reference/04-domain-model.md`
   * describes and the shape an IM reads off a shelf.
   *
   * `inStockOnly` is applied here rather than in SQL on purpose: it means "holds nothing at all",
   * which is a property of the *summed* placements, and a WHERE clause on the individual rows
   * would instead drop empty compartments from products that do hold stock elsewhere.
   */
  async inventory(query: InventoryReportQuery): Promise<InventoryReport> {
    const rows = await this.repo.inventory(query);
    const byProduct = new Map<string, InventoryReportRow>();

    for (const row of rows) {
      let product = byProduct.get(row.product_id);
      if (!product) {
        product = {
          productId: row.product_id,
          productCode: row.product_code,
          name: row.name,
          categoryName: row.category_name,
          unit: row.unit,
          isActive: row.is_active,
          totalQuantity: 0,
          totalReserved: 0,
          totalQuarantined: 0,
          totalAvailable: 0,
          placements: [],
        };
        byProduct.set(row.product_id, product);
      }

      // A LEFT JOIN miss: the product exists and holds nothing. It still belongs in the report.
      if (row.compartment_name === null) continue;

      const quantity = row.quantity ?? 0;
      const reserved = row.reserved_qty ?? 0;
      const quarantined = row.quarantined_qty ?? 0;

      product.placements.push({
        zoneName: row.zone_name ?? '',
        compartmentName: row.compartment_name,
        quantity,
        reserved,
        quarantined,
      });
      product.totalQuantity += quantity;
      product.totalReserved += reserved;
      product.totalQuarantined += quarantined;
    }

    const all = [...byProduct.values()];
    for (const product of all) {
      // Reserved is committed to a borrow request and quarantined is physically unavailable, so
      // neither can be handed to the next person who asks (domain-context: available = quantity
      // − reserved, and quarantine sits outside availability).
      product.totalAvailable =
        product.totalQuantity - product.totalReserved - product.totalQuarantined;
    }

    const reportRows = query.inStockOnly ? all.filter((row) => row.totalQuantity > 0) : all;

    // Totalled from the rows shown, never by a second query — a separate SUM is a second chance
    // to disagree with the table underneath it.
    const totals = reportRows.reduce(
      (sum, row) => ({
        productCount: sum.productCount + 1,
        totalQuantity: sum.totalQuantity + row.totalQuantity,
        totalReserved: sum.totalReserved + row.totalReserved,
        totalQuarantined: sum.totalQuarantined + row.totalQuarantined,
        totalAvailable: sum.totalAvailable + row.totalAvailable,
      }),
      {
        productCount: 0,
        totalQuantity: 0,
        totalReserved: 0,
        totalQuarantined: 0,
        totalAvailable: 0,
      },
    );

    // A stock report is only true at an instant, and the printed copy goes to Accounts, so it
    // says which instant.
    return { generatedAt: new Date().toISOString(), rows: reportRows, totals };
  }
}
