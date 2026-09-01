import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  transportationCost: null,
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
  transportationCost: null,
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

/** `entry` carries the query string, which is how a requisition arrives already chosen. */
function renderGenerate(entry = '/boms/new') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
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

    // Generate is present but refused. It used to be absent entirely, which is QA-039: once
    // the IM edited the quantity and unit cost until the BOM fitted, the screen still offered
    // only send-back, with a footer plainly showing a variance of zero. A control the IM is
    // working towards has to stay visible, or there is nothing to aim at.
    expect(screen.getByRole('button', { name: t.boms.generate })).toBeDisabled();
    // Send back stays available beside it, for the one case adjusting cannot solve.
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

/**
 * Arriving from an approved requisition.
 *
 * Ayman, 2026-09-01: the tracker on a fully approved requisition now links here. That link is
 * only worth following if it brings the requisition with it — otherwise it has dropped the IM
 * into the same list they were trying to avoid searching.
 */
describe('BomGeneratePage — a requisition chosen by the link that got here', () => {
  beforeEach(() => {
    vi.mocked(bomApi.useBomCandidates).mockReturnValue({
      data: [SINGLE_OVER_BUDGET, MULTI_ITEM],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof bomApi.useBomCandidates>);
  });

  /**
   * A picked requisition prints its number twice — once in the picker, once as the group header
   * over its lines — so the row has to be found by the one that is a picker row.
   */
  const pickerRow = (requisitionNo: string) =>
    screen
      .getAllByText(requisitionNo)
      .map((node) => node.closest('label'))
      .find((label): label is HTMLLabelElement => label !== null)!;

  it('opens with the requisition named in the URL already ticked, and only that one', () => {
    renderGenerate('/boms/new?requisition=r-multi');

    expect(within(pickerRow('REQ-000101')).getByRole('checkbox')).toBeChecked();
    expect(within(pickerRow('REQ-000100')).getByRole('checkbox')).not.toBeChecked();
  });

  /** The lines have to be loaded too, or the ticked row is a tick and nothing else. */
  it('loads the picked requisition’s lines ready to adjust', () => {
    renderGenerate('/boms/new?requisition=r-multi');

    // Both of the multi-item candidate lines, each with its editable quantity.
    expect(screen.getAllByLabelText(t.boms.lineQuantityLabel)).toHaveLength(2);
  });

  /**
   * A link kept in a tab overnight, followed after somebody else put that requisition on a BOM.
   * The id no longer matches a candidate, and the right outcome is an ordinary empty picker —
   * not a crash, and not a phantom selection the IM cannot see to clear.
   */
  it('opens with nothing ticked when the id is no longer a candidate', () => {
    renderGenerate('/boms/new?requisition=r-gone');

    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).not.toBeChecked();
    }
  });

  it('opens with nothing ticked when no requisition was named', () => {
    renderGenerate();

    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).not.toBeChecked();
    }
  });
});
