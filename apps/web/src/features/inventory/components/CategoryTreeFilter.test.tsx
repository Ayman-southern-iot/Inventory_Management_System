import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CategoryNode } from '@ims/shared';
import { t } from '@/i18n/en';
import {
  CATEGORY_ALL,
  CATEGORY_UNCATEGORIZED,
  CategoryTreeFilter,
  type CategorySelection,
} from './CategoryTreeFilter';

/**
 * The behaviours `category-tree-fix-plan.md` §1 lists as broken in the previous version. Each
 * test here is one row of that table, so a regression points at the bug it re-introduces.
 *
 * What these tests do **not** cover, and what nobody should claim from a green run: this has not
 * been through a screen reader. The ARIA wiring follows the documented combobox/treeview
 * pattern, which is a different claim from "verified in NVDA or VoiceOver" (fix-plan §3).
 */

const node = (
  id: string,
  name: string,
  count: number,
  children: CategoryNode[] = [],
): CategoryNode => ({
  id,
  name,
  parentId: null,
  isTrackable: true,
  isActive: true,
  productCount: count,
  productCountInTree: count + children.reduce((sum, c) => sum + c.productCountInTree, 0),
  createdAt: '2026-09-01T00:00:00.000Z',
  children,
});

const TREE: CategoryNode[] = [
  node('electronics', 'Electronics', 0, [
    node('sensors', 'Sensors', 0, [node('imu', 'Motion IMU', 4), node('temp', 'Temperature', 3)]),
    node('passive', 'Passive Components', 2),
  ]),
  node('mechanical', 'Mechanical', 0, [node('bearings', 'Bearings', 7)]),
];

function Host({ initial = CATEGORY_ALL }: { initial?: CategorySelection }) {
  const [value, setValue] = useState<CategorySelection>(initial);
  return (
    <>
      <CategoryTreeFilter tree={TREE} value={value} onChange={setValue} />
      <output data-testid="chosen">{value}</output>
      <button type="button">after</button>
    </>
  );
}

const trigger = () => screen.getByRole('combobox');
const searchBox = () => screen.getByLabelText(t.inventory.categorySearch);
const chosen = () => screen.getByTestId('chosen').textContent;
const rowNames = () => screen.getAllByRole('treeitem').map((r) => r.textContent?.trim());

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  await screen.findByRole('tree');
}

describe('the category tree filter', () => {
  it('opens showing only the top level, plus the two pinned rows', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    const names = rowNames();
    expect(names?.[0]).toContain(t.inventory.allCategories);
    expect(names?.[1]).toContain(t.inventory.uncategorized);
    expect(names?.some((n) => n?.includes('Electronics'))).toBe(true);
    // Nothing below the top level until a branch is expanded.
    expect(names?.some((n) => n?.includes('Sensors'))).toBe(false);
  });

  it('shows the rolled-up count on a branch, not just its direct products', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    // Electronics has no products of its own; 4 + 3 + 2 sit beneath it.
    const electronics = screen.getAllByRole('treeitem').find((r) => r.textContent?.includes('Electronics'));
    expect(electronics?.textContent).toContain('9');
  });

  /**
   * Fix-plan §1 bug 1, the headline one: matching a branch used to dump its entire subtree.
   * Searching "Bearings" must show the path down to it and nothing from the other branch.
   */
  it('narrows to matches and their ancestors, not whole subtrees', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    await user.type(searchBox(), 'Bearings');

    await waitFor(() => {
      const names = rowNames();
      expect(names?.some((n) => n?.includes('Mechanical'))).toBe(true);
      expect(names?.some((n) => n?.includes('Bearings'))).toBe(true);
      // The other branch and its children are gone entirely.
      expect(names?.some((n) => n?.includes('Electronics'))).toBe(false);
      expect(names?.some((n) => n?.includes('Passive'))).toBe(false);
    });
  });

  /** Matching a parent shows the parent — not the parent and everything under it. */
  it('does not expand a branch just because its own label matched', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    await user.type(searchBox(), 'Sensors');

    await waitFor(() => {
      const names = rowNames();
      expect(names?.some((n) => n?.includes('Sensors'))).toBe(true);
      expect(names?.some((n) => n?.includes('Motion IMU'))).toBe(false);
    });
  });

  /** Fix-plan §1 bug 2: the footer used to claim arrow keys that did not exist. */
  it('walks the tree with the arrow keys and selects with Enter', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    // Down past the two pinned rows to Electronics, right to open it, down to Sensors.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(chosen()).toBe('sensors');
  });

  it('moves the ARIA cursor without taking focus off the search box', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    await user.keyboard('{ArrowDown}');

    // Real focus stays on the input; `aria-activedescendant` is what moves.
    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveAttribute('aria-activedescendant', expect.stringContaining('category-opt-'));
  });

  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    await user.keyboard('{End}');
    expect(searchBox().getAttribute('aria-activedescendant')).toBe('category-opt-mechanical');

    await user.keyboard('{Home}');
    expect(searchBox().getAttribute('aria-activedescendant')).toBe(`category-opt-${CATEGORY_ALL}`);
  });

  /** Fix-plan §1 bug 3: Escape used to clear the query and then do nothing forever. */
  it('clears the query on the first Escape and closes on the second', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    await user.type(searchBox(), 'Bear');
    await user.keyboard('{Escape}');

    expect(searchBox()).toHaveValue('');
    expect(screen.getByRole('tree')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  /**
   * Fix-plan §1 bug 4, and the regression test §3 explicitly asks for because the fix rests on
   * a `focusout` + next-tick timing assumption rather than a guarantee.
   */
  it('closes when focus tabs out of the panel', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    await user.click(screen.getByRole('button', { name: 'after' }));

    await waitFor(() => expect(screen.queryByRole('tree')).not.toBeInTheDocument());
  });

  /** Fix-plan §1 bug 5: focus used to vanish into the closed panel. */
  it('returns focus to the trigger after a selection', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    await user.click(screen.getByText('Electronics'));

    expect(chosen()).toBe('electronics');
    expect(trigger()).toHaveFocus();
  });

  it('carries the ARIA semantics a tree needs', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'tree');

    const electronics = screen.getAllByRole('treeitem').find((r) => r.textContent?.includes('Electronics'));
    expect(electronics).toHaveAttribute('aria-level', '1');
    expect(electronics).toHaveAttribute('aria-expanded', 'false');
  });

  /** Fix-plan §1 bug 8: a selection pointing at a deleted category showed a dead label forever. */
  it('falls back to All categories when the selection no longer exists', async () => {
    const user = userEvent.setup();
    render(<Host initial="deleted-node" />);

    await user.click(trigger());

    await waitFor(() => expect(chosen()).toBe(CATEGORY_ALL));
  });

  it('filters to uncategorised from the pinned row', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    await user.click(screen.getByText(t.inventory.uncategorized));
    expect(chosen()).toBe(CATEGORY_UNCATEGORIZED);
  });

  it('toggles a branch from the chevron without selecting it', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);

    const electronics = screen.getAllByRole('treeitem').find((r) => r.textContent?.includes('Electronics'));
    await user.click(electronics!.querySelector('button')!);

    expect(rowNames()?.some((n) => n?.includes('Sensors'))).toBe(true);
    // Expanding is not choosing.
    expect(chosen()).toBe(CATEGORY_ALL);
  });
});
