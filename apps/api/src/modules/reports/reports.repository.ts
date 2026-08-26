import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { APPROVAL_STANDING_STATUSES } from '@ims/shared';
import type { ExpenseReportQuery, InventoryReportQuery } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

/** NUMERIC arrives from pg as a string so it never passes through a float. */
const money = (value: string | null): number => (value === null ? 0 : Number(value));

export interface ExpenseRow {
  key: string;
  label: string;
  requisition_count: string;
  requested: string | null;
  approved: string | null;
  funded: string | null;
  spent: string | null;
  returned: string | null;
}

@Injectable()
export class ReportsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The expense report, in one query.
   *
   * Written as raw SQL rather than assembled in JavaScript for two reasons. The money columns are
   * `numeric`, and summing them in Postgres is exact where adding parsed floats is not. And the
   * per-requisition sums have to happen *before* the join — joining `requisitions` to three
   * one-to-many money tables at once multiplies the rows, and every figure would come out
   * inflated by the number of rows in the other two tables. That is the classic fan-out bug, and
   * it is silent: the report looks plausible and is simply wrong.
   *
   * Each requisition therefore contributes exactly one row, with its money pre-aggregated in
   * scalar subqueries, and the grouping happens over that.
   */
  async expenses(query: ExpenseReportQuery, timeZone: string): Promise<ExpenseRow[]> {
    const fromDate = query.from ?? null;
    const toDate = query.to ?? null;

    // The calendar boundaries, resolved in the business's own time zone by Postgres.
    //
    // Doing this in SQL rather than JavaScript is the difference between exact and
    // approximately-right: `date '2026-07-31' AT TIME ZONE 'Asia/Dhaka'` is precisely local
    // midnight as an instant, and `+ 1 day` makes the closing day inclusive without any
    // 23:59:59.999 fudge. Computing it with `setHours` would use the *server's* zone, which is
    // whatever the container happens to be set to.
    const fromInstant = sql`(${fromDate}::date AT TIME ZONE ${timeZone}::text)`;
    const toInstant = sql`((${toDate}::date + 1) AT TIME ZONE ${timeZone}::text)`;

    // `requested`/`approved` are attributed by submission date; the money figures by the date it
    // moved. A requisition submitted in June and paid in July contributes to both months, in
    // different columns — which is what an accountant expects.
    // Interpolated once as a bound parameter; `::text[]` because `requisitions.status` is a
    // Postgres enum and an enum does not compare to text without the cast.
    const standingStatuses = [...APPROVAL_STANDING_STATUSES];

    const submittedWindow = sql`
      (${fromDate}::date IS NULL OR r.submitted_at >= ${fromInstant})
      AND (${toDate}::date IS NULL OR r.submitted_at < ${toInstant})
    `;

    /**
     * The department breakdown groups on `department_id` — where the money lands — and
     * deliberately **not** on the requester. An IM raising a requisition for Engineering
     * hardware is Engineering's spend, not the IM's, and a report Accounts reads as an
     * allocation must say so. Do not "correct" this to the requester on the grounds that the
     * requisition *list* groups that way: the list answers "whose request is this?", this
     * answers "whose budget is this?".
     *
     * `coalesce(..., 'none')` is what keeps a department-less requisition in the breakdown
     * rather than dropping it: Department is optional (D-006), and a row that fell out here
     * would break the "Figures always reconcile" promise the page makes.
     */
    const groupExpr =
      query.groupBy === 'month'
        ? sql`to_char(date_trunc('month', r.submitted_at AT TIME ZONE ${timeZone}::text), 'YYYY-MM')`
        : query.groupBy === 'department'
          ? sql`coalesce(r.department_id::text, 'none')`
          : sql`coalesce(r.project_id::text, 'none')`;

    // Every label is aggregated, including the month one. It is functionally dependent on the
    // group expression, but Postgres does not infer that through `to_char(date_trunc(...))` and
    // rejects the query outright — so `max()` states it explicitly.
    const labelExpr =
      query.groupBy === 'month'
        ? sql`max(to_char(date_trunc('month', r.submitted_at AT TIME ZONE ${timeZone}::text), 'FMMonth YYYY'))`
        : query.groupBy === 'department'
          ? sql`coalesce(max(d.name), 'No department')`
          // Ayman's ruling, 2026-08-26: a requisition with no project is personal development,
          // not an unlabelled gap. Same bucket, honest name. "No department" keeps its wording
          // because D-006 now requires a department at submit, so that bucket only ever holds
          // rows written before the rule.
          : sql`coalesce(max(p.name), 'Personal development')`;

    const rows = await sql<ExpenseRow>`
      WITH scoped AS (
        SELECT
          r.id,
          r.submitted_at,
          r.department_id,
          r.project_id,
          r.requested_amount,
          r.approved_amount,
          r.status,
          -- Pre-aggregated per requisition so the join below cannot fan out.
          -- voided_at IS NULL on both money subqueries (migration 0028): a reversed receipt
          -- or purchase stays on the row for the audit trail and leaves every figure.
          (SELECT coalesce(sum(fr.amount), 0) FROM fund_receipts fr
            WHERE fr.requisition_id = r.id
              AND fr.voided_at IS NULL
              AND (${fromDate}::date IS NULL OR fr.received_at >= ${fromInstant})
              AND (${toDate}::date IS NULL OR fr.received_at < ${toInstant})
          ) AS funded,
          (SELECT coalesce(sum(pu.total_amount), 0) FROM purchases pu
            WHERE pu.requisition_id = r.id
              AND pu.voided_at IS NULL
              AND (${fromDate}::date IS NULL OR pu.purchased_at >= ${fromInstant})
              AND (${toDate}::date IS NULL OR pu.purchased_at < ${toInstant})
          ) AS spent,
          (SELECT coalesce(sum(fx.amount), 0) FROM fund_returns fx
            WHERE fx.requisition_id = r.id
              AND (${fromDate}::date IS NULL OR fx.returned_at >= ${fromInstant})
              AND (${toDate}::date IS NULL OR fx.returned_at < ${toInstant})
          ) AS returned
        FROM requisitions r
        WHERE r.submitted_at IS NOT NULL
          AND (${query.departmentId ?? null}::uuid IS NULL OR r.department_id = ${query.departmentId ?? null}::uuid)
          AND (${query.projectId ?? null}::uuid IS NULL OR r.project_id = ${query.projectId ?? null}::uuid)
          AND (${submittedWindow})
      )
      SELECT
        ${groupExpr} AS key,
        ${labelExpr} AS label,
        count(*)::text AS requisition_count,
        coalesce(sum(r.requested_amount), 0)::text AS requested,
        -- Not a plain sum of approved_amount: the column is written at submit and only
        -- send-back nulls it, so a rejected or undecided requisition carries a full figure
        -- (D-020). Approved here means CURRENTLY approved, so the sum is predicated on status.
        coalesce(sum(
          CASE WHEN r.status::text = ANY(${standingStatuses}::text[])
            THEN r.approved_amount ELSE 0 END
        ), 0)::text AS approved,
        coalesce(sum(r.funded), 0)::text AS funded,
        coalesce(sum(r.spent), 0)::text AS spent,
        coalesce(sum(r.returned), 0)::text AS returned
      FROM scoped r
      LEFT JOIN departments d ON d.id = r.department_id
      LEFT JOIN projects p ON p.id = r.project_id
      -- Positional, not a repeat of the expression. Interpolating \`groupExpr\` a second time
      -- re-emits its bound parameters with *different* placeholder numbers, so Postgres reads
      -- the two as different expressions and rejects the query.
      GROUP BY 1
      ORDER BY 1
    `.execute(this.db);

    return rows.rows;
  }

  /**
   * Current stock by product, one row per placement (EX-02, requirements §10).
   *
   * A read, and only a read. Nothing here touches `stock_placements` or `stock_ledger` as
   * anything but a SELECT — writing is `StockService`'s alone (rules/40-database.md), and a
   * report has no business being the exception that proves it.
   *
   * LEFT JOIN rather than INNER: a product holding nothing is a real answer to "what do we
   * have", and dropping it would make the export quietly disagree with the products list it is
   * exported from. The service folds these rows back up per product.
   *
   * Ordered here rather than in each formatter, so the PDF, the CSV and the JSON read in the
   * same sequence. Sorting the same data in three places is how three views start disagreeing.
   */
  async inventory(query: InventoryReportQuery): Promise<InventoryRow[]> {
    const categoryId = query.categoryId ?? null;
    const zoneId = query.zoneId ?? null;

    const rows = await sql<InventoryRow>`
      SELECT
        p.id               AS product_id,
        p.product_code     AS product_code,
        p.name             AS name,
        c.name             AS category_name,
        p.unit             AS unit,
        p.is_active        AS is_active,
        z.name             AS zone_name,
        -- The compartment's human label is \`code\` ("1A", "3C"), not \`name\` — only the zone
        -- carries a name. Getting this wrong fails at run time, not at compile time.
        cm.code            AS compartment_name,
        sp.quantity        AS quantity,
        sp.reserved_qty    AS reserved_qty,
        sp.quarantined_qty AS quarantined_qty
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN stock_placements sp ON sp.product_id = p.id
      LEFT JOIN storage_compartments cm ON cm.id = sp.compartment_id
      LEFT JOIN storage_zones z ON z.id = cm.zone_id
      WHERE (${query.includeInactive} OR p.is_active)
        AND (${categoryId}::uuid IS NULL OR p.category_id = ${categoryId}::uuid)
        AND (${zoneId}::uuid IS NULL OR z.id = ${zoneId}::uuid)
      ORDER BY p.name ASC, z.name ASC NULLS LAST, cm.code ASC NULLS LAST
    `.execute(this.db);

    return rows.rows;
  }
}

export function toNumbers(row: ExpenseRow) {
  return {
    key: row.key,
    label: row.label,
    requisitionCount: Number(row.requisition_count),
    requested: money(row.requested),
    approved: money(row.approved),
    funded: money(row.funded),
    spent: money(row.spent),
    returned: money(row.returned),
  };
}

/** One product-placement pair; a product with stock in three compartments yields three rows. */
export interface InventoryRow {
  product_id: string;
  product_code: string;
  name: string;
  category_name: string | null;
  unit: string;
  is_active: boolean;
  zone_name: string | null;
  compartment_name: string | null;
  quantity: number | null;
  reserved_qty: number | null;
  quarantined_qty: number | null;
}
