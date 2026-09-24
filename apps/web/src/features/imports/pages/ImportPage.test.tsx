import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCode, ImportJobStatus, type ImportDiff, type ImportJob } from '@ims/shared';
import { api } from '@/api/client';
import { ToastProvider } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { ImportLockProvider } from '../components/ImportLockProvider';
import { ImportPage } from './ImportPage';

/**
 * The import screen end to end, through a stubbed `fetch` rather than a stubbed client.
 *
 * That choice is the point of this file. The two seams left open by the component specs — the
 * line in `client.ts` that raises the lockout on a 503, and the real ring inside the real
 * provider — only exist between modules, so a test that mocks the client cannot reach them.
 * Going through `fetch` means every layer under the page is the real one.
 */

const DIFF: ImportDiff = {
  productsCreated: 2,
  productsUpdated: 1,
  productsDeactivated: 0,
  productsRenamed: 0,
  productsRecategorised: 0,
  categoriesCreated: ['Electronics / Sensors'],
  shelvesChanged: 3,
  unitsAdded: 12,
  unitsRemoved: 4,
  warnings: [
    {
      code: 'SHELF_CLEARED_BY_OMISSION',
      row: 7,
      column: null,
      value: null,
      message: '10 units of "Lenovo ThinkPad T14" at Main Store / Meta / 1A will be removed',
    },
  ],
};

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: '11111111-1111-4111-8111-000000000001',
    status: ImportJobStatus.AWAITING_CONFIRMATION,
    fileName: 'products.csv',
    totalRows: 3,
    processedRows: 0,
    percent: 0,
    startedAt: null,
    finishedAt: null,
    estimatedFinishAt: null,
    expiresAt: '2026-09-23T11:00:00.000Z',
    errors: [],
    diff: DIFF,
    canRestore: false,
    restoredFromJobId: null,
    createdById: '22222222-2222-4222-8222-000000000001',
    createdByName: 'Import Manager',
    createdAt: '2026-09-23T10:00:00.000Z',
    ...overrides,
  };
}

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const locked = (): Response =>
  new Response(
    JSON.stringify({
      code: ErrorCode.SYSTEM_IMPORT_IN_PROGRESS,
      message: 'The inventory is being updated. Please wait.',
      details: { estimatedFinishAt: '2026-09-23T14:35:00.000Z' },
    }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  );

/**
 * The page asks for two things: the job, and the history list. A mock that answers every URL the
 * same way hands an object to a component expecting an array, which throws during render and
 * fails the test for a reason that has nothing to do with what it is testing.
 */
function respond(answers: { job?: Response; list?: Response; fallback?: Response }) {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const isList = /\/inventory\/imports(\?|$)/.test(url);
    const chosen = isList ? (answers.list ?? ok([])) : (answers.job ?? answers.fallback);
    return Promise.resolve((chosen ?? ok([])).clone());
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ImportLockProvider>
          <ImportPage />
        </ImportLockProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const csv = (): File =>
  new File(['# ims-product-import v1\r\n'], 'products.csv', {
    type: 'text/csv',
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ImportPage', () => {
  it('starts by asking for a file, and explains the round trip', () => {
    renderPage();

    expect(screen.getByText(t.imports.upload.help)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.imports.upload.choose })).toBeInTheDocument();
  });

  it('shows what the file would do, rather than importing it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(respond({ job: ok(job()) }));
    renderPage();

    await userEvent.upload(screen.getByLabelText(t.imports.upload.choose), csv());

    expect(await screen.findByText(t.imports.preview.title)).toBeInTheDocument();
    // The counts, and — more importantly — the warning that says stock is about to vanish.
    expect(screen.getByText(DIFF.warnings[0]!.message)).toBeInTheDocument();
    expect(screen.getByText(t.imports.preview.backup)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.imports.preview.apply })).toBeInTheDocument();
  });

  it('says plainly when a file would change nothing', async () => {
    const empty: ImportDiff = {
      ...DIFF,
      productsCreated: 0,
      productsUpdated: 0,
      shelvesChanged: 0,
      categoriesCreated: [],
      warnings: [],
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(respond({ job: ok(job({ diff: empty })) }));
    renderPage();

    await userEvent.upload(screen.getByLabelText(t.imports.upload.choose), csv());

    expect(await screen.findByText(t.imports.preview.nothingToDo)).toBeInTheDocument();
  });

  it('lists every problem when the file cannot be used, with no apply button', async () => {
    const failed = job({
      status: ImportJobStatus.FAILED,
      diff: null,
      errors: [
        {
          code: 'VALUE_REQUIRED',
          row: 4,
          column: 'unit',
          value: '',
          message: '"unit" is empty and must have a value.',
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(respond({ job: ok(failed) }));
    renderPage();

    await userEvent.upload(screen.getByLabelText(t.imports.upload.choose), csv());

    expect(await screen.findByText(/"unit" is empty/)).toBeInTheDocument();
    expect(screen.getByText(t.imports.preview.atRow(4))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.imports.preview.apply })).not.toBeInTheDocument();
  });

  /**
   * **The seam that was in NOTCHECKED.** A 503 travelling through the real client must raise the
   * block — nothing here fires the handler by hand.
   */
  it('raises the lockout block when a request really comes back 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(locked());
    renderPage();

    await userEvent.upload(screen.getByLabelText(t.imports.upload.choose), csv());

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    // And the estimate the server put in `details` reached the screen.
    expect(screen.getByText(/expected to finish/i)).toBeInTheDocument();
  });

  /**
   * **The other seam.** The real ring, inside the real provider, while a 503 arrives: the block
   * must stay down, because this is the one screen §8 allow-lists the progress endpoint for.
   */
  it('keeps the block off the screen that is watching a live import', async () => {
    const applying = job({
      status: ImportJobStatus.APPLYING,
      startedAt: '2026-09-23T10:00:00.000Z',
      processedRows: 1,
      percent: 33,
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(respond({ job: ok(applying) }));

    renderPage();
    await userEvent.upload(screen.getByLabelText(t.imports.upload.choose), csv());
    expect(await screen.findByTestId('import-progress')).toBeInTheDocument();

    /*
     * A background query 503s while the ring is up — and it goes through `api`, not through the
     * mocked `fetch` directly. That matters: calling `fetch` here would never run the client
     * code that raises the lockout, so the assertion below would pass because nothing had tried,
     * which is not the same as passing because suppression worked.
     */
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(locked());
    await api.get('/notifications/unread-count').catch(() => undefined);

    await waitFor(() => {
      expect(screen.getByTestId('import-progress')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
