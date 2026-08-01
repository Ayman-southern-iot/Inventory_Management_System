import { z } from 'zod';
import { paginationQuerySchema, queryBoolean } from './common.js';

/* ------------------------------------------------------------------ shared bits */

export const nameSchema = z.string().trim().min(1).max(160);
export const positiveQuantitySchema = z.number().int().positive().max(1_000_000);

/** Units are free text so the IM is never blocked by a missing option. */
export const UNIT_SUGGESTIONS = ['pcs', 'box', 'm', 'kg', 'set', 'pair', 'roll'] as const;

/* -------------------------------------------------------------------- categories */

export const createCategorySchema = z.object({
  name: nameSchema,
  parentId: z.string().uuid().nullable().default(null),
  /** requirements §11 — untracked categories hold catalogue entries but no stock. */
  isTrackable: z.boolean().default(true),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: nameSchema.optional(),
  isTrackable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const categorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  isTrackable: z.boolean(),
  isActive: z.boolean(),
  productCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Category = z.infer<typeof categorySchema>;

/** A category plus its descendants, for the tree view. */
export interface CategoryNode extends Category {
  children: CategoryNode[];
}

/* ---------------------------------------------------------------------- products */

export const productCodeSchema = z.string().trim().min(1).max(64);

export const createProductSchema = z.object({
  productCode: productCodeSchema,
  name: nameSchema,
  categoryId: z.string().uuid(),
  unit: z.string().trim().min(1).max(24).default('pcs'),
  /** OQ-08 — the borrow form's default, overridable per borrow line. */
  defaultReturnable: z.boolean().default(true),
  description: z.string().trim().max(2000).nullable().default(null),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  productCode: productCodeSchema.optional(),
  name: nameSchema.optional(),
  categoryId: z.string().uuid().optional(),
  unit: z.string().trim().min(1).max(24).optional(),
  defaultReturnable: z.boolean().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(160).optional(),
  categoryId: z.string().uuid().optional(),
  includeInactive: queryBoolean(false),
  /** Only products that currently have stock somewhere. */
  inStockOnly: queryBoolean(false),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

/** One product's stock in one compartment, as rendered on the product card. */
export const placementSchema = z.object({
  id: z.string().uuid(),
  compartmentId: z.string().uuid(),
  compartmentCode: z.string(),
  zoneId: z.string().uuid(),
  zoneName: z.string(),
  quantity: z.number().int(),
  reservedQty: z.number().int(),
  /**
   * Units on this shelf but held back because they came back damaged or not working. Physically
   * present (counted in `quantity`), excluded from `available`, see migration 0019.
   */
  quarantinedQty: z.number().int(),
  availableQty: z.number().int(),
  /** Sent back on a move so a stale screen is rejected rather than silently applied. */
  version: z.number().int(),
});
export type Placement = z.infer<typeof placementSchema>;

export const productSchema = z.object({
  id: z.string().uuid(),
  productCode: z.string(),
  name: z.string(),
  categoryId: z.string().uuid(),
  categoryName: z.string(),
  isTrackable: z.boolean(),
  unit: z.string(),
  defaultReturnable: z.boolean(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  /**
   * Aggregate across every shelf the product is on. Kept for the list view; the product card
   * explains each one. `totalOwned = onHand + inUse` is what an IM reads as "stock this
   * company currently holds, in any state".
   */
  totalQuantity: z.number().int(),
  totalReserved: z.number().int(),
  totalAvailable: z.number().int(),
  totalOnHand: z.number().int(),
  totalQuarantined: z.number().int(),
  totalInUse: z.number().int(),
  totalOwned: z.number().int(),
  createdAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;

/**
 * One row in the "Currently in use" section of a product detail page. The IM, the requester
 * and the requester's project are all shown — the point is to answer "who has it and why" by
 * searching the product, which is how people find things here.
 *
 * Returned quantity is shown when it differs from the borrowed quantity so partial returns are
 * obvious at a glance. Fully-returned borrows are filtered out — there is no value in
 * remembering who used it last.
 */
export const activeProductBorrowSchema = z.object({
  borrowId: z.string().uuid(),
  borrowNo: z.string(),
  borrowerId: z.string().uuid(),
  borrowerName: z.string(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  quantity: z.number().int(),
  returnedQty: z.number().int(),
  outstandingQty: z.number().int(),
  expectedReturnDate: z.string().nullable(),
  issuedAt: z.string().nullable(),
  isOverdue: z.boolean(),
  /** The IM sees the most recent return condition on partially-returned borrows. */
  lastReturnCondition: z
    .enum(['GOOD', 'PARTIALLY_DAMAGED_USABLE', 'DAMAGED', 'NOT_WORKING'])
    .nullable(),
});
export type ActiveProductBorrow = z.infer<typeof activeProductBorrowSchema>;

export interface ProductDetail extends Product {
  placements: Placement[];
  /** Active borrows (ISSUED or PARTIALLY_RETURNED) ordered by issue date desc. */
  activeBorrows: ActiveProductBorrow[];
}

/* --------------------------------------------------------------------- locations */

export const createZoneSchema = z.object({ name: nameSchema });
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

export const updateZoneSchema = z.object({
  name: nameSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

export const compartmentCodeSchema = z.string().trim().min(1).max(32);

export const createCompartmentSchema = z.object({
  zoneId: z.string().uuid(),
  code: compartmentCodeSchema,
});
export type CreateCompartmentInput = z.infer<typeof createCompartmentSchema>;

export const updateCompartmentSchema = z.object({
  code: compartmentCodeSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCompartmentInput = z.infer<typeof updateCompartmentSchema>;

export const compartmentSchema = z.object({
  id: z.string().uuid(),
  zoneId: z.string().uuid(),
  zoneName: z.string(),
  code: z.string(),
  isActive: z.boolean(),
  /** Distinct products held here — a compartment with stock cannot be deactivated. */
  placementCount: z.number().int().nonnegative(),
});
export type Compartment = z.infer<typeof compartmentSchema>;

export const zoneSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  compartments: z.array(compartmentSchema),
});
export type Zone = z.infer<typeof zoneSchema>;

/* ------------------------------------------------------------------- stock moves */

export const receiveStockSchema = z.object({
  productId: z.string().uuid(),
  compartmentId: z.string().uuid(),
  quantity: positiveQuantitySchema,
  note: z.string().trim().max(500).optional(),
});
export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;

export const moveStockSchema = z.object({
  productId: z.string().uuid(),
  fromCompartmentId: z.string().uuid(),
  toCompartmentId: z.string().uuid(),
  quantity: positiveQuantitySchema,
  /** Optimistic lock (§7.3.2). Omit only from a server-side caller with a fresh read. */
  expectedVersion: z.number().int().nonnegative().optional(),
  note: z.string().trim().max(500).optional(),
});
export type MoveStockInput = z.infer<typeof moveStockSchema>;

export const adjustStockSchema = z.object({
  productId: z.string().uuid(),
  compartmentId: z.string().uuid(),
  /** Signed. Zero is rejected — it would write a ledger row that says nothing happened. */
  delta: z.number().int().refine((v) => v !== 0, { message: 'Adjustment cannot be zero' }),
  /** Required: an unexplained adjustment is indistinguishable from theft six months later. */
  reason: z.string().trim().min(3).max(500),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

/**
 * Settle quarantined quantity for a (product, compartment) placement.
 *
 *   RELEASE — the units were repaired or verified usable. `quarantined_qty` decreases only;
 *             quantity and the ledger are untouched. The units simply become available again.
 *   DISPOSE — the units are written off. `quarantined_qty` decreases AND `quantity` decreases,
 *             and a DISPOSE row is appended to the ledger in the same transaction.
 *
 * Either action requires a note — "what did you do with the damaged goods" is exactly the
 * thing a future reader needs to know.
 */
export const QuarantineAction = {
  RELEASE: 'RELEASE',
  DISPOSE: 'DISPOSE',
} as const;
export type QuarantineAction = (typeof QuarantineAction)[keyof typeof QuarantineAction];

export const resolveQuarantineSchema = z.object({
  productId: z.string().uuid(),
  compartmentId: z.string().uuid(),
  action: z.enum(Object.values(QuarantineAction) as [QuarantineAction, ...QuarantineAction[]]),
  quantity: positiveQuantitySchema,
  note: z.string().trim().min(3).max(500),
});
export type ResolveQuarantineInput = z.infer<typeof resolveQuarantineSchema>;

export const StockMovementType = {
  RECEIPT: 'RECEIPT',
  MOVE: 'MOVE',
  ISSUE: 'ISSUE',
  RETURN: 'RETURN',
  ADJUST: 'ADJUST',
  DISPOSE: 'DISPOSE',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export const stockMovementTypeSchema = z.enum(
  Object.values(StockMovementType) as [StockMovementType, ...StockMovementType[]],
);

export const listLedgerQuerySchema = paginationQuerySchema.extend({
  productId: z.string().uuid().optional(),
  movementType: stockMovementTypeSchema.optional(),
});
export type ListLedgerQuery = z.infer<typeof listLedgerQuerySchema>;

export const ledgerEntrySchema = z.object({
  id: z.string(),
  productId: z.string().uuid(),
  productName: z.string(),
  fromCompartment: z.string().nullable(),
  toCompartment: z.string().nullable(),
  quantity: z.number().int(),
  movementType: stockMovementTypeSchema,
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  performedByName: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
