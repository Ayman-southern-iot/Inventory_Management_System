import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Role, type PersonalRecord } from '@ims/shared';
import { t } from '@/i18n/en';
import * as dashboardApi from '../api';
import { DashboardPage } from './DashboardPage';

/**
 * The personal record.
 *
 * The figures are the whole screen, so what is worth testing is that each number lands under the
 * label it belongs to — a dashboard that prints "approved" where "requested" should be is wrong
 * in a way nobody spots by looking at it, because every value is plausible.
 */
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, usePersonalRecord: vi.fn() };
});

vi.mock('@/features/auth/auth-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'u-1',
        email: 'gina@ims.local',
        fullName: 'Gina General',
        designation: 'Engineer',
        departmentId: null,
        departmentName: 'R&D',
        roles: [Role.GENERAL],
        mustChangePassword: false,
      },
      isRestoring: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshUser: vi.fn(),
      adoptSession: vi.fn(),
      hasRole: () => false,
    }),
  };
});

function record(overrides: Partial<PersonalRecord> = {}): PersonalRecord {
  return {
    requisitions: {
      raised: 7,
      approved: 4,
      rejected: 2,
      inFlight: 1,
      drafts: 3,
      cancelled: 0,
    },
    borrowing: {
      borrowed: 5,
      returned: 3,
      stillOut: 2,
      partiallyDamagedUnits: 1,
      damagedUnits: 6,
      notWorkingUnits: 0,
    },
    spend: {
      requested: 120_000,
      approved: 95_000,
      spent: 88_500,
    },
    ...overrides,
  };
}

function renderPage(data: PersonalRecord | undefined, isPending = false) {
  vi.mocked(dashboardApi.usePersonalRecord).mockReturnValue({
    data,
    isPending,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof dashboardApi.usePersonalRecord>);

  render(<DashboardPage />);
}

/**
 * The figure printed under one label, within one block.
 *
 * Scoped by block because two labels legitimately read "Approved" — four approved requisitions
 * and 95,000 approved BDT — and each is unambiguous under its own heading. Renaming one of them
 * to suit the test would make the screen worse.
 */
function figureIn(blockTitle: string, label: string): string {
  const block = screen.getByRole('region', { name: blockTitle });
  const term = within(block).getByText(label);
  const definition = term.nextElementSibling;
  expect(definition, `no value rendered under "${label}"`).not.toBeNull();
  return definition!.textContent ?? '';
}

const REQUISITIONS = t.dashboard.requisitionsHeading;
const BORROWING = t.dashboard.borrowingHeading;
const MONEY = t.dashboard.spendHeading;

describe('the personal record', () => {
  it('puts each requisition count under its own label', () => {
    renderPage(record());

    expect(figureIn(REQUISITIONS, t.dashboard.raised)).toBe('7');
    expect(figureIn(REQUISITIONS, t.dashboard.approvedCount)).toBe('4');
    expect(figureIn(REQUISITIONS, t.dashboard.rejectedCount)).toBe('2');
    expect(figureIn(REQUISITIONS, t.dashboard.inFlight)).toBe('1');
    expect(figureIn(REQUISITIONS, t.dashboard.draftsCount)).toBe('3');
  });

  it('puts each borrowing count under its own label', () => {
    renderPage(record());

    expect(figureIn(BORROWING, t.dashboard.borrowedCount)).toBe('5');
    expect(figureIn(BORROWING, t.dashboard.returnedCount)).toBe('3');
    expect(figureIn(BORROWING, t.dashboard.stillOut)).toBe('2');
  });

  /**
   * The condition counts are units, and the tile says so. Without the suffix "6" under "Returned
   * damaged" reads as six separate borrowings rather than six broken things.
   */
  it('marks the damaged counts as units', () => {
    renderPage(record());

    expect(figureIn(BORROWING, t.dashboard.damagedUnits)).toContain('6');
    expect(figureIn(BORROWING, t.dashboard.damagedUnits)).toContain(t.dashboard.unitsSuffix);
  });

  /**
   * "Based on only spent money" — the figure most at risk of quietly being the wrong one of three
   * plausible numbers.
   */
  it('shows spent as the purchase total, distinct from requested and approved', () => {
    renderPage(record());

    expect(figureIn(MONEY, t.dashboard.spendSpent)).toContain('88,500');
    expect(figureIn(MONEY, t.dashboard.spendApproved)).toContain('95,000');
    expect(figureIn(MONEY, t.dashboard.spendRequested)).toContain('120,000');
  });

  /** A wall of zeroes says less than one sentence. */
  it('says so plainly when a person has done nothing yet', () => {
    renderPage(
      record({
        requisitions: { raised: 0, approved: 0, rejected: 0, inFlight: 0, drafts: 0, cancelled: 0 },
        borrowing: {
          borrowed: 0,
          returned: 0,
          stillOut: 0,
          partiallyDamagedUnits: 0,
          damagedUnits: 0,
          notWorkingUnits: 0,
        },
        spend: { requested: 0, approved: 0, spent: 0 },
      }),
    );

    expect(screen.getAllByText(t.dashboard.nothingYet)).toHaveLength(3);
    expect(screen.queryByText(t.dashboard.raised)).toBeNull();
  });

  it('still renders the identity panel while the figures are loading', () => {
    renderPage(undefined, true);

    expect(screen.getByText('Gina General')).toBeInTheDocument();
    expect(screen.getByText('R&D')).toBeInTheDocument();
  });

  /**
   * A draft is not something you have raised — nobody has been asked yet. Easy to get wrong, and
   * it would inflate everyone's count by whatever is sitting half-written in their drafts.
   */
  it('shows the requisition block for someone whose only work is a draft', () => {
    renderPage(
      record({
        requisitions: { raised: 0, approved: 0, rejected: 0, inFlight: 0, drafts: 2, cancelled: 0 },
      }),
    );

    const block = screen.getByRole('region', { name: REQUISITIONS });
    expect(within(block).getByText(t.dashboard.draftsCount)).toBeInTheDocument();
    expect(figureIn(REQUISITIONS, t.dashboard.raised)).toBe('0');
  });
});
