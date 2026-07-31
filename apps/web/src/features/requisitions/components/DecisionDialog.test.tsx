import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { DecisionDialog } from './DecisionDialog';

// Mocks for hooks DecisionDialog pulls from elsewhere.
const decideSpy = vi.fn();
const uploadSpy = vi.fn();
const removeSpy = vi.fn();
const toastSpy = vi.fn();

vi.mock('../api', () => ({
  useDecideRequisition: () => ({
    mutateAsync: (input: { approvalId: string; input: DecideRequisitionInput }) => {
      decideSpy(input);
      return Promise.resolve({} as RequisitionDetail);
    },
    isPending: false,
  }),
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

function renderDialog(deciding: { approval: Approval; approve: boolean } | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DecisionDialog
        deciding={deciding}
        requestedAmount={100_000}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe('DecisionDialog', () => {
  afterEach(() => {
    decideSpy.mockClear();
    uploadSpy.mockClear();
    removeSpy.mockClear();
    toastSpy.mockClear();
  });
  it('does not render the sanctioned-amount input when the gate is off', () => {
    renderDialog({ approval: approval(), approve: true });

    // The opt-in checkbox is labelled "Revise the sanctioned amount".
    expect(screen.getByLabelText(/revise the sanctioned amount/i)).toBeInTheDocument();
    // The amount field is hidden by default — proves the gate is unmounting the input.
    expect(
      screen.queryByRole('spinbutton', { name: /revise the sanctioned amount/i }),
    ).not.toBeInTheDocument();
  });

  it('submits approvedAmount: null when the gate stays off', async () => {
    const user = userEvent.setup();
    renderDialog({ approval: approval(), approve: true });

    // Click "Approve without signature" — the form must submit and the payload must carry
    // approvedAmount: null regardless of any DOM value the number input might have carried.
    await user.click(screen.getByRole('button', { name: /approve without signature/i }));

    expect(decideSpy).toHaveBeenCalledTimes(1);
    const call = decideSpy.mock.calls[0][0];
    expect(call.input.approve).toBe(true);
    expect(call.input.approvedAmount).toBeNull();
    expect(call.input.withSignature).toBe(false);
  });

  it('submits the revised amount when the gate is ticked and a figure is entered', async () => {
    const user = userEvent.setup();
    renderDialog({ approval: approval(), approve: true });

    await user.click(screen.getByLabelText(/revise the sanctioned amount/i));

    const amountInput = await screen.findByRole('spinbutton', {
      name: /revise the sanctioned amount/i,
    });
    await user.clear(amountInput);
    await user.type(amountInput, '85000');

    await user.click(screen.getByRole('button', { name: /approve without signature/i }));

    expect(decideSpy).toHaveBeenCalledTimes(1);
    expect(decideSpy.mock.calls[0][0].input.approvedAmount).toBe(85_000);
  });

  it('never offers the amount field when the actor is the Inventory Manager', () => {
    renderDialog({
      approval: { ...approval(), stage: ApprovalStage.INVENTORY_MANAGER },
      approve: true,
    });
    expect(screen.queryByLabelText(/revise the sanctioned amount/i)).not.toBeInTheDocument();
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