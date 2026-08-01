import { describe, expect, it } from 'vitest';
import type { ExpenseReportQuery } from '@ims/shared';
import { expenseExportUrl } from './api';

/**
 * The export URL helper is the single point of contact between the page's filter and the
 * backend's export endpoints. It is pure — no React — so a unit test covers the only thing that
 * can go wrong: a filter field that should round-trip into the query string being dropped.
 */
describe('expenseExportUrl', () => {
  it('serialises every meaningful filter field', () => {
    const query: ExpenseReportQuery = {
      groupBy: 'department',
      from: '2026-07-01',
      to: '2026-07-31',
      departmentId: '00000000-0000-0000-0000-000000000001',
    };
    const url = expenseExportUrl(query, 'csv');

    expect(url).toMatch(/^\/reports\/expenses\/export\.csv\?/);
    expect(url).toContain('groupBy=department');
    expect(url).toContain('from=2026-07-01');
    expect(url).toContain('to=2026-07-31');
    expect(url).toContain('departmentId=00000000-0000-0000-0000-000000000001');
  });

  it('omits empty and undefined filter values', () => {
    // The user's currently-empty inputs must not show up as `?from=&to=` — that would 400 the
    // backend, because the contract rejects `''` against `calendarDateSchema`.
    const query: ExpenseReportQuery = {
      groupBy: 'month',
      from: '',
      to: undefined,
    };
    const url = expenseExportUrl(query, 'pdf');
    const params = new URLSearchParams(url.split('?')[1]!);
    expect(params.get('groupBy')).toBe('month');
    expect(params.has('from')).toBe(false);
    expect(params.has('to')).toBe(false);
  });

  it('produces a CSV or PDF endpoint URL', () => {
    expect(expenseExportUrl({ groupBy: 'month' }, 'csv')).toContain('/export.csv');
    expect(expenseExportUrl({ groupBy: 'month' }, 'pdf')).toContain('/export.pdf');
  });
});