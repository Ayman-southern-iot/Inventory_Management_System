import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportJobStatus, type ImportJob } from '@ims/shared';
import { ToastProvider } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { ImportHistory } from './ImportHistory';

/**
 * Past runs and their backups (`importing_data.md` §10, part F).
 *
 * The screen exists for one question — *can I put it back?* — so these are about the answer being
 * honest: a run whose backup is gone says so instead of offering a button that fails, and a
 * restore states what it undoes before it is possible to click it.
 */

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: '11111111-1111-4111-8111-000000000001',
    status: ImportJobStatus.COMPLETED,
    fileName: 'products.csv',
    totalRows: 12,
    processedRows: 12,
    percent: 100,
    startedAt: '2026-09-22T14:00:00.000Z',
    finishedAt: '2026-09-22T14:02:00.000Z',
    estimatedFinishAt: null,
    expiresAt: null,
    errors: [],
    diff: {
      productsCreated: 2,
      productsUpdated: 5,
      productsDeactivated: 1,
      productsRenamed: 0,
      productsRecategorised: 0,
      categoriesCreated: [],
      shelvesChanged: 4,
      unitsAdded: 10,
      unitsRemoved: 2,
      warnings: [],
    },
    canRestore: true,
    restoredFromJobId: null,
    createdById: '22222222-2222-4222-8222-000000000001',
    createdByName: 'Import Manager',
    createdAt: '2026-09-22T14:00:00.000Z',
    ...overrides,
  };
}

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ImportHistory onRestored={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ImportHistory', () => {
  it('says so when nothing has been imported, rather than showing an empty frame', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([]));
    renderHistory();

    expect(await screen.findByText(t.imports.history.empty)).toBeInTheDocument();
  });

  it('lists a past run with who ran it and what it did', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([job()]));
    renderHistory();

    expect(await screen.findByText(t.imports.history.summary(2, 5, 1, 4))).toBeInTheDocument();
    expect(screen.getByText(/Import Manager/)).toBeInTheDocument();
  });

  /**
   * §10's first "thing restore cannot do": it is not a partial undo. Stating it *before* the
   * click is the whole point — discovering it afterwards is the failure this guards.
   */
  it('says what a restore would undo before it can be confirmed', async () => {
    const older = job({ id: '11111111-1111-4111-8111-000000000002' });
    const newer = job({ id: '11111111-1111-4111-8111-000000000003' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([newer, older]));
    renderHistory();

    const buttons = await screen.findAllByRole('button', { name: t.imports.history.restore });
    // The older run is second in the list, so restoring it undoes the one above.
    await userEvent.click(buttons[1]!);

    expect(screen.getByText(/1 import — will be undone/)).toBeInTheDocument();
    expect(screen.getByText(/emptied, not removed/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.imports.history.restoreConfirm }),
    ).toBeInTheDocument();
  });

  it('does not claim later imports will be undone when there are none', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([job()]));
    renderHistory();

    await userEvent.click(await screen.findByRole('button', { name: t.imports.history.restore }));

    expect(screen.queryByText(/will be undone/)).not.toBeInTheDocument();
    expect(screen.getByText(/emptied, not removed/)).toBeInTheDocument();
  });

  /** A Restore button that would fail is worse than none: C44 says so and so does the screen. */
  it('offers nothing to restore once the backup has been deleted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([job({ canRestore: false })]));
    renderHistory();

    expect(await screen.findByText(t.imports.history.noSnapshot)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.imports.history.restore }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.imports.history.deleteSnapshot }),
    ).not.toBeInTheDocument();
  });

  it('marks a run that was itself a restore', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ok([job({ restoredFromJobId: '33333333-3333-4333-8333-000000000001' })]),
    );
    renderHistory();

    expect(await screen.findByText(t.imports.history.wasRestore)).toBeInTheDocument();
  });
});
