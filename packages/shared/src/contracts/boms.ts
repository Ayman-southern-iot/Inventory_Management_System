import { z } from 'zod';
import { paginationQuerySchema } from './common.js';

/* ------------------------------------------------------------------ snapshot */

/**
 * One approver, frozen as they were when the BOM was generated.
 *
 * Never rendered by joining live to `users`: a BOM printed in July must still show July's
 * names and job titles even after someone is promoted or leaves
 * (docs/reference/09-bom.md).
 */
export const approvalFootprintSchema = z.object({
  stage: z.string(),
  slot: z.number().int().nullable(),
  name: z.string(),
  designation: z.string(),
  actedAt: z.string().nullable(),
  /** Set when a delegate acted for the assignee, so the signature block can say so. */
  onBehalfOf: z.string().nullable(),
});
export type ApprovalFootprint = z.infer<typeof approvalFootprintSchema>;

export const requisitionFootprintsSchema = z.object({
  requisitionId: z.string().uuid(),
  requisitionNo: z.string(),
  requesterName: z.string(),
  departmentName: z.string().nullable(),
  approvedAmount: z.number().nullable(),
  footprints: z.array(approvalFootprintSchema),
});
export type RequisitionFootprints = z.infer<typeof requisitionFootprintsSchema>;

/* ---------------------------------------------------------------- generation */

export const bomLineInputSchema = z.object({
  requisitionItemId: z.string().uuid(),
  /** The two figures the IM supplies; everything else is inherited from the requisition. */
  unitCost: z.number().nonnegative().max(1_000_000_000),
  vendor: z.string().trim().max(200).nullable().default(null),
});
export type BomLineInput = z.infer<typeof bomLineInputSchema>;

export const generateBomSchema = z.object({
  /** One or more — the IM may batch several approved requisitions onto one document. */
  requisitionIds: z.array(z.string().uuid()).min(1).max(20),
  lines: z.array(bomLineInputSchema).min(1).max(500),
});
export type GenerateBomInput = z.infer<typeof generateBomSchema>;

export const voidBomSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type VoidBomInput = z.infer<typeof voidBomSchema>;

/* ------------------------------------------------------------------- reading */

export const bomLineSchema = z.object({
  id: z.string().uuid(),
  requisitionItemId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  itemName: z.string(),
  quantity: z.number().int(),
  unitCost: z.number(),
  totalCost: z.number(),
  vendor: z.string().nullable(),
  purpose: z.string().nullable(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  /** Which source requisition this line came from — a batched BOM must stay traceable. */
  requisitionNo: z.string(),
});
export type BomLine = z.infer<typeof bomLineSchema>;

export const bomSchema = z.object({
  id: z.string().uuid(),
  bomNo: z.string(),
  generatedByName: z.string(),
  subtotal: z.number(),
  isVoid: z.boolean(),
  voidReason: z.string().nullable(),
  voidedByName: z.string().nullable(),
  voidedAt: z.string().nullable(),
  /** True when the total exceeded tolerance and the sources went back for re-approval. */
  overBudgetBounced: z.boolean(),
  hasPdf: z.boolean(),
  generatedAt: z.string(),
  requisitionNos: z.array(z.string()),
});
export type Bom = z.infer<typeof bomSchema>;

export interface BomDetail extends Bom {
  lines: BomLine[];
  sources: RequisitionFootprints[];
}

export const listBomsQuerySchema = paginationQuerySchema.extend({
  includeVoid: z.coerce.boolean().default(false),
  search: z.string().trim().max(160).optional(),
});
export type ListBomsQuery = z.infer<typeof listBomsQuerySchema>;

/**
 * What the generate screen needs: every APPROVED requisition not already on a live BOM,
 * with its lines pre-filled from the requisition.
 */
export const bomCandidateSchema = z.object({
  requisitionId: z.string().uuid(),
  requisitionNo: z.string(),
  requesterName: z.string(),
  departmentName: z.string().nullable(),
  projectName: z.string().nullable(),
  approvedAmount: z.number().nullable(),
  items: z.array(
    z.object({
      requisitionItemId: z.string().uuid(),
      productId: z.string().uuid().nullable(),
      itemName: z.string(),
      quantity: z.number().int(),
      /** The requester's estimate — a starting point for the IM's real unit cost. */
      estimatedUnitPrice: z.number(),
      purpose: z.string().nullable(),
    }),
  ),
});
export type BomCandidate = z.infer<typeof bomCandidateSchema>;

/* ----------------------------------------------------------- inventory export */

export const InventoryExportOrientation = {
  PORTRAIT: 'PORTRAIT',
  LANDSCAPE: 'LANDSCAPE',
} as const;
export type InventoryExportOrientation =
  (typeof InventoryExportOrientation)[keyof typeof InventoryExportOrientation];

/** Task 4.6 — same pipeline, different template. Generated on demand, never stored. */
export const inventoryExportQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  includeEmpty: z.coerce.boolean().default(false),
});
export type InventoryExportQuery = z.infer<typeof inventoryExportQuerySchema>;
