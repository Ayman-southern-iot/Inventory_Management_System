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
 * Every category is created at the top level, so the New category dialog offers no parent
 * picker and the create call carries `parentId: null`.
 *
 * The interesting half is the second assertion. Dropping the `<select>` while leaving
 * `parentId` in the form's default values is the whole change, and nothing else in the app
 * would notice if a picker were quietly added back — the API still accepts a parent.
 */

const TREE: CategoryNode[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Laptops',
    parentId: null,
    isTrackable: true,
    isActive: true,
    productCount: 2,
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

describe('CategoriesPage — no parent picker', () => {
  it('offers no parent control when creating a category', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: t.categories.newCategory }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(/parent/i)).not.toBeInTheDocument();
  });

  it('creates the category at the top level', async () => {
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
});
