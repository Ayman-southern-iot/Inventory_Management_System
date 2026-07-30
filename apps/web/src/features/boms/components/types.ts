import type { BomCandidate } from '@ims/shared';

/**
 * The shape of one row in the BOM generate form. `requisitionItemId` and the source
 * `requisitionNo` ride along on the row so the submit step can rebuild the
 * `{ requisitionIds, lines }` shape that the API expects.
 *
 * The `unitCost` and `vendor` are the only fields the IM edits; the rest comes from
 * the source requisition and never changes between picker and submit.
 */
export interface BomGenerateLine {
  /** The requisition this row belongs to. Drives grouping on screen and the
   *  `requisitionIds` payload on submit. */
  requisitionId: string;
  /** The display ref, e.g. `REQ-000042`. The detail page re-uses this for breadcrumbs. */
  requisitionNo: string;
  requisitionItemId: string;
  itemName: string;
  quantity: number;
  estimatedUnitPrice: number | null;
  unitCost: number | null;
  vendor: string | null;
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
    quantity: item.quantity,
    estimatedUnitPrice: item.estimatedUnitPrice,
    // The IM only fills two things; pre-fill unit cost from the requester's estimate
    // so a quick accept gives them a BOM within tolerance. Vendor is always blank.
    unitCost: item.estimatedUnitPrice,
    vendor: null,
  };
}

/** All the rows that come from a single candidate requisition. */
export function linesFromCandidate(candidate: BomCandidate): BomGenerateLine[] {
  return candidate.items.map((item) => lineFromCandidateItem(candidate, item));
}