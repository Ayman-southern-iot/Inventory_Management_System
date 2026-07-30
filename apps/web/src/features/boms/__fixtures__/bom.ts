import {
  type ApprovalFootprint,
  type BomDetail,
  type BomLine,
  type RequisitionFootprints,
} from '@ims/shared';

/**
 * A typed factory for `BomDetail` and friends.
 *
 * Mirrors `requisition(overrides)` in `ApprovalTracker.test.tsx` — every
 * field has a sensible default so a test only has to spell out the bits it
 * cares about. The numbers are deliberately round (no rounding errors in
 * arithmetic assertions) and the timestamps are deterministic.
 */
export function bomLine(overrides: Partial<BomLine> = {}): BomLine {
  return {
    id: crypto.randomUUID(),
    requisitionItemId: crypto.randomUUID(),
    productId: null,
    itemName: 'Test Item',
    quantity: 2,
    unitCost: 1500,
    totalCost: 3000,
    vendor: 'Test Vendor',
    purpose: 'For testing',
    projectId: null,
    projectName: null,
    requisitionNo: 'REQ-000001',
    ...overrides,
  };
}

export function footprint(
  overrides: Partial<ApprovalFootprint> = {},
): ApprovalFootprint {
  return {
    stage: 'APPROVER',
    slot: 1,
    name: 'Ayesha Approver',
    designation: 'Head of Operations',
    actedAt: '2026-07-29T10:00:00.000Z',
    onBehalfOf: null,
    signedWithSignature: false,
    signatureFileId: null,
    ...overrides,
  };
}

export function sourceFootprints(
  overrides: Partial<RequisitionFootprints> = {},
): RequisitionFootprints {
  return {
    requisitionId: crypto.randomUUID(),
    requisitionNo: 'REQ-000001',
    requesterName: 'Gina General',
    departmentName: 'Engineering',
    projectName: 'Sensor rollout',
    description: 'Replacement sensors for the pilot site',
    requestedAmount: 4000,
    approvedAmount: 3000,
    // OQ-18: requested minus approved.
    remainingAmount: 1000,
    footprints: [footprint()],
    ...overrides,
  };
}

export function bomDetail(overrides: Partial<BomDetail> = {}): BomDetail {
  const source = sourceFootprints();
  return {
    id: crypto.randomUUID(),
    bomNo: 'BOM-000001',
    generatedByName: 'Inara IM',
    subtotal: 3000,
    isVoid: false,
    voidReason: null,
    voidedByName: null,
    voidedAt: null,
    overBudgetBounced: false,
    hasPdf: false,
    generatedAt: '2026-07-29T12:00:00.000Z',
    requisitionNos: ['REQ-000001'],
    lines: [bomLine({ requisitionNo: source.requisitionNo })],
    sources: [source],
    ...overrides,
  };
}