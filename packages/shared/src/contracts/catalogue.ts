import { z } from 'zod';

/**
 * The catalogue, shaped for the screen that consumes it.
 *
 * Ayman, 2026-09-21: another system shows this on a big display where people search for an
 * item. It stores nothing and reloads whenever it likes. The first version of this endpoint
 * handed over everything the database knew — 120 categories of which 113 held no products, four
 * UUIDs per shelf, `createdAt` on every node — and he was right that it was unusable. This one
 * answers the four questions that screen actually asks:
 *
 *   what is it        → code, name, unit, description
 *   what kind         → category, with its full path already resolved
 *   where is it       → readable location labels, per shelf
 *   how many          → total, available, in use
 *
 * **Nothing here needs a second lookup.** A category path arrives as a list of names, not a
 * `parentId` to chase up a tree; a location arrives as "Main Store / Meta / 1A", not three ids
 * to join. That is the difference between a payload a frontend renders and one it has to
 * reassemble.
 *
 * Deliberately **not** paginated, a considered exception to `rules/40-database.md`. That rule
 * exists so a caller cannot trigger an unbounded scan; here completeness is the whole point, so
 * the bound is a hard ceiling on the response instead (`CATALOGUE_MAX_PRODUCTS`). Past it the
 * endpoint refuses loudly rather than truncating — a catalogue quietly missing its last hundred
 * products makes a search screen confidently say "we don't have that".
 *
 * **No names, ever.** `ProductDetail` carries `activeBorrows`, which says who is holding what.
 * A product browser in another company system has no business with that: `inUse` is a number.
 */

/** One shelf, ready to print. */
export const catalogueLocationSchema = z.object({
  compartmentId: z.string().uuid(),
  /** "Main Store / Meta / 1A" — the same formatting the IMS itself shows. */
  label: z.string(),
  room: z.string(),
  zone: z.string(),
  compartment: z.string(),
  /** The printed shelf label, e.g. `MAI-MET-1A-0002`. What somebody reads off the shelf edge. */
  storageId: z.string(),
});
export type CatalogueLocation = z.infer<typeof catalogueLocationSchema>;

/** A shelf plus what is on it, for one product. */
export const catalogueStockAtSchema = catalogueLocationSchema.extend({
  quantity: z.number().int(),
  available: z.number().int(),
});
export type CatalogueStockAt = z.infer<typeof catalogueStockAtSchema>;

export const catalogueCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /**
   * Root first, this category last: `["Electronics", "Computers", "Laptops"]`. A breadcrumb
   * without a tree walk — join it for a label, or render the segments.
   */
  path: z.array(z.string()),
  /** Products in this category and everything beneath it. */
  productCount: z.number().int(),
});
export type CatalogueCategory = z.infer<typeof catalogueCategorySchema>;

export const catalogueProductSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  unit: z.string(),
  /** Null when the product has not been categorised — a supported state, not a defect. */
  category: catalogueCategorySchema.nullable(),
  stock: z.object({
    /** Everything the company holds: on a shelf here plus out with somebody. */
    total: z.number().int(),
    /** Free to take right now. Excludes reserved and quarantined units. */
    available: z.number().int(),
    /** Out on loan. A count, never a list of people. */
    inUse: z.number().int(),
  }),
  /** Empty for a product that exists in the catalogue but has never been received. */
  locations: z.array(catalogueStockAtSchema),
});
export type CatalogueProduct = z.infer<typeof catalogueProductSchema>;

export interface Catalogue {
  /** When this snapshot was read. Nothing is cached; every call is live. */
  generatedAt: string;
  products: CatalogueProduct[];
  /**
   * Flat, for a filter list. Only categories that actually hold something — including their
   * ancestors, so a tree can still be rebuilt from the paths. An empty category is a dead end
   * on a search screen, and 113 of them was the bulk of the first version's payload.
   */
  categories: CatalogueCategory[];
  /** Every shelf, flat, for a location filter. */
  locations: CatalogueLocation[];
  counts: {
    products: number;
    categories: number;
    locations: number;
  };
}

export const catalogueQuerySchema = z.object({
  /** Retired products and deactivated shelves. Off by default — a browser wants what exists. */
  includeInactive: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((value) => value === true || value === 'true')
    .default(false),
  /**
   * Every category, including the ones holding nothing. Off by default. Worth turning on only
   * if the consumer is building a management view rather than a search filter.
   */
  allCategories: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((value) => value === true || value === 'true')
    .default(false),
});
export type CatalogueQuery = z.infer<typeof catalogueQuerySchema>;
