import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';
import { SystemImportBlock } from './SystemImportBlock';

/**
 * What everyone who is not running the import sees (`importing_data.md` §8).
 *
 * The assertion that matters is the estimate. The server added `estimatedFinishAt` to the 503's
 * body for exactly this screen — while the lockout is up, every route that could have answered
 * "when will this end" is itself refused — so a block that rendered a generic "come back later"
 * would leave a field that was deliberately added going unused.
 */
function renderBlock(estimatedFinishAt: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemImportBlock estimatedFinishAt={estimatedFinishAt} onCleared={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('SystemImportBlock', () => {
  it('says what is happening rather than showing a bare spinner', () => {
    renderBlock(null);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t.imports.locked.title })).toBeInTheDocument();
    expect(screen.getByText(t.imports.locked.body)).toBeInTheDocument();
  });

  /** The one the server went out of its way to make possible. */
  it('shows when the import is expected to finish, from the 503 body', () => {
    const finish = '2026-09-23T14:35:00.000Z';
    renderBlock(finish);

    expect(screen.getByText(t.imports.locked.until(formatDateTime(finish)))).toBeInTheDocument();
    expect(screen.queryByText(t.imports.locked.unknown)).not.toBeInTheDocument();
  });

  /**
   * The estimate can genuinely be absent — an older API, or a lockout noticed some other way —
   * and "no time" must not render as "Invalid Date" or an empty line where a sentence was.
   */
  it('still says something useful when no estimate came back', () => {
    renderBlock(null);

    expect(screen.getByText(t.imports.locked.unknown)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it('is announced, and names itself to a screen reader', () => {
    renderBlock('2026-09-23T14:35:00.000Z');

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The estimate is the part that changes while the screen is open, so it is the live region.
    expect(screen.getByText(/expected to finish/i)).toHaveAttribute('aria-live', 'polite');
  });

  it('offers a way to check without waiting for the poll', () => {
    renderBlock(null);
    expect(screen.getByRole('button', { name: t.imports.locked.retry })).toBeEnabled();
  });
});
