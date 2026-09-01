import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovalAction, ApprovalStage, type Approval } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import { DecisionCard } from './DecisionCard';

/**
 * The revise control is a button that reveals a field, the way transportation works on the
 * requisition form (Ayman, 2026-08-29). It was a checkbox inside a dialog before.
 *
 * Two things have to hold and neither is obvious from looking at it: the field is absent until
 * asked for — a rendered-but-untouched number input can submit 0 by accident — and closing it
 * clears whatever was typed, so a figure cannot be left behind in a collapsed field and approved
 * without anyone seeing it.
 */
vi.mock('@/features/profile/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMySignature: () => ({ data: { signature: null }, isPending: false }),
  };
});

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useDecideRequisition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

function approval(stage: ApprovalStage): Approval {
  return {
    id: 'ap-1',
    stage,
    slot: 1,
    assignedUserId: 'approver',
    assignedUserName: 'Ayesha Approver',
    assignedUserDesignation: 'Head of Operations',
    actedByUserId: null,
    actedByUserName: null,
    action: ApprovalAction.PENDING,
    note: null,
  } as unknown as Approval;
}

function renderCard({
  stage = ApprovalStage.APPROVER,
  isAdjustable = true,
}: { stage?: ApprovalStage; isAdjustable?: boolean } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <DecisionCard
          approval={approval(stage)}
          requestedAmount={40_500}
          isAdjustable={isAdjustable}
          onReject={() => undefined}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('DecisionCard', () => {
  it('hides the amount field until the approver asks for it', async () => {
    const user = userEvent.setup();
    renderCard();

    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.requisitions.reviseAmountOpen }));

    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
  });

  /** A figure left behind in a closed field is money nobody can see they are approving. */
  it('clears the figure when the field is closed again', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: t.requisitions.reviseAmountOpen }));
    await user.type(screen.getByRole('spinbutton'), '30000');
    expect(screen.getByRole('spinbutton')).toHaveValue(30_000);

    await user.click(screen.getByRole('button', { name: t.requisitions.reviseAmountCancel }));
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.requisitions.reviseAmountOpen }));
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
  });

  /** The IM's stage asks "do we already have this", not "how much is sanctioned". */
  it('offers no revise control at the inventory-manager stage', () => {
    renderCard({ stage: ApprovalStage.INVENTORY_MANAGER });

    expect(
      screen.queryByRole('button', { name: t.requisitions.reviseAmountOpen }),
    ).not.toBeInTheDocument();
  });

  /** QA-034: one line of one unit has no smaller quantity to buy. */
  it('explains itself rather than going silent on an indivisible requisition', () => {
    renderCard({ isAdjustable: false });

    expect(
      screen.queryByRole('button', { name: t.requisitions.reviseAmountOpen }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(t.requisitions.reviseAmountIndivisible)).toBeInTheDocument();
  });
});
