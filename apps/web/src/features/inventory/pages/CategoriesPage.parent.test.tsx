import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CategoryNode } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import * as inventoryApi from '../api';
import { CategoriesPage } from './CategoriesPage';

/**
 * The parent picker is back (spec §4, migration 0035).
 *
 * This file used to assert its *absence*. The picker was removed when re-parenting had no cycle
 * guard, and the note left behind read "re-adding the picker is the only change needed to bring
 * nesting back". 0035 supplies that guard in the database — a trigger refusing a move under the
 * node's own descendant, and refusing anything that would land at a fourth level — so nesting
 * is back and this file asserts the new rule. Inverted deliberately; not skipped.
 *
 * The assertion worth having is the last one: that a chosen parent actually reaches the API. A
 * picker that renders but sends `parentId: null` looks completely correct on screen and quietly
 * flattens the entire tree.
 */

const TREE: CategoryNode[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Laptops',
    parentId: null,
    isTrackable: true,
    isActive: true,
    productCount: 2,
    productCountInTree: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    children: [],
  },
];

const createMutate = vi.fn().mockResolvedValue({});

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
  } as unknown as ReturnType<typeof inventoryApi.useCreateCategory>);

  vi.mocked(inventoryApi.useUpdateCategory).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
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

describe('CategoriesPage — the parent picker', () => {
  it('offers a parent control listing the existing categories', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: t.categories.newCategory }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const picker = screen.getByLabelText(new RegExp(t.categories.parent, 'i'));
    expect(picker).toBeInTheDocument();
    expect(
      Array.from(picker.querySelectorAll('option')).map((o) => o.textContent?.trim()),
    ).toContain('Laptops');
  });

  /** Leaving it alone still means a top-level category — the common case must stay one click. */
  it('creates at the top level when no parent is chosen', async () => {
    const user = userEvent.setup();
    createMutate.mockClear();
    renderPage();

    await user.click(screen.getByRole('button', { name: t.categories.newCategory }));
    await user.type(screen.getByLabelText(new RegExp(t.categories.name, 'i')), 'Hop');
    await user.click(screen.getByRole('button', { name: t.common.save }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hop', parentId: null }),
    );
  });

  /**
   * The assertion this file exists for. A picker that renders but never sends its value looks
   * right on screen and quietly flattens the tree.
   */
  it('sends the chosen parent to the API', async () => {
    const user = userEvent.setup();
    createMutate.mockClear();
    renderPage();

    await user.click(screen.getByRole('button', { name: t.categories.newCategory }));
    await user.type(screen.getByLabelText(new RegExp(t.categories.name, 'i')), 'Ultrabooks');
    await user.selectOptions(
      screen.getByLabelText(new RegExp(t.categories.parent, 'i')),
      '11111111-1111-4111-8111-111111111111',
    );
    await user.click(screen.getByRole('button', { name: t.common.save }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ultrabooks',
        parentId: '11111111-1111-4111-8111-111111111111',
      }),
    );
  });
});
