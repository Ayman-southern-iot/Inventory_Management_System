import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ImportJobStatus, type ImportJob } from '@ims/shared';
import { t } from '@/i18n/en';
import { ImportProgressRing, formatClock } from './ImportProgressRing';

/**
 * The brief asked for a loader with *"time and percentage … continuous updating"*, so those two
 * properties are what this file is about — not how the ring looks.
 */

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: '11111111-1111-4111-8111-000000000001',
    status: ImportJobStatus.APPLYING,
    fileName: 'products.csv',
    totalRows: 100,
    processedRows: 40,
    percent: 40,
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
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ImportProgressRing', () => {
  it('shows the percentage the server reported', () => {
    render(<ImportProgressRing job={job({ percent: 40 })} />);
    expect(screen.getByText(t.imports.progress.percent(40))).toBeInTheDocument();
  });

  /**
   * The "continuously updating" half of the brief, and the reason the clock is local: it has to
   * advance between polls, not only when one lands.
   */
  it('advances the elapsed clock every second without a new server response', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T10:00:05.000Z'));

    const frozen = job({ startedAt: '2026-09-23T10:00:00.000Z' });
    render(<ImportProgressRing job={frozen} />);
    expect(screen.getByText(t.imports.progress.elapsed('0:05'))).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    // Same job object, three seconds later: the clock moved on its own.
    expect(screen.getByText(t.imports.progress.elapsed('0:08'))).toBeInTheDocument();
  });

  /**
   * C33: closing the browser and coming back must show how long the *import* has run, not how
   * long this tab has been watching it.
   */
  it('counts from when the import started, not from when the page opened', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T10:02:30.000Z'));

    render(<ImportProgressRing job={job({ startedAt: '2026-09-23T10:00:00.000Z' })} />);

    expect(screen.getByText(t.imports.progress.elapsed('2:30'))).toBeInTheDocument();
  });

  /** A ring sitting at 0% looks exactly like a ring that is stuck, so it spins instead. */
  it('does not claim 0% before the server knows the row count', () => {
    render(<ImportProgressRing job={job({ percent: null, totalRows: null })} />);

    expect(screen.queryByText(t.imports.progress.percent(0))).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(t.imports.progress.starting)).toBeInTheDocument();
  });

  it('says what stage it is at, since a percentage cannot describe a backup', () => {
    render(<ImportProgressRing job={job({ processedRows: 0, totalRows: 100, percent: 0 })} />);
    expect(screen.getByText(t.imports.progress.snapshot)).toBeInTheDocument();
  });

  it('counts the shelves once they start moving', () => {
    render(<ImportProgressRing job={job({ processedRows: 40, totalRows: 100 })} />);
    expect(screen.getByText(t.imports.progress.shelves(40, 100))).toBeInTheDocument();
  });

  it('tells the manager they may leave, because the import does not need them', () => {
    render(<ImportProgressRing job={job()} />);
    expect(screen.getByText(t.imports.progress.doNotClose)).toBeInTheDocument();
  });

  /** Both numbers in one region: two announcements a second is unusable. */
  it('announces the two moving numbers together', () => {
    render(<ImportProgressRing job={job({ percent: 40 })} />);
    const live = screen.getByText(t.imports.progress.percent(40));
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('aria-atomic', 'true');
  });
});

describe('formatClock', () => {
  it('reads m:ss for the durations an import actually takes', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9_000)).toBe('0:09');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(11 * 60 * 1000 + 7_000)).toBe('11:07');
  });

  it('grows an hours field rather than showing 90 minutes', () => {
    expect(formatClock(3_600_000)).toBe('1:00:00');
    expect(formatClock(3_600_000 + 5 * 60_000 + 9_000)).toBe('1:05:09');
  });
});
