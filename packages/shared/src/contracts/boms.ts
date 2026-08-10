import { z } from 'zod';
import { paginationQuerySchema, queryBoolean } from './common.js';

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
  /**
   * Whether this approver applied their signature (task 5.2). The document prints their name and
   * "Approved" either way; this decides whether the signature line carries an image or stays
   * blank for a wet signature.
   */
  signedWithSignature: z.boolean(),
  /**
   * The signature snapshotted at approval. Deliberately an id and not the image: the PDF renderer
   * resolves it to bytes server-side, so a signature image never travels to the browser as part
   * of an ordinary BOM detail response.
   */
  signatureFileId: z.string().uuid().nullable(),
});
export type ApprovalFootprint = z.infer<typeof approvalFootprintSchema>;

export const requisitionFootprintsSchema = z.object({
  requisitionId: z.string().uuid(),
  requisitionNo: z.string(),
  requesterName: z.string(),
  departmentName: z.string().nullable(),
  /** The project the spend belongs to, printed in the BOM header. */
  projectName: z.string().nullable(),
  /** The requester's own words from the submit form — `requisitions.reason`. */
  description: z.string().nullable(),
  requestedAmount: z.number().nullable(),
  approvedAmount: z.number().nullable(),
  /**
   * What the approvers did not sanction: `requestedAmount − approvedAmount` (OQ-18, answered by
   * the operator — requested 15,000 approved 10,000 leaves 5,000). A property of the approval
   * decision alone, so it is fixed once the chain completes and never moves with spending.
   */
  remainingAmount: z.number().nullable(),
  /**
   * Rolled-up transportation cost the requester added. Null when the requisition did not
   * include one. Already baked into `requestedAmount`; the PDF prints the line separately
   * so Accounts can see what was transportation and what was goods.
   */
  transportationCost: z.number().nullable(),
  transportationDescription: z.string().nullable(),
  footprints: z.array(approvalFootprintSchema),
});
export type RequisitionFootprints = z.infer<typeof requisitionFootprintsSchema>;

/* ---------------------------------------------------------------- generation */

/**
 * One row of a BOM line. The IM may shrink the line down (or drop it entirely) when the
 * `approvedAmount` they got from Approvers came in below `requestedAmount` — a common case
 * for multi-item requisitions where the IM simply couldn't afford everything. The
 * `quantity` override is **local to the BOM line**: the source `requisition_items.quantity`
 * is left alone. For single-item over-budget cases the IM sends the requisition back for
 * revision instead (see `POST /requisitions/:id/send-back-for-revision`).
 *
 * `removed: true` drops the line entirely — it is preserved on the wire (so the form
 * remembers the IM's choice on re-open) but excluded from the generated BOM. The
 * submit-time filter in `BomGeneratePage.tsx` keeps these out of the request body for
 * clients that don't need them; the API also tolerates a mix where the same line is
 * declared both removed and visible (it honours the `removed` flag).
 */
export const bomLineInputSchema = z.object({
  requisitionItemId: z.string().uuid(),
  /** The two figures the IM supplies; everything else is inherited from the requisition. */
  unitCost: z.number().nonnegative().max(1_000_000_000),
  vendor: z.string().trim().max(200).nullable().default(null),
  /**
   * Optional override. Omit (or send `undefined`) to keep the source requisition's
   * quantity — this is the historical behaviour. When sent, must be `>= 1` and
   * `<= source.quantity`. A BOM that drops every line below 1 is rejected — the IM
   * has to either keep at least one line or use send-back-for-revision on the requisition.
   */
  quantity: z.number().int().min(1).max(1_000_000).optional(),
  /**
   * Drop this line entirely from the BOM. A 0-quantity line is *also* dropped by the
   * service, so the flag exists for client-side clarity (the user "removed" the line)
   * rather than as a separate wire path. Default false.
   */
  removed: z.boolean().optional().default(false),
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

/** Mirror of the `BomDetail` interface as a Zod schema — the body validators in 4.3 reuse it. */
export const bomDetailSchema = bomSchema.extend({
  lines: z.array(bomLineSchema),
  sources: z.array(requisitionFootprintsSchema),
});

export const listBomsQuerySchema = paginationQuerySchema.extend({
  includeVoid: queryBoolean(false),
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
  includeEmpty: queryBoolean(false),
});
export type InventoryExportQuery = z.infer<typeof inventoryExportQuerySchema>;

/* ----------------------------------------------------- PDF template + download */

/**
 * `POST /boms/:id/render` returns the BOM detail so the IM screen can refresh its `hasPdf`
 * flag in one round-trip.
 */
export const bomPdfRenderResponseSchema = z.object({
  bom: bomDetailSchema,
});
export type BomPdfRenderResponse = z.infer<typeof bomPdfRenderResponseSchema>;

/**
 * The signed download URL the web app uses to fetch the cached PDF. The URL is bound to
 * the BOM and to a TTL; a leaked URL becomes useless once the TTL passes.
 */
export const bomSignedUrlResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
  ttlSeconds: z.number().int().positive(),
});
export type BomSignedUrlResponse = z.infer<typeof bomSignedUrlResponseSchema>;

/**
 * The query string for `GET /boms/:id/pdf` — the download endpoint is `@Public()` and the
 * token is the entire authentication.
 */
export const bomDownloadQuerySchema = z.object({
  token: z.string().min(1),
});
export type BomDownloadQuery = z.infer<typeof bomDownloadQuerySchema>;
