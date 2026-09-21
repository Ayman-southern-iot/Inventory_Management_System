import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CategoryNode } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import * as inventoryApi from '../api';
import { CategoriesPage } from './CategoriesPage';

/**
 * Category management, after the 2026-09-22 rebuild to `category-clean.html`.
 *
 * **This file replaces `CategoriesPage.parent.test.tsx`**, which asserted a modal with a parent
 * `<select>` that no longer exists — you now choose a parent by clicking `+` on its row, which
 * *is* the choice. Its central assertion is carried over verbatim in spirit and kept as the
 * most important test here: **a chosen parent must actually reach the API**. A tree that renders
 * beautifully and posts `parentId: null` looks completely correct on screen and silently
 * flattens the whole hierarchy. The old file was not deleted to get green; the interaction it
 * described was replaced on request, and the invariant moved with it.
 */

const LAPTOPS = '11111111-1111-4111-8111-111111111111';
const GAMING = '22222222-2222-4222-8222-222222222222';
const DESKS = '33333333-3333-4333-8333-333333333333';

function node(overrides: Partial<CategoryNode> & { id: string; name: string }): CategoryNode {
  return {
    parentId: null,
    isTrackable: true,
    isActive: true,
    productCount: 0,
    productCountInTree: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    children: [],
    ...overrides,
  };
}

const TREE: CategoryNode[] = [
  node({
    id: LAPTOPS,
    name: 'Laptops',
    productCount: 2,
    productCountInTree: 5,
    children: [node({ id: GAMING, name: 'Gaming', parentId: LAPTOPS, productCountInTree: 3 })],
  }),
  node({ id: DESKS, name: 'Desks', productCountInTree: 1 }),
];

const createMutate = vi.fn().mockResolvedValue({ id: 'new-id' });
const updateMutate = vi.fn().mockResolvedValue({});

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useCategoryTree: vi.fn(),
    useCreateCategory: vi.fn(),
    useUpdateCategory: vi.fn(),
  };
});

function renderPage() {
  vi.mocked(inventoryApi.useCategoryTree).mockReturnValue({
    data: TREE,
    isPending: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof inventoryApi.useCategoryTree>);

  vi.mocked(inventoryApi.useCreateCategory).mockReturnValue({
    mutateAsync: createMutate,
    isPending: false,
  } as unknown as ReturnType<typeof inventoryApi.useCreateCategory>);

  vi.mocked(inventoryApi.useUpdateCategory).mockReturnValue({
    mutateAsync: updateMutate,
    isPending: false,
  } as unknown as ReturnType<typeof inventoryApi.useUpdateCategory>);

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter>
          <CategoriesPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(name) });

/**
 * The tree toolbar's button. The empty detail panel offers the same action under the same
 * label, so on a wide screen both are present — deliberate in the mockup, ambiguous to a query.
 */
const addRootButton = () => screen.getAllByRole('button', { name: t.categories.addRoot })[0]!;

describe('CategoriesPage', () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
  });

  describe('the tree', () => {
    it('shows top-level categories and their subtree counts', () => {
      renderPage();
      expect(row('Laptops')).toBeInTheDocument();
      expect(row('Desks')).toBeInTheDocument();
      // The rollup, not the direct count: selecting a branch means its whole subtree.
      expect(within(row('Laptops')).getByText('5')).toBeInTheDocument();
    });

    it('keeps children hidden until the branch is expanded', async () => {
      const user = userEvent.setup();
      renderPage();

      expect(screen.queryByRole('treeitem', { name: /Gaming/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Expand Laptops/ }));
      expect(row('Gaming')).toBeInTheDocument();
    });

    /** A hit three levels down is useless if the path to it is collapsed. */
    it('opens every matching branch while searching, without a click', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(screen.getByLabelText(t.categories.filter), 'Gaming');

      expect(row('Gaming')).toBeInTheDocument();
      expect(screen.queryByRole('treeitem', { name: /Desks/ })).not.toBeInTheDocument();
    });

    it('says so when nothing matches', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(screen.getByLabelText(t.categories.filter), 'zzzz');
      expect(screen.getByText(/No categories match/)).toBeInTheDocument();
    });
  });

  describe('adding', () => {
    /**
     * The assertion inherited from the old parent-picker file, and the reason this page has
     * tests at all. Clicking `+` on a row *is* choosing that row as the parent.
     */
    it('sends the row you clicked as the parent', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: /Add subcategory to Laptops/ }));
      await user.type(screen.getByLabelText(t.categories.addChildName), 'Ultrabooks{Enter}');

      await waitFor(() =>
        expect(createMutate).toHaveBeenCalledWith({
          name: 'Ultrabooks',
          parentId: LAPTOPS,
          isTrackable: true,
        }),
      );
    });

    it('sends no parent for a top-level category', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(addRootButton());
      await user.type(screen.getByLabelText(t.categories.addRootName), 'Furniture{Enter}');

      await waitFor(() =>
        expect(createMutate).toHaveBeenCalledWith({
          name: 'Furniture',
          parentId: null,
          isTrackable: true,
        }),
      );
    });

    /** Caught before the round trip, and the message names where the clash is. */
    it('refuses a duplicate name among the same siblings', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(addRootButton());
      await user.type(screen.getByLabelText(t.categories.addRootName), 'Desks{Enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent(/already exists at the top level/);
      expect(createMutate).not.toHaveBeenCalled();
    });

    it('allows the same name under a different parent', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: /Add subcategory to Laptops/ }));
      await user.type(screen.getByLabelText(t.categories.addChildName), 'Desks{Enter}');

      await waitFor(() =>
        expect(createMutate).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Desks', parentId: LAPTOPS }),
        ),
      );
    });
  });

  describe('the detail panel', () => {
    it('shows nothing until a category is chosen', () => {
      renderPage();
      expect(screen.getByText(t.categories.nothingSelectedTitle)).toBeInTheDocument();
    });

    it('shows the selected category, its path and its counts', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: /Expand Laptops/ }));
      await user.click(row('Gaming'));

      expect(screen.getByRole('heading', { name: 'Gaming' })).toBeInTheDocument();
      expect(screen.getByText('Laptops / Gaming')).toBeInTheDocument();
    });

    it('renames through the API', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(row('Desks'));
      await user.click(screen.getByRole('button', { name: /Rename Desks/ }));
      const input = screen.getByLabelText(/Rename Desks/);
      await user.clear(input);
      await user.type(input, 'Workbenches{Enter}');

      await waitFor(() =>
        expect(updateMutate).toHaveBeenCalledWith({
          id: DESKS,
          input: { name: 'Workbenches' },
        }),
      );
    });

    it('toggles stock tracking through the API', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(row('Desks'));
      await user.click(screen.getByRole('switch', { name: new RegExp(t.categories.trackable) }));

      await waitFor(() =>
        expect(updateMutate).toHaveBeenCalledWith({ id: DESKS, input: { isTrackable: false } }),
      );
    });

    /** Nothing hangs below Desks, so there is nothing to warn about. */
    it('deactivates a leaf without asking twice', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(row('Desks'));
      await user.click(screen.getByRole('button', { name: t.categories.deactivate }));

      await waitFor(() =>
        expect(updateMutate).toHaveBeenCalledWith({ id: DESKS, input: { isActive: false } }),
      );
    });

    /**
     * OQ-G3: whether deactivating a parent cascades is undecided. Until it is, the UI has to
     * say what the button will actually do rather than let the IM assume either way.
     */
    it('warns what is underneath before deactivating a branch', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(row('Laptops'));
      await user.click(screen.getByRole('button', { name: t.categories.deactivate }));

      // Not sent yet — the first click only opens the warning.
      expect(updateMutate).not.toHaveBeenCalled();
      expect(screen.getByText(/1 active subcategory/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: t.categories.deactivateOnlyThis }));
      await waitFor(() =>
        expect(updateMutate).toHaveBeenCalledWith({ id: LAPTOPS, input: { isActive: false } }),
      );
    });

    it('offers no subcategory field at the depth cap', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: /Expand Laptops/ }));
      await user.click(row('Gaming'));

      // Gaming is level 2, so it may still take children.
      expect(screen.getByLabelText(t.categories.addChildName)).toBeInTheDocument();
    });
  });
});
