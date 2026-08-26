import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm, useWatch } from 'react-hook-form';
import type { Product, SaveRequisitionInput } from '@ims/shared';
import { t } from '@/i18n/en';
import { ItemRow } from './ItemRow';

/**
 * Ayman's requirement, 2026-08-26: "the item field should work as a search bar". The problem it
 * solves is not typing speed — it is that two requesters buying the same board type "Arduino Uno
 * R3" and "arduino uno", and the system ends up holding two products nothing can reconcile.
 *
 * So the behaviours worth pinning are: the list is the whole catalogue and opens before you type,
 * stock never removes anything from it, and free text that names a catalogue entry gets linked
 * without the requester having to notice the list existed.
 *
 * Free text stays possible on purpose — requirements §3 requires that something we do not stock
 * yet is still requestable, which is why this is a search field and not a `<select>`.
 */
const product = (over: Partial<Product> & Pick<Product, 'id' | 'name' | 'productCode'>): Product => ({
  categoryId: '00000000-0000-0000-0000-000000000001',
  categoryName: 'Boards',
  isTrackable: true,
  unit: 'pcs',
  defaultReturnable: false,
  description: null,
  isActive: true,
  totalQuantity: 0,
  totalReserved: 0,
  totalAvailable: 0,
  totalOnHand: 0,
  totalQuarantined: 0,
  totalInUse: 0,
  totalOwned: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const UNO = product({
  id: 'p-uno',
  name: 'Arduino Uno R3',
  productCode: 'ARD-UNO-R3',
  totalAvailable: 7,
});
/** Zero stock, deliberately. It must still be offered. */
const NANO = product({ id: 'p-nano', name: 'Arduino Nano', productCode: 'ARD-NANO' });
const BREADBOARD = product({
  id: 'p-bb',
  name: 'Breadboard 830',
  productCode: 'BB-830',
  totalAvailable: 3,
});

const CATALOGUE = [UNO, NANO, BREADBOARD];

/**
 * Mirrors `ItemRowContainer` in the form page: the same `useWatch` subscription, and the same
 * `onPickProduct` that writes both `productId` and `itemName`. A harness that only recorded the
 * callback would pass while the field never actually updated.
 */
function Harness({ products = CATALOGUE }: { products?: Product[] }) {
  const form = useForm<SaveRequisitionInput>({
    defaultValues: {
      items: [{ itemName: '', quantity: undefined, estimatedUnitPrice: undefined, productId: null, note: null }],
    } as unknown as SaveRequisitionInput,
  });
  const item = useWatch({ control: form.control, name: 'items.0' });

  return (
    <table>
      <tbody>
        <ItemRow
          index={0}
          control={form.control}
          register={form.register}
          products={products}
          productId={item?.productId ?? null}
          itemName={item?.itemName ?? ''}
          quantity={item?.quantity}
          unitPrice={item?.estimatedUnitPrice}
          onPickProduct={(picked) => {
            form.setValue('items.0.productId', picked?.id ?? null);
            if (picked) form.setValue('items.0.itemName', picked.name);
          }}
          onRemove={() => {}}
          canRemove={false}
          errors={{}}
        />
      </tbody>
    </table>
  );
}

const itemField = () => screen.getByRole('combobox', { name: `${t.requisitions.itemName} 1` });
const options = () => within(screen.getByRole('listbox')).getAllByRole('option');

describe('the item field as a search bar', () => {
  it('opens the whole catalogue on focus, before a character is typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(itemField());

    expect(options()).toHaveLength(CATALOGUE.length);
  });

  /**
   * The rule that would be easy to get backwards. A requisition is precisely how you get an item
   * you have none of, so out-of-stock products must stay in the list rather than being filtered
   * out of it — the count is shown, it does not gate.
   */
  it('offers a product with no stock, and says so rather than hiding it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(itemField());

    const nano = options().find((option) => option.textContent?.includes('Arduino Nano'));
    expect(nano).toBeDefined();
    expect(nano).toHaveTextContent(t.requisitions.outOfStock);
  });

  it('narrows as you type and ranks the exact name first', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(itemField(), 'arduino');

    const shown = options().map((option) => option.textContent);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toContain('Arduino Nano');
  });

  it('fills the field from a clicked suggestion', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(itemField(), 'uno');
    await user.click(screen.getByRole('option', { name: /Arduino Uno R3/ }));

    expect(itemField()).toHaveValue('Arduino Uno R3');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // Linked, so the line carries a product id rather than a loose string.
    expect(screen.getByText(t.requisitions.inStockHint.replace('{n}', '7'))).toBeInTheDocument();
  });

  it('picks with the keyboard, so the field never needs the mouse', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(itemField(), 'ard');
    await user.keyboard('{ArrowDown}{Enter}');

    // 'ard' ranks Arduino Nano first alphabetically; ArrowDown moves to Arduino Uno R3.
    expect(itemField()).toHaveValue('Arduino Uno R3');
  });

  it('closes on Escape without changing what was typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(itemField(), 'ardu');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(itemField()).toHaveValue('ardu');
  });

  /**
   * The duplicate guard, and the reason this work was asked for. Someone who types the catalogue
   * name freehand and never opens the list still ends up on the catalogue entry.
   */
  it('links free text that matches a catalogue name, ignoring case and spacing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(itemField(), 'arduino  uno r3');
    await user.tab();

    // commitOnBlur is deferred so a click on the list can win the race with blur.
    await screen.findByText(t.requisitions.inStockHint.replace('{n}', '7'));
    expect(itemField()).toHaveValue('Arduino Uno R3');
  });

  /**
   * A near miss is the requester's call, not ours: "Arduino Uno" is a different order from
   * "Arduino Uno R3" and linking it silently would attach the requisition to the wrong product.
   */
  it('offers a near match as a suggestion instead of linking it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(itemField(), 'Arduino Uno');
    await user.tab();

    const didYouMean = await screen.findByRole('button', {
      name: t.requisitions.didYouMean.replace('{name}', 'Arduino Uno R3'),
    });

    await user.click(didYouMean);
    expect(itemField()).toHaveValue('Arduino Uno R3');
  });

  /** Requirements §3: an item we do not stock yet must still be requestable. */
  it('keeps free text that matches nothing, and says it will be a new item', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(itemField(), 'Oscilloscope probe');

    expect(screen.getByText(t.requisitions.noCatalogueMatch)).toBeInTheDocument();

    await user.tab();
    expect(itemField()).toHaveValue('Oscilloscope probe');
    expect(screen.getByText(t.requisitions.freeText)).toBeInTheDocument();
  });

  /**
   * Editing a linked name has to break the link. Otherwise the line claims a product whose name
   * it no longer carries, and the BOM prints one thing while the requisition says another.
   */
  it('unlinks when the requester edits a name they picked', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(itemField(), 'uno');
    await user.click(screen.getByRole('option', { name: /Arduino Uno R3/ }));
    expect(screen.getByText(t.requisitions.inStockHint.replace('{n}', '7'))).toBeInTheDocument();

    await user.type(itemField(), ' rev B');
    expect(
      screen.queryByText(t.requisitions.inStockHint.replace('{n}', '7')),
    ).not.toBeInTheDocument();
  });

  it('does not open a list when the catalogue is empty', async () => {
    const user = userEvent.setup();
    render(<Harness products={[]} />);
    await user.click(itemField());

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
