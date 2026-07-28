import type { Category, CategoryNode } from '@ims/shared';

/**
 * A tree node flattened for a `<select>`, which cannot nest, and for the management table.
 * Extends `Category` so a row can be handed straight back to an edit form without being
 * reassembled from parts.
 */
export interface FlatCategory extends Category {
  depth: number;
}

/** Non-breaking spaces, because a `<select>` collapses ordinary leading whitespace. */
const INDENT_PER_LEVEL = '  ';

export function indentFor(depth: number): string {
  return INDENT_PER_LEVEL.repeat(depth);
}

/** Depth-first, so a child always renders directly under its parent. */
export function flattenCategoryTree(nodes: CategoryNode[], depth = 0): FlatCategory[] {
  return nodes.flatMap(({ children, ...category }) => [
    { ...category, depth },
    ...flattenCategoryTree(children, depth + 1),
  ]);
}

/**
 * Categories a product can actually be filed under. An inactive category is a soft-deleted one,
 * so offering it would let the IM file new products into something already retired.
 */
export function selectableCategories(nodes: CategoryNode[]): FlatCategory[] {
  return flattenCategoryTree(nodes).filter((category) => category.isActive);
}
