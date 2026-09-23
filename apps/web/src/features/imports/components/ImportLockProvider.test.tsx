import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCode, ImportJobStatus, type ImportJob } from '@ims/shared';
import { ApiError } from '@/api/client';
import { t } from '@/i18n/en';
import { ImportLockProvider, useSuppressImportBlock } from './ImportLockProvider';
import type * as ApiClient from '@/api/client';

/** Named, because `consistent-type-imports` forbids an inline `import()` annotation. */
type ApiClientModule = typeof ApiClient;

/**
 * The block, and the one screen it must not cover (`importing_data.md` §8).
 *
 * §8 allow-lists the progress endpoint so the manager running an import can watch it. Nothing
 * else on that page is allow-listed, so a background query — the notification bell, say — 503s
 * and would otherwise throw the block over the very view the allow-list exists to protect. These
 * tests are about that interaction, which no component tested alone can show.
 */

/** Fires the client's global handler the way a real 503 does, without a real request. */
function lockTheSystem(estimatedFinishAt: string | null = '2026-09-23T14:35:00.000Z'): void {
  const error = new ApiError(
    ErrorCode.SYSTEM_IMPORT_IN_PROGRESS,
    'The inventory is being updated. Please wait.',
    503,
    { estimatedFinishAt },
  );
  act(() => {
    handler?.(readEstimate(error.details));
  });
}

/*
 * The provider registers itself with the module-level setter in the API client. Capturing it
 * here is what lets a test play the part of a 503 arriving from anywhere in the app, which is
 * exactly how the real thing behaves.
 */
let handler: ((estimatedFinishAt: string | null) => void) | null = null;

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<ApiClientModule>();
  return {
    ...actual,
    setSystemLockedHandler: (next: ((estimate: string | null) => void) | null) => {
      handler = next;
    },
  };
});

function readEstimate(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null;
  const value = (details as { estimatedFinishAt?: unknown }).estimatedFinishAt;
  return typeof value === 'string' ? value : null;
}

/**
 * Stands in for the progress view. It takes a *job*, because that is all the hook accepts —
 * there is no way for a caller to say "suppress while my page is open".
 */
function Watching({ status }: { status: ImportJobStatus }): JSX.Element {
  useSuppressImportBlock({ ...jobFixture, status });
  return <p>watching the import</p>;
}

const jobFixture: ImportJob = {
  id: '11111111-1111-4111-8111-000000000001',
  status: ImportJobStatus.APPLYING,
  fileName: 'products.csv',
  totalRows: 10,
  processedRows: 3,
  percent: 30,
  startedAt: '2026-09-23T10:00:00.000Z',
  finishedAt: null,
  estimatedFinishAt: null,
  expiresAt: null,
  errors: [],
  diff: null,
  canRestore: false,
  restoredFromJobId: null,
  createdById: '22222222-2222-4222-8222-000000000001',
  createdByName: 'Import Manager',
  createdAt: '2026-09-23T10:00:00.000Z',
};

function renderApp(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ImportLockProvider>{children}</ImportLockProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  handler = null;
});

describe('ImportLockProvider', () => {
  it('shows nothing until something actually comes back 503', () => {
    renderApp(<p>the app</p>);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('raises the block when a 503 arrives from anywhere', () => {
    renderApp(<p>the app</p>);
    lockTheSystem();

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t.imports.locked.title })).toBeInTheDocument();
  });

  /**
   * **The collision.** The manager is watching their own import; a background query 503s. The
   * block must not cover the screen the allow-list was written to keep available.
   */
  it('does not cover a screen that is displaying a live import', () => {
    renderApp(<Watching status={ImportJobStatus.APPLYING} />);

    lockTheSystem();

    expect(screen.getByText('watching the import')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  /** Everyone else still gets it, which is the half that must not regress. */
  it('still covers a screen that is not displaying one', () => {
    renderApp(<Watching status={ImportJobStatus.COMPLETED} />);

    lockTheSystem();

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  /**
   * Scoped to the job being live, not to the page being open — and the hook's signature is what
   * makes that true: it accepts a job and decides, so the same mounted component stops
   * suppressing the moment its job reaches a terminal status.
   */
  it('covers the screen again once the job it was watching is no longer live', () => {
    const { rerender } = renderApp(<Watching status={ImportJobStatus.APPLYING} />);
    lockTheSystem();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <ImportLockProvider>
          <Watching status={ImportJobStatus.COMPLETED} />
        </ImportLockProvider>
      </QueryClientProvider>,
    );
    lockTheSystem();

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  /** Counted rather than a boolean: one view unmounting must not un-suppress for another. */
  it('keeps the block away while any live view is still on screen', () => {
    const { rerender } = renderApp(
      <>
        <Watching status={ImportJobStatus.APPLYING} />
        <Watching status={ImportJobStatus.APPLYING} />
      </>,
    );
    lockTheSystem();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <ImportLockProvider>
          <Watching status={ImportJobStatus.APPLYING} />
        </ImportLockProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
