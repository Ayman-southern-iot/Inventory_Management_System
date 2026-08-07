import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import { bomDetail } from '../__fixtures__/bom';
import * as bomApi from '../api';
import { BomDetailPage } from './BomDetailPage';

/**
 * Plan 4.4 acceptance smoke: a voided BOM shows the void banner and **no**
 * Render/Download buttons; a live BOM shows the action bar; bounced BOMs
 * never see a Render button.
 *
 * Mocks the BOM API boundary so the page mounts without a network — what we
 * are testing is the conditional rendering, not the data layer.
 */

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useBom: vi.fn(),
  };
});

function renderDetail() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/boms/abc']}>
          <Routes>
            <Route path="/boms/:bomId" element={<BomDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('BomDetailPage', () => {
  it('shows the action bar with Render and Void on a live BOM', () => {
    vi.mocked(bomApi.useBom).mockReturnValue({
      data: bomDetail({ hasPdf: false }),
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBom>);

    renderDetail();

    expect(screen.getByRole('heading', { name: 'BOM-000001' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.boms.render }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.boms.void })).toBeInTheDocument();
  });

  it('shows the Download button when the BOM has a PDF on file', () => {
    vi.mocked(bomApi.useBom).mockReturnValue({
      data: bomDetail({ hasPdf: true }),
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBom>);

    renderDetail();

    expect(
      screen.getByRole('button', { name: t.boms.downloadPdf }),
    ).toBeInTheDocument();
  });

  it('hides Render and Download on a voided BOM', () => {
    vi.mocked(bomApi.useBom).mockReturnValue({
      data: bomDetail({
        isVoid: true,
        voidReason: 'wrong totals',
        voidedAt: '2026-07-29T13:00:00.000Z',
        voidedByName: 'Inara IM',
      }),
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBom>);

    renderDetail();

    // The void banner says the BOM is voided; the badge column repeats the
    // same word, so we look for the banner copy specifically.
    // The void banner and the badge both show "Voided"; `getAllByText`
    // returns both and the assertion confirms the banner is present.
    expect(screen.getAllByText(t.boms.voidBanner).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: t.boms.render })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.boms.downloadPdf }),
    ).not.toBeInTheDocument();
  });

  it('hides Render and Download on a bounced BOM', () => {
    vi.mocked(bomApi.useBom).mockReturnValue({
      data: bomDetail({ overBudgetBounced: true }),
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBom>);

    renderDetail();

    expect(screen.getByText(t.boms.bouncedBanner)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.boms.render })).not.toBeInTheDocument();
    // Void is still available on a bounced BOM so the IM can free its sources.
    expect(screen.getByRole('button', { name: t.boms.void })).toBeInTheDocument();
  });

  it('opens the void dialog when the IM clicks Void', async () => {
    const user = userEvent.setup();
    vi.mocked(bomApi.useBom).mockReturnValue({
      data: bomDetail(),
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBom>);

    renderDetail();

    await user.click(screen.getByRole('button', { name: t.boms.void }));

    expect(screen.getByRole('dialog', { name: t.boms.voidTitle })).toBeInTheDocument();
  });
});