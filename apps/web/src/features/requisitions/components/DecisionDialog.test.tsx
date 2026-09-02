import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApprovalAction,
  ApprovalStage,
  type Approval,
  type DecideRequisitionInput,
  type RequisitionDetail,
  RequisitionStatus,
  RequisitionUrgency,
} from '@ims/shared';
import { t } from '@/i18n/en';
import { DecisionDialog } from './DecisionDialog';

// Mocks for hooks DecisionDialog pulls from elsewhere.
const decideSpy = vi.fn();
const uploadSpy = vi.fn();
const removeSpy = vi.fn();
const toastSpy = vi.fn();

/** Revision is off for this release, so the default matches production. */
const policy = (allowsApprovedAmountRevision: boolean) => ({
  data: {
    expenseThresholdBdt: 15_000,
    approversBelowThreshold: 1,
    approversAtOrAboveThreshold: 2,
    allowsApprovedAmountRevision,
  },
});
const policyStub = vi.fn(() => policy(false));

vi.mock('../api', () => ({
  useDecideRequisition: () => ({
    mutateAsync: (input: { approvalId: string; input: DecideRequisitionInput }) => {
      decideSpy(input);
      return Promise.resolve({} as RequisitionDetail);
    },
    isPending: false,
  }),
  // The dialog reads the policy to decide whether the revise-amount control exists at all.
  // A spy, not a fixed value, so the one test that needs revision switched back on can say so.
  useApprovalPolicy: () => policyStub(),
}));

vi.mock('@/features/profile/api', () => ({
  useMySignature: (_enabled: boolean) => ({ data: { signature: null } }),
  useUploadSignature: () => ({
    mutateAsync: (file: File) => {
      uploadSpy(file);
      return Promise.resolve({ signature: { id: 'sig-1', name: file.name } });
    },
    isPending: false,
  }),
  useDeleteSignature: () => ({
    mutateAsync: () => {
      removeSpy();
      return Promise.resolve();
    },
    isPending: false,
  }),
}));

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u-1' } }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    success: (m: string) => toastSpy(m),
    error: (m: string) => toastSpy(m),
  }),
}));

function approval(): Approval {
  return {
    id: 'appr-1',
    stage: ApprovalStage.APPROVER,
    slot: 1,
    assignedUserId: 'u-1',
    assignedUserName: 'Ayesha Approver',
    assignedUserDesignation: 'Head of Ops',
    actedByUserId: null,
    actedByUserName: null,
    action: ApprovalAction.PENDING,
    note: null,
    actedAt: null,
  };
}

function renderDialog(
  deciding: { approval: Approval; approve: boolean } | null,
  isAdjustable = true,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DecisionDialog
        deciding={deciding}
        requestedAmount={100_000}
        isAdjustable={isAdjustable}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe('DecisionDialog', () => {
  beforeEach(() => {
    policyStub.mockReturnValue(policy(false));
    // Reset, not just re-stub: vi.fn() accumulates calls across tests in one file, and a later
    // test would otherwise read an earlier one submission out of calls[0].
    decideSpy.mockClear();
  });

  /**
   * Revising the sanctioned amount is closed for this release (Ayman, 2026-09-02).
   *
   * These two replace the pair that described the opt-in gate and the indivisible-requisition
   * case. Kept rather than deleted because the feature is coming back: the second is what fails
   * if the flag is flipped on and the control does not return with it.
   */
  it('offers no way to revise the amount while the flow is closed', () => {
    renderDialog({ approval: approval(), approve: true });

    expect(screen.queryByLabelText(/revise the approved amount/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('spinbutton', { name: /revise the approved amount/i }),
    ).not.toBeInTheDocument();
    // Nor the explanation for why it is missing on an indivisible requisition — with the whole
    // feature off, that note answers a question nobody can ask.
    expect(screen.queryByText(t.requisitions.reviseAmountIndivisible)).not.toBeInTheDocument();
  });

  it('brings the control back when the policy allows revision again', () => {
    policyStub.mockReturnValue(policy(true));

    renderDialog({ approval: approval(), approve: true });

    expect(screen.getByLabelText(/revise the approved amount/i)).toBeInTheDocument();
  });

  it('submits approvedAmount: null when the gate stays off', async () => {
    const user = userEvent.setup();
    renderDialog({ approval: approval(), approve: true });

    // Click "Approve without signature" — the form must submit and the payload must carry
    // approvedAmount: null regardless of any DOM value the number input might have carried.
    await user.click(screen.getByRole('button', { name: /approve without signature/i }));

    expect(decideSpy).toHaveBeenCalledTimes(1);
    const call = decideSpy.mock.calls[0]![0];
    expect(call.input.approve).toBe(true);
    expect(call.input.approvedAmount).toBeNull();
    expect(call.input.withSignature).toBe(false);
  });

  it('submits the revised amount when the gate is ticked and a figure is entered', async () => {
    // Only reachable with revision switched on; kept so the submit path is covered for its return.
    policyStub.mockReturnValue(policy(true));
    const user = userEvent.setup();
    renderDialog({ approval: approval(), approve: true });

    await user.click(screen.getByLabelText(/revise the approved amount/i));

    const amountInput = await screen.findByRole('spinbutton', {
      name: /revise the approved amount/i,
    });
    await user.clear(amountInput);
    await user.type(amountInput, '85000');

    await user.click(screen.getByRole('button', { name: /approve without signature/i }));

    expect(decideSpy).toHaveBeenCalledTimes(1);
    expect(decideSpy.mock.calls[0]![0].input.approvedAmount).toBe(85_000);
  });

  it('never offers the amount field when the actor is the Inventory Manager', () => {
    renderDialog({
      approval: { ...approval(), stage: ApprovalStage.INVENTORY_MANAGER },
      approve: true,
    });
    expect(screen.queryByLabelText(/revise the approved amount/i)).not.toBeInTheDocument();
  });

  it('hides the signature uploader when not approving', () => {
    renderDialog({ approval: approval(), approve: false });
    // The rejection warning is up; the uploader is not.
    expect(screen.queryByText(/no signature on file/i)).not.toBeInTheDocument();
  });

  it('ticks the IM_REVIEW status into a non-actionable scenario without breaking the form', () => {
    // Belt-and-braces — confirms the dialog does not crash on a non-actionable approval either.
    renderDialog({
      approval: { ...approval(), stage: ApprovalStage.APPROVER, action: ApprovalAction.WITHDRAWN },
      approve: true,
    });
    expect(screen.getByRole('button', { name: /approve without signature/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve with signature/i })).toBeInTheDocument();
  });
});

// Re-suppress unused-import lint when the file lints in isolation.
void RequisitionStatus;
void RequisitionUrgency;