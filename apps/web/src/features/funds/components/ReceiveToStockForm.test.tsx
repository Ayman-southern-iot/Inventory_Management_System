import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RequisitionFunding } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import { ReceiveToStockForm } from './ReceiveToStockForm';

/**
 * Message audit M2. Choosing "It is a new product" and leaving the Storage ID empty reached the
 * server, which refused it, and the only feedback was a toast reading "String must contain at least
 * 1 character(s)". Neither field was marked required. The form now says what is missing, on the
 * field, before anything is sent.
 */
const receive = vi.fn();

vi.mock('../api', () => ({
  useReceiveIntoStock: () => ({ mutateAsync: receive, isPending: false }),
}));

vi.mock('@/features/inventory/api', () => ({
  useAllProducts: () => ({ data: [{ id: 'p-1', name: 'Something else', productCode: 'ELC-0001' }] }),
  useCategoryTree: () => ({ data: [] }),
  useZones: () => ({ data: [] }),
}));

const FUNDING = {
  purchases: [
    {
      id: 'purchase-1',
      lines: [
        {
          id: 'line-1',
          requisitionItemId: 'item-1',
          itemName: 'Brand new gizmo',
          quantity: 3,
          unitCost: 100,
          lineTotal: 300,
          overBomQuantity: false,
          overBomNote: null,
          receivedQuantity: 0,
          outstandingQuantity: 3,
          productId: null,
        },
      ],
    },
  ],
} as unknown as RequisitionFunding;

function open() {
  return render(
    <ToastProvider>
      <ReceiveToStockForm requisitionId="req-1" funding={FUNDING} onClose={() => {}} />
    </ToastProvider>,
  );
}

describe('ReceiveToStockForm', () => {
  beforeEach(() => {
    receive.mockReset();
  });

  it('marks the new product fields as required', () => {
    open();
    expect(screen.getByLabelText(new RegExp(t.funds.productCode))).toBeRequired();
    expect(screen.getByLabelText(new RegExp(t.funds.productName))).toBeRequired();
  });

  it('says a new product needs a storage ID, on the field, and sends nothing', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('button', { name: t.common.save }));

    expect(await screen.findByText(t.funds.productCodeRequired)).toBeInTheDocument();
    expect(receive).not.toHaveBeenCalled();
    // The library's own wording never reaches the screen.
    expect(screen.queryByText(/character\(s\)/)).toBeNull();
  });

  it('says which product to pick when "a product we already stock" is chosen and none is', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByLabelText(t.funds.useExistingProduct));
    await user.click(screen.getByRole('button', { name: t.common.save }));

    expect(await screen.findByText(t.funds.existingProductRequired)).toBeInTheDocument();
    expect(receive).not.toHaveBeenCalled();
  });

  it('clears the message once the person edits the line', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('button', { name: t.common.save }));
    expect(await screen.findByText(t.funds.productCodeRequired)).toBeInTheDocument();

    await user.type(screen.getByLabelText(new RegExp(t.funds.productCode)), 'GIZ-1');
    expect(screen.queryByText(t.funds.productCodeRequired)).toBeNull();
  });
});
