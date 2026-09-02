import { useQuery } from '@tanstack/react-query';
import type {
  ExpenseReport,
  ExpenseReportQuery,
  InventoryReportQuery,
  SpendTrend,
  TopSpendItems,
} from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

export function useExpenseReport(query: ExpenseReportQuery) {
  return useQuery({
    queryKey: queryKeys.reports.expenses(query),
    queryFn: ({ signal }) =>
      api.get<ExpenseReport>(`/reports/expenses${toSearchParams(query)}`, signal),
    // Keeps the previous table on screen while a new range loads, so changing the filter does not
    // blank the page and shift everything under the cursor.
    placeholderData: (previous) => previous,
  });
}

/**
 * The rolling twelve-month spend trend.
 *
 * Deliberately not filtered by the page range: the trend answers "what has the shape of our
 * spending been", which is a different question from "what happened in the range I picked", and
 * a trend that shrank to the selected month would just be the flow header drawn as a dot.
 */
export function useSpendTrend() {
  return useQuery({
    queryKey: queryKeys.reports.spendTrend(),
    queryFn: ({ signal }) => api.get<SpendTrend>(`/reports/expenses/trend`, signal),
  });
}

/** What the money went on, over the page's own range so the two agree. */
export function useTopSpendItems(query: ExpenseReportQuery) {
  return useQuery({
    queryKey: queryKeys.reports.topItems(query),
    queryFn: ({ signal }) =>
      api.get<TopSpendItems>(`/reports/expenses/top-items${toSearchParams(query)}`, signal),
    placeholderData: (previous) => previous,
  });
}

/**
 * Builds the export path for the CSV / PDF download buttons. The current on-screen filter is
 * the filter the export uses — no separate dialog.
 *
 * This is a path **relative to the API base**, for `api.blob()` to prefix and authenticate. It
 * is deliberately not a browser-usable URL: it was one once, handed straight to an
 * `<a href download>`, and D-024 is what that cost. The name says `Path` so the next person
 * reaching for it in an `href` notices.
 */
export function expenseExportPath(query: ExpenseReportQuery, format: 'csv' | 'pdf'): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return `/reports/expenses/export.${format}?${params.toString()}`;
}

/**
 * The inventory export path (EX-02, requirements §10).
 *
 * Same shape and same caveat as `expenseExportPath` above: relative to the API base, for
 * `api.blob()` to prefix and authenticate. Never put it in an `href` — that is what D-024 was.
 */
export function inventoryExportPath(
  query: InventoryReportQuery,
  format: 'csv' | 'pdf',
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return `/reports/inventory/export.${format}?${params.toString()}`;
}
