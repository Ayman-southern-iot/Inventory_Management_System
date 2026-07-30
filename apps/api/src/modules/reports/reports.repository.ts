import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { ExpenseReportQuery } from '@ims/shared';
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
    const submittedWindow = sql`
      (${fromDate}::date IS NULL OR r.submitted_at >= ${fromInstant})
      AND (${toDate}::date IS NULL OR r.submitted_at < ${toInstant})
    `;

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
          : sql`coalesce(max(p.name), 'No project')`;

    const rows = await sql<ExpenseRow>`
      WITH scoped AS (
        SELECT
          r.id,
          r.submitted_at,
          r.department_id,
          r.project_id,
          r.requested_amount,
          r.approved_amount,
          -- Pre-aggregated per requisition so the join below cannot fan out.
          (SELECT coalesce(sum(fr.amount), 0) FROM fund_receipts fr
            WHERE fr.requisition_id = r.id
              AND (${fromDate}::date IS NULL OR fr.received_at >= ${fromInstant})
              AND (${toDate}::date IS NULL OR fr.received_at < ${toInstant})
          ) AS funded,
          (SELECT coalesce(sum(pu.total_amount), 0) FROM purchases pu
            WHERE pu.requisition_id = r.id
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
        coalesce(sum(r.approved_amount), 0)::text AS approved,
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
