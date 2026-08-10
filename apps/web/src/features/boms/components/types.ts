import type { BomCandidate } from '@ims/shared';

/**
 * The shape of one row in the BOM generate form. `requisitionItemId` and the source
 * `requisitionNo` ride along on the row so the submit step can rebuild the
 * `{ requisitionIds, lines }` shape that the API expects.
 *
 * The IM can edit `unitCost`, `vendor`, the BOM-local `quantity` (a shrink — never above
 * the source `quantity`) and toggle `removed` to drop the line entirely from the BOM.
 * Source `requisition_items.quantity` is never modified.
 */
export interface BomGenerateLine {
  /** The requisition this row belongs to. Drives grouping on screen and the
   *  `requisitionIds` payload on submit. */
  requisitionId: string;
  /** The display ref, e.g. `REQ-000042`. The detail page re-uses this for breadcrumbs. */
  requisitionNo: string;
  requisitionItemId: string;
  itemName: string;
  /**
   * Source quantity, locked to the requester's value on row build. The IM override lives
   * on `quantity` below; this field is what the input's max attr clamps to.
   */
  sourceQuantity: number;
  /** The IM-controlled BOM quantity. Starts at `sourceQuantity`. Wire field. */
  quantity: number;
  estimatedUnitPrice: number | null;
  unitCost: number | null;
  vendor: string | null;
  /**
   * Marked true to drop the line from the generated BOM. The submit step filters these out
   * before the payload goes over the wire. Wire field.
   */
  removed: boolean;
}

/** Build one editable row from a candidate requisition's first item. */
export function lineFromCandidateItem(
  candidate: BomCandidate,
  item: BomCandidate['items'][number],
): BomGenerateLine {
  return {
    requisitionId: candidate.requisitionId,
    requisitionNo: candidate.requisitionNo,
    requisitionItemId: item.requisitionItemId,
    itemName: item.itemName,
    sourceQuantity: item.quantity,
    quantity: item.quantity,
    estimatedUnitPrice: item.estimatedUnitPrice,
    // The IM only fills two things; pre-fill unit cost from the requester's estimate
    // so a quick accept gives them a BOM within tolerance. Vendor is always blank.
    unitCost: item.estimatedUnitPrice,
    vendor: null,
    removed: false,
  };
}

/** All the rows that come from a single candidate requisition. */
export function linesFromCandidate(candidate: BomCandidate): BomGenerateLine[] {
  return candidate.items.map((item) => lineFromCandidateItem(candidate, item));
}