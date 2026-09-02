import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import { api } from '@/api/client';
import { t } from '@/i18n/en';
import * as reportsApi from '../api';
import { ExpensesPage } from './ExpensesPage';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  // The trend and the top-items list are separate hooks. Unmocked they would call useQuery for
  // real, and this file renders the page without a QueryClientProvider on purpose — the export
  // path is what is under test, not the data fetching.
  return {
    ...actual,
    useExpenseReport: vi.fn(),
    useSpendTrend: vi.fn(),
    useTopSpendItems: vi.fn(),
  };
});

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, api: { ...(actual.api as object), blob: vi.fn() } };
});

/**
 * QA round 2, D-024 — High.
 *
 * The two export buttons were plain `<a href download>` anchors pointing at
 * `/reports/expenses/export.csv`. Two defects stacked: the path has no `/api/v1`, so Caddy
 * never routed it to the API and the SPA's history fallback answered with index.html — HTTP
 * 200, `text/html`, 722 bytes, saved under a `.csv` name. And even routed correctly it would
 * have 401'd, because this app authenticates with a bearer header and a browser cannot attach
 * one to a top-level navigation.
 *
 * `SupportingDocumentCard` already solved this and says so in its own doc comment: fetch
 * through `api.blob()`, which carries the token and the silent refresh, then hand the bytes to
 * the browser as an object URL. These tests pin the transport, because the failure mode is
 * silent — the user gets a file with the right name and the wrong contents.
 */
describe('ExpensesPage — export downloads', () => {
  beforeEach(() => {
    vi.mocked(reportsApi.useExpenseReport).mockReturnValue({
      data: {
        from: null,
        to: null,
        groupBy: 'month',
        buckets: [],
        totals: {
          requisitionCount: 0,
          requested: 0,
          approved: 0,
          funded: 0,
          spent: 0,
          returned: 0,
        },
      },
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof reportsApi.useExpenseReport>);
    // Undefined data: both panels render nothing, which is the state this test wants them in.
    vi.mocked(reportsApi.useSpendTrend).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof reportsApi.useSpendTrend>);
    vi.mocked(reportsApi.useTopSpendItems).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof reportsApi.useTopSpendItems>);
    // Reset, not just re-stub: vi.fn() accumulates calls across tests in the same file, and
    // the second test would otherwise read the first test's request out of calls[0].
    vi.mocked(api.blob).mockReset();
    vi.mocked(api.blob).mockResolvedValue(new Blob(['a,b\n1,2'], { type: 'text/csv' }));

    // jsdom has neither, and the download path needs both.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  const renderPage = () =>
    render(
      <ToastProvider>
        <ExpensesPage />
      </ToastProvider>,
    );

  it('fetches the CSV through the authenticated client, not a navigation', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: t.expenses.downloadCsv }));

    await waitFor(() => expect(api.blob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.blob).mock.calls[0]![0]).toContain('/reports/expenses/export.csv');
  });

  it('fetches the PDF the same way', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: t.expenses.downloadPdf }));

    await waitFor(() => expect(api.blob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.blob).mock.calls[0]![0]).toContain('/reports/expenses/export.pdf');
  });

  it('releases the object URL rather than leaking the report for the life of the page', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: t.expenses.downloadCsv }));

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock'));
  });
});
