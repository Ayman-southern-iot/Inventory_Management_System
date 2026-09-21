import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CategoryNode } from '@ims/shared';
import { t } from '@/i18n/en';
import { ProductFormDialog } from './ProductFormDialog';

/**
 * The New product form after the 2026-09-21 redesign.
 *
 * The behaviour worth guarding is "Save and add another": it must save, keep the dialog open,
 * and clear the name while *keeping* the classification — a batch of parts is nearly always a
 * run of siblings, and re-picking three levels per row is the friction it exists to remove.
 */

const createSpy = vi.fn();
const onClose = vi.fn();
const onCreated = vi.fn();

const TREE: CategoryNode[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Electronics',
    parentId: null,
    isTrackable: true,
    isActive: true,
    productCount: 0,
    productCountInTree: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    children: [],
  },
];

vi.mock('../api', () => ({
  useCategoryTree: () => ({ data: TREE }),
  useCreateProduct: () => ({
    mutateAsync: (input: unknown) => {
      createSpy(input);
      return Promise.resolve({ id: 'p-new' });
    },
    isPending: false,
  }),
  useUpdateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ hasRole: () => true }),
}));

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProductFormDialog open onClose={onClose} onCreated={onCreated} />
    </QueryClientProvider>,
  );
}

const nameField = () => screen.getByLabelText(new RegExp(`^${t.inventory.name}`));

describe('the new product form', () => {
  beforeEach(() => {
    createSpy.mockClear();
    onClose.mockClear();
    onCreated.mockClear();
  });

  it('asks for a name and a unit, and no Storage ID', () => {
    renderForm();

    expect(nameField()).toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(t.inventory.unit))).toBeInTheDocument();
    // The code generates itself since migration 0036 — the field is gone, not hidden.
    expect(screen.queryByLabelText(new RegExp(t.inventory.productCode))).not.toBeInTheDocument();
  });

  it('saves without a category, because classification is optional', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(nameField(), 'Redwan 470uF capacitor');
    await user.click(screen.getByRole('button', { name: t.inventory.saveProduct }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Redwan 470uF capacitor', categoryId: null }),
      ),
    );
    expect(onClose).toHaveBeenCalled();
  });

  /** The whole point of the checkbox: the dialog stays put. */
  it('keeps the dialog open when Save and add another is ticked', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByLabelText(t.inventory.saveAndAddAnother));
    await user.type(nameField(), 'First part');
    await user.click(screen.getByRole('button', { name: t.inventory.saveProduct }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    // And it does not navigate away either — that would defeat it just as thoroughly.
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('clears the name but keeps the classification for the next one', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByLabelText(t.inventory.saveAndAddAnother));
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${t.inventory.categoryLevel1}`)),
      '11111111-1111-4111-8111-111111111111',
    );
    await user.type(nameField(), 'First part');
    await user.click(screen.getByRole('button', { name: t.inventory.saveProduct }));

    await waitFor(() => expect(nameField()).toHaveValue(''));
    expect(screen.getByLabelText(new RegExp(`^${t.inventory.categoryLevel1}`))).toHaveValue(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('navigates to the new product when Save and add another is off', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(nameField(), 'One off');
    await user.click(screen.getByRole('button', { name: t.inventory.saveProduct }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('p-new'));
  });
});
