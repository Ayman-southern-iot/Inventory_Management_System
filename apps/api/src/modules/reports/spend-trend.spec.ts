import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config';
import { ReportsService } from './reports.service';
import type { ExpenseRow, ReportsRepository } from './reports.repository';

/**
 * The rolling twelve-month window, and the gaps in it.
 *
 * Two things can go wrong here and both are silent. The window can be computed in the container's
 * zone rather than the business's, which shifts it for the first six hours of every month in
 * Asia/Dhaka and reports the wrong twelve months to nobody's surprise until a year-end. And a
 * month with no spend can vanish, because `group by month` returns nothing for it — leaving the
 * line to slope between the months either side, which reads as spending that never happened.
 *
 * Spec: `docs/spec/expenses-page-rebuild.md`.
 */

/** A repository that answers with whatever rows the test hands it. */
function repoReturning(rows: ExpenseRow[]): ReportsRepository {
  return {
    expenses: async () => rows,
  } as unknown as ReportsRepository;
}

function configIn(timeZone: string): AppConfig {
  return { reportingTimeZone: timeZone } as unknown as AppConfig;
}

/** The shape `expenses()` reads: every figure arrives from Postgres as text. */
function row(key: string, label: string, purchased: string, transportation: string): ExpenseRow {
  return {
    key,
    label,
    requisition_count: '1',
    requested: '0',
    approved: '0',
    funded: '0',
    spent: String(Number(purchased) + Number(transportation)),
    purchased,
    transportation,
    returned: '0',
  } as unknown as ExpenseRow;
}

describe('the rolling spend trend', () => {
  it('always returns twelve months, ending with the current one', async () => {
    const service = new ReportsService(repoReturning([]), configIn('Asia/Dhaka'));

    const trend = await service.spendTrend(new Date('2026-09-02T06:00:00.000Z'));

    expect(trend.points).toHaveLength(12);
    expect(trend.points[11]!.key).toBe('2026-09');
    expect(trend.points[0]!.key).toBe('2025-10');
  });

  /**
   * The one that catches a UTC window.
   *
   * 2026-10-01T00:30 in Dhaka is 2026-09-30T18:30 UTC — still September to a naive reader. The
   * window must end in October, because in the office it is October.
   */
  it('computes the window in the reporting time zone, not the container’s', async () => {
    const dhaka = new ReportsService(repoReturning([]), configIn('Asia/Dhaka'));
    const utc = new ReportsService(repoReturning([]), configIn('UTC'));
    const justAfterMidnightInDhaka = new Date('2026-09-30T18:30:00.000Z');

    const inDhaka = await dhaka.spendTrend(justAfterMidnightInDhaka);
    const inUtc = await utc.spendTrend(justAfterMidnightInDhaka);

    expect(inDhaka.points[11]!.key).toBe('2026-10');
    // The same instant, read in UTC, is still September — which is exactly the bug this guards.
    expect(inUtc.points[11]!.key).toBe('2026-09');
  });

  it('emits a zero for a month with no spend, rather than dropping it', async () => {
    const service = new ReportsService(
      // Only two of the twelve months have any spend, and they are not adjacent.
      repoReturning([
        row('2026-07', 'July 2026', '1000', '100'),
        row('2026-09', 'September 2026', '2000', '200'),
      ]),
      configIn('Asia/Dhaka'),
    );

    const trend = await service.spendTrend(new Date('2026-09-02T06:00:00.000Z'));

    expect(trend.points).toHaveLength(12);
    const august = trend.points.find((point) => point.key === '2026-08');
    expect(august).toBeDefined();
    expect(august!.total).toBe(0);
    expect(august!.items).toBe(0);
    expect(august!.transport).toBe(0);
  });

  it('carries the months that do have spend, split into items and transport', async () => {
    const service = new ReportsService(
      repoReturning([row('2026-09', 'September 2026', '2000', '200')]),
      configIn('Asia/Dhaka'),
    );

    const trend = await service.spendTrend(new Date('2026-09-02T06:00:00.000Z'));
    const september = trend.points.find((point) => point.key === '2026-09')!;

    expect(september.items).toBe(2000);
    expect(september.transport).toBe(200);
    // The chart point and the ledger's Total column must be the same figure.
    expect(september.total).toBe(2200);
    expect(september.items + september.transport).toBe(september.total);
  });

  /** A named range is self-checking: a window that has drifted shows up in the heading. */
  it('labels the real computed range rather than saying "all time"', async () => {
    const service = new ReportsService(repoReturning([]), configIn('Asia/Dhaka'));

    const trend = await service.spendTrend(new Date('2026-09-02T06:00:00.000Z'));

    expect(trend.rangeLabel).toBe('Oct 2025 – Sep 2026');
  });

  /** September abbreviates to three characters like every other month, so the axis is even. */
  it('abbreviates every month to three characters', async () => {
    const service = new ReportsService(repoReturning([]), configIn('Asia/Dhaka'));

    const trend = await service.spendTrend(new Date('2026-09-02T06:00:00.000Z'));

    for (const point of trend.points) {
      expect(point.label.split(' ')[0]).toHaveLength(3);
    }
  });

  it('crosses a year boundary without losing a month', async () => {
    const service = new ReportsService(repoReturning([]), configIn('Asia/Dhaka'));

    const trend = await service.spendTrend(new Date('2026-01-15T06:00:00.000Z'));

    expect(trend.points[0]!.key).toBe('2025-02');
    expect(trend.points[11]!.key).toBe('2026-01');
    expect(new Set(trend.points.map((p) => p.key)).size).toBe(12);
  });
});
