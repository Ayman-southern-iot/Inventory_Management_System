import { useQuery } from '@tanstack/react-query';
import type { ExpenseReport, ExpenseReportQuery } from '@ims/shared';
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
 * Builds the export URL for the CSV / PDF download buttons. The current on-screen filter is the
 * filter the export uses — no separate dialog. Returned as a same-origin URL string so the buttons
 * can be plain `<a href download>` anchors: the auth cookie rides along, and the browser shows
 * its native download prompt without an in-app loading state.
 */
export function expenseExportUrl(query: ExpenseReportQuery, format: 'csv' | 'pdf'): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return `/reports/expenses/export.${format}?${params.toString()}`;
}
