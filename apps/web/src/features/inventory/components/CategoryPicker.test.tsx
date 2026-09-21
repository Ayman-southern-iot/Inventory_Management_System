import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CategoryNode } from '@ims/shared';
import { t } from '@/i18n/en';
import { CategoryPicker } from './CategoryPicker';

/**
 * Three rules from `category-taxonomy-spec.md` that a flat dropdown cannot express, and which
 * are the whole reason this control exists:
 *
 *   §6  Cascading, not one list of ~200 leaves.
 *   §1  Every level skippable — level 1 and level 2 are valid answers, and so is nothing.
 *   §5  Inline creation at any level, IM-only, so nobody abandons a half-filled product form
 *       to go and make a category.
 */

const createMutate = vi.fn();

vi.mock('../api', () => ({
  useCreateCategory: () => ({ mutateAsync: createMutate, isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const node = (id: string, name: string, children: CategoryNode[] = []): CategoryNode => ({
  id,
  name,
  parentId: null,
  isTrackable: true,
  isActive: true,
  productCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  children,
});

const TREE: CategoryNode[] = [
  node('c-electronics', 'Electronics', [
    node('c-sensors', 'Sensors', [node('c-imu', 'Motion / IMU')]),
    node('c-passive', 'Passive Components'),
  ]),
  node('c-mechanical', 'Mechanical & Structural'),
];

function Host({ initial = null, canCreate = true }: { initial?: string | null; canCreate?: boolean }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <CategoryPicker tree={TREE} value={value} onChange={setValue} canCreate={canCreate} />
      <output data-testid="chosen">{value ?? 'none'}</output>
    </>
  );
}

function renderPicker(props: { initial?: string | null; canCreate?: boolean } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Host {...props} />
    </QueryClientProvider>,
  );
}

// Anchored: 'Category' is a substring of 'Subcategory', so an unanchored match finds both.
const level1 = () => screen.getByLabelText(new RegExp('^' + t.inventory.categoryLevel1));
const level2 = () => screen.getByLabelText(new RegExp('^' + t.inventory.categoryLevel2));
const chosen = () => screen.getByTestId('chosen').textContent;

describe('the category picker', () => {
  beforeEach(() => {
    createMutate.mockReset();
  });

  it('shows only the top level until one is chosen', () => {
    renderPicker();

    expect(screen.getByRole('option', { name: 'Electronics' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Sensors' })).not.toBeInTheDocument();
  });

  it('reveals the next level down, narrowed to the chosen branch', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.selectOptions(level1(), 'c-electronics');

    expect(screen.getByRole('option', { name: 'Sensors' })).toBeInTheDocument();
    // Mechanical is a sibling of Electronics, not a child of it.
    expect(screen.queryByRole('option', { name: 'Mechanical & Structural' })).toBeInTheDocument();
    expect(chosen()).toBe('c-electronics');
  });

  /** §1: stopping at level 1 is a valid answer, not an unfinished one. */
  it('keeps a level-1 choice as the value when no subcategory is picked', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.selectOptions(level1(), 'c-electronics');
    expect(chosen()).toBe('c-electronics');
  });

  it('takes the deepest chosen level as the value', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.selectOptions(level1(), 'c-electronics');
    await user.selectOptions(level2(), 'c-sensors');
    expect(chosen()).toBe('c-sensors');
  });

  /** Clearing a level falls back to its parent, not to nothing. */
  it('falls back to the parent when a level is cleared', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.selectOptions(level1(), 'c-electronics');
    await user.selectOptions(level2(), 'c-sensors');
    await user.selectOptions(level2(), '');

    expect(chosen()).toBe('c-electronics');
  });

  it('opens with the whole path filled in when a deep category arrives already set', () => {
    renderPicker({ initial: 'c-imu' });

    expect(level1()).toHaveValue('c-electronics');
    expect(level2()).toHaveValue('c-sensors');
  });

  it('allows no category at all', async () => {
    const user = userEvent.setup();
    renderPicker({ initial: 'c-electronics' });

    await user.selectOptions(level1(), '');
    expect(chosen()).toBe('none');
  });

  /** §5: creating inline selects the new node immediately — that is the point of it. */
  it('creates a category inline and selects it', async () => {
    const user = userEvent.setup();
    createMutate.mockResolvedValue({ id: 'c-new' });
    renderPicker();

    await user.selectOptions(level1(), 'c-electronics');
    await user.click(
      screen.getByRole('button', {
        name: new RegExp(t.categories.newCategory + '.*' + t.inventory.categoryLevel2),
      }),
    );
    await user.type(screen.getByLabelText(t.categories.newCategory), 'Actuators');
    await user.click(screen.getByRole('button', { name: t.common.add }));

    // Created under whatever is selected one level up.
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Actuators', parentId: 'c-electronics' }),
    );
    expect(chosen()).toBe('c-new');
  });

  it('hides inline creation from anyone who cannot manage the catalogue', () => {
    renderPicker({ canCreate: false });

    expect(
      screen.queryByRole('button', { name: new RegExp(t.categories.newCategory) }),
    ).not.toBeInTheDocument();
  });
});
