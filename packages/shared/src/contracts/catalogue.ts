import { z } from 'zod';
import type { CategoryNode, Room } from './inventory.js';

/**
 * The whole catalogue in one response.
 *
 * Ayman, 2026-09-21: another system reads this one live. It stores nothing — it is a frontend
 * that loads products, categories and locations on open, lets people search, and shows what is
 * in stock. Three paginated calls is the wrong shape for that job; one call it can re-issue
 * whenever it likes is the right one.
 *
 * Deliberately **not** paginated, which is a considered exception to `rules/40-database.md`
 * ("every list endpoint is paginated"). That rule exists so an unbounded scan cannot be
 * triggered by a caller; here the whole point is completeness, so the bound is a hard ceiling on
 * the response instead — `CATALOGUE_MAX_PRODUCTS`. Past it the endpoint refuses loudly rather
 * than truncating, because a catalogue that is quietly missing its last hundred products is
 * worse than one that says it cannot be served.
 *
 * **What it does not contain, on purpose:** who is holding anything. `ProductDetail` carries
 * `activeBorrows`, which names employees; a product browser in another system has no business
 * with that. The totals below say how many are out, never to whom.
 */

/** One shelf a product sits on. Flattened, because the consumer renders a location as text. */
export const cataloguePlacementSchema = z.object({
  compartmentId: z.string().uuid(),
  compartmentCode: z.string(),
  /** The printed shelf label, e.g. `MAI-MET-1A-0001`. */
  storageId: z.string(),
  zoneId: z.string().uuid(),
  zoneName: z.string(),
  roomId: z.string().uuid(),
  roomName: z.string(),
  quantity: z.number().int(),
  availableQty: z.number().int(),
});
export type CataloguePlacement = z.infer<typeof cataloguePlacementSchema>;

export const catalogueProductSchema = z.object({
  id: z.string().uuid(),
  productCode: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  unit: z.string(),
  /** Null for an uncategorised product — a supported state, not a defect. */
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  isActive: z.boolean(),
  /** Physically held, in any state. */
  totalQuantity: z.number().int(),
  /** Free to take right now: total minus reserved minus quarantined. */
  totalAvailable: z.number().int(),
  /** On a shelf here, as opposed to out with somebody. */
  totalOnHand: z.number().int(),
  /** Out on loan. A count, never a list of names. */
  totalInUse: z.number().int(),
  /** Every shelf this product sits on. Empty for a product that has never been received. */
  placements: z.array(cataloguePlacementSchema),
});
export type CatalogueProduct = z.infer<typeof catalogueProductSchema>;

/**
 * An interface rather than a zod schema, for the same reason `ProductDetail` is one: the
 * category tree is recursive, and zod's recursive types cost more in ceremony than they return
 * on a response nobody parses back. Requests are validated; responses are typed.
 */
export interface Catalogue {
  /**
   * When this snapshot was taken. A consumer that caches can show "as of", and two consumers
   * comparing notes can tell which one is stale.
   */
  generatedAt: string;
  products: CatalogueProduct[];
  /** Nested, root categories first. Each node carries its children. */
  categories: CategoryNode[];
  /** Nested Room → Zone → Compartment, so a consumer can render the storage tree. */
  rooms: Room[];
  counts: {
    products: number;
    categories: number;
    rooms: number;
  };
}

export const catalogueQuerySchema = z.object({
  /** Retired products and deactivated shelves. Off by default — a browser wants what exists. */
  includeInactive: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((value) => value === true || value === 'true')
    .default(false),
});
export type CatalogueQuery = z.infer<typeof catalogueQuerySchema>;
