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
