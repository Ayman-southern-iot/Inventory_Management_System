import { Inject, Injectable } from '@nestjs/common';
import type {
  ExpenseBucket,
  ExpenseReport,
  ExpenseReportQuery,
  InventoryReport,
  InventoryReportQuery,
  InventoryReportRow,
  SpendTrend,
  SpendTrendPoint,
  TopSpendItems,
} from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { ReportsRepository, toNumbers } from './reports.repository';

/** Cents-level rounding, so the report agrees with the NUMERIC(14,2) columns behind it. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const TREND_MONTHS = 12;

/** How many rows the top-items panel shows. Five fits the card without scrolling. */
const TOP_ITEMS_LIMIT = 5;

/**
 * Today's calendar date in a given zone, as `{ year, month }` with a 1-based month.
 *
 * `Intl` rather than arithmetic on the epoch: it is the only thing in the platform that knows
 * what the date is *somewhere else*, which is the whole question. Reading `getMonth()` would
 * give the container's month, and a container is set to UTC — six hours behind Dhaka, so for the
 * first six hours of every month it would still be reporting the previous one.
 */
function calendarMonthIn(timeZone: string, now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month") };
}

/** `2026-09`, the key the report buckets months by. */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** `Sep 2026`. Built from a fixed day-1 date so no zone can shift it into a neighbouring month. */
function monthLabel(year: number, month: number): string {
  // en-US, not en-GB: en-GB abbreviates September as "Sept", four characters where every other
  // month is three, which leaves the chart axis visibly ragged.
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
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
        purchased: round2(values.purchased),
        transportation: round2(values.transportation),
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
        purchased: round2(sum.purchased + bucket.purchased),
        transportation: round2(sum.transportation + bucket.transportation),
        returned: round2(sum.returned + bucket.returned),
        netCash: round2(sum.netCash + bucket.netCash),
      }),
      {
        requisitionCount: 0,
        requested: 0,
        approved: 0,
        funded: 0,
        spent: 0,
        purchased: 0,
        transportation: 0,
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
  /**
   * The rolling twelve months of spend, ending with the current one.
   *
   * Built on the same `expenses()` query the rest of the page uses rather than a second one.
   * That is deliberate and is what the spec asks for: a separate SUM would be a second chance to
   * disagree with the figures beside it, and it would need its own copy of the D-020 status
   * predicate — which is exactly how D-020 happened the first time.
   *
   * The window is computed here, from the reporting time zone, and the gaps are filled here too.
   * `group by month` returns nothing for a month with no spend, so the twelve slots are laid out
   * first and the query results dropped into them; a month with no spend keeps its zero rather
   * than vanishing and letting the line slope through it.
   */
  async spendTrend(now = new Date()): Promise<SpendTrend> {
    const zone = this.config.reportingTimeZone;
    const today = calendarMonthIn(zone, now);

    // Twelve slots, oldest first, ending with the current month.
    const slots = Array.from({ length: TREND_MONTHS }, (_, index) => {
      const offset = index - (TREND_MONTHS - 1);
      // Date.UTC normalises the month overflow for us: month 0 becomes December of the year before.
      const at = new Date(Date.UTC(today.year, today.month - 1 + offset, 1));
      return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 };
    });

    const first = slots[0]!;
    const last = slots[slots.length - 1]!;
    // The closing bound is the last day of the current month; the query treats `to` inclusively.
    const endOfLast = new Date(Date.UTC(last.year, last.month, 0)).getUTCDate();

    const report = await this.expenses({
      groupBy: "month",
      from: `${monthKey(first.year, first.month)}-01`,
      to: `${monthKey(last.year, last.month)}-${String(endOfLast).padStart(2, "0")}`,
    });

    const bySlot = new Map(report.buckets.map((bucket) => [bucket.key, bucket]));

    const points: SpendTrendPoint[] = slots.map((slot) => {
      const key = monthKey(slot.year, slot.month);
      const bucket = bySlot.get(key);
      return {
        key,
        label: monthLabel(slot.year, slot.month),
        items: round2(bucket?.purchased ?? 0),
        transport: round2(bucket?.transportation ?? 0),
        total: round2(bucket?.spent ?? 0),
      };
    });

    return {
      // The real computed range, never the words "all time" — a window that has drifted is then
      // visible in the heading instead of being silently wrong.
      rangeLabel: `${points[0]!.label} – ${points[points.length - 1]!.label}`,
      points,
    };
  }
  /**
   * The ranked list of what the money went on, over the same window the page is showing.
   *
   * Deliberately takes the page query rather than hardcoding "this month": a list that ignored
   * the filter would contradict the Items figure directly above it the moment anyone changed
   * the range.
   */
  async topSpendItems(query: ExpenseReportQuery): Promise<TopSpendItems> {
    const rows = await this.repo.topSpendItems(
      query,
      this.config.reportingTimeZone,
      TOP_ITEMS_LIMIT,
    );

    return {
      items: rows.map((row) => ({
        productId: row.product_id,
        name: row.name,
        quantity: Number(row.quantity),
        spend: round2(Number(row.spend)),
      })),
    };
  }
}
