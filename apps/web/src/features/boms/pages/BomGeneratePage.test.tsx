import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser, type BomCandidate } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import * as bomApi from '../api';
import { BomGeneratePage } from './BomGeneratePage';

/**
 * Two paths through the IM-side BOM generator:
 *
 *   - 1-item + over-budget: the IM cannot shrink a single line to fit, so the Generate
 *     button is replaced by "Send back for revision". The dialog asks for a reason and
 *     posts to `useSendBackForRevision`.
 *   - Multi-item: the IM gets per-line quantity input + remove checkbox, plus the
 *     Generate button. Submitted rows include the wire payload shape the backend expects.
 *
 * Mocks the API surface (`useBomCandidates`, `useGenerateBom`, `useSendBackForRevision`)
 * and the auth context, so the page mounts without a network.
 */

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useBomCandidates: vi.fn(),
    useGenerateBom: vi.fn(),
    useSendBackForRevision: vi.fn(),
  };
});

vi.mock('@/features/auth/auth-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'u1',
        email: 'im@ims.local',
        fullName: 'Inara IM',
        designation: 'Inventory Manager',
        departmentId: null,
        departmentName: null,
        roles: [Role.INVENTORY_MANAGER],
        mustChangePassword: false,
      } as AuthUser,
      isRestoring: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshUser: vi.fn(),
      hasRole: () => true,
    }),
  };
});

const SINGLE_OVER_BUDGET: BomCandidate = {
  requisitionId: 'r-single',
  requisitionNo: 'REQ-000100',
  requesterName: 'Rana',
  departmentName: 'Lab',
  projectName: null,
  approvedAmount: 10_000,
  items: [
    {
      requisitionItemId: 'ri-single',
      productId: null,
      itemName: 'Single widget',
      quantity: 1,
      estimatedUnitPrice: 12_500,
      purpose: null,
    },
  ],
};

const MULTI_ITEM: BomCandidate = {
  requisitionId: 'r-multi',
  requisitionNo: 'REQ-000101',
  requesterName: 'Rana',
  departmentName: 'Lab',
  projectName: 'P',
  approvedAmount: 40_000,
  items: [
    {
      requisitionItemId: 'ri-multi-1',
      productId: null,
      itemName: 'Item A',
      quantity: 2,
      estimatedUnitPrice: 10_000,
      purpose: null,
    },
    {
      requisitionItemId: 'ri-multi-2',
      productId: null,
      itemName: 'Item B',
      quantity: 1,
      estimatedUnitPrice: 8_000,
      purpose: null,
    },
  ],
};

function renderGenerate() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/boms/new']}>
          <BomGeneratePage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('BomGeneratePage', () => {
  it('shows the Send back for revision path on a 1-item over-budget requisition', async () => {
    const user = userEvent.setup();
    vi.mocked(bomApi.useBomCandidates).mockReturnValue({
      data: [SINGLE_OVER_BUDGET],
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBomCandidates>);
    vi.mocked(bomApi.useGenerateBom).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof bomApi.useGenerateBom>);
    const sendBackMutate = vi.fn().mockResolvedValue({});
    vi.mocked(bomApi.useSendBackForRevision).mockReturnValue({
      mutateAsync: sendBackMutate,
      isPending: false,
    } as unknown as ReturnType<typeof bomApi.useSendBackForRevision>);

    renderGenerate();

    // Tick the over-budget candidate.
    const pickerRow = screen.getByText('REQ-000100').closest('label')!;
    await user.click(within(pickerRow).getByRole('checkbox'));

    // No "Generate" button — the single-line path doesn't go through the BOM at all.
    expect(screen.queryByRole('button', { name: t.boms.generate })).not.toBeInTheDocument();
    // The Send back for revision primary is the only path.
    expect(
      screen.getByRole('button', { name: t.boms.sendBackForRevision }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.boms.sendBackForRevision }));

    // Dialog opens, reason field appears, confirm is disabled until reason ≥ 3 chars.
    const dialog = await screen.findByRole('dialog');
    // The title is prefixed with the requisition number for context (the requester
    // sees this on the audit trail too).
    expect(
      within(dialog).getByText(`${t.boms.sendBackDialog.title} · REQ-000100`),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', {
      name: t.boms.sendBackDialog.confirm,
    });
    expect(confirm).toBeDisabled();

    // Use fireEvent.change — `user.type` walks one keystroke at a time, and the
    // controlled input here re-renders the page (and thus the dialog portal) on every
    // keystroke, which loses focus mid-stream in jsdom. Setting the value all at once
    // is the natural way to assert the same condition without fighting the DOM.
    const textarea = within(dialog).getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Approved amount too low' } });
    expect(textarea).toHaveValue('Approved amount too low');
    expect(confirm).toBeEnabled();

    await user.click(confirm);

    expect(sendBackMutate).toHaveBeenCalledWith({
      id: 'r-single',
      input: { reason: 'Approved amount too low' },
    });
  });

  it('multi-item requisition exposes per-line quantity + remove + Generate', async () => {
    const user = userEvent.setup();
    vi.mocked(bomApi.useBomCandidates).mockReturnValue({
      data: [MULTI_ITEM],
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof bomApi.useBomCandidates>);
    const generateMutate = vi.fn().mockResolvedValue({ id: 'bom-new' });
    vi.mocked(bomApi.useGenerateBom).mockReturnValue({
      mutateAsync: generateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof bomApi.useGenerateBom>);
    vi.mocked(bomApi.useSendBackForRevision).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof bomApi.useSendBackForRevision>);

    renderGenerate();

    await user.click(screen.getByText('REQ-000101').closest('label')!);

    // Two line rows, each with the Qty + Remove controls.
    expect(screen.getAllByLabelText(t.boms.lineQuantityLabel)).toHaveLength(2);
    expect(screen.getAllByLabelText(t.boms.removeLineLabel)).toHaveLength(2);
    // Generate is the only forward path; no send-back branch.
    expect(screen.getByRole('button', { name: t.boms.generate })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.boms.sendBackForRevision }),
    ).not.toBeInTheDocument();

    // Drop the second line, click Generate. The wire payload should ship one line.
    const removeCheckboxes = screen.getAllByLabelText(t.boms.removeLineLabel);
    await user.click(removeCheckboxes[1]!);

    await user.click(screen.getByRole('button', { name: t.boms.generate }));

    expect(generateMutate).toHaveBeenCalledTimes(1);
    const payload = generateMutate.mock.calls[0]![0];
    expect(payload.requisitionIds).toEqual(['r-multi']);
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0]).toMatchObject({
      requisitionItemId: 'ri-multi-1',
      removed: false,
    });
    // Quantity matches source, so the wire field is undefined (server reads source).
    expect(payload.lines[0].quantity).toBeUndefined();
  });
});