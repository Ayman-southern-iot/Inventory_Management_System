/**
 * Dev-only scenario seed. Walks every realistic requisition lifecycle flow against the live
 * API and leaves a self-describing set of requisitions in the dev database so a developer can
 * open the UI and see what each branch of the lifecycle looks like.
 *
 *   pnpm db:seed:scenarios
 *
 * The reference-data seed (`pnpm db:seed`) is production-safe. This script is dev-only and
 * exits immediately in production: requisitions and their financial trail are persona-specific
 * and never belong on a live system.
 *
 * Idempotent: re-running clears the previous scenario set and rebuilds it. Reference data is
 * reused from `seed.ts` (users, departments, slots, products).
 *
 * Negative cases are exercised but rolled back — the dev DB never accumulates rows from a
 * failed assertion. The dev index table at the end of the run is the artifact a developer
 * looks at first.
 *
 * Wrapped in a single `it()` so vitest will run it. The test always passes — its job is to
 * populate the dev database, not to assert anything; the suite of negative checks is logged to
 * the console and the index is the artifact a developer inspects.
 */
import { sql } from 'kysely';
import { describe, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import {
  ApprovalStage,
  BorrowStatus,
  RequisitionEventType,
  RequisitionStatus,
  Role,
  type RequisitionDetail,
  type RequisitionFunding,
} from '@ims/shared';
import { config } from '../../src/config';
import { createDatabase, type Db } from '../../src/database/create-db';
import { createTestApp, httpClient, type HttpClient, type TestApp } from '../app';
import {
  createUserAndLogin,
  login,
  seedSubthresholdApprover,
  type Client,
} from './scenario-seed-helpers';

const DEV_PASSWORD = 'DevPassword123';

interface Actor extends Client {
  fullName: string;
  roles: Role[];
}

interface ScenarioResult {
  requisitionNo: string;
  scenario: string;
  status: string;
  spent: number;
  returned: number;
  funded: number;
}

const results: ScenarioResult[] = [];

/* ============================================================================
 * main
 * ========================================================================== */

describe('seed-scenarios', () => {
  it('populates the dev database with one example of every requisition flow', async () => {
    await main();
  }, 120_000);
});

async function main(): Promise<void> {
  if (config.isProduction) {
    console.log('seed-scenarios: refusing to run in production.');
    return;
  }

  const { db } = createDatabase(config);
  await assertReferenceDataSeeded(db);

  const ctx = await createTestApp();

  try {
    const actors = await loadActors(ctx);
    await clearPreviousScenarios(ctx.db);

    await runNegativeChecks(actors, ctx);
    await scenarioHappyPath(actors, ctx);
    await scenarioAtThresholdTwoApprovers(actors, ctx);
    await scenarioAmountRevisedWithReturn(actors);
    await scenarioLateRejection(actors);
    await scenarioCancelledInImReview(actors);
    await scenarioFreeTextBecomesProduct(actors, ctx);
    await scenarioMultiVendor(actors);
    await scenarioBorrowFromVerified(actors, ctx);
    await insertOverdueBorrow(ctx.db, actors);
    await insertActiveDelegation(actors);
    await printScenarioIndex(ctx.db);
  } finally {
    await ctx.close();
    await db.destroy();
  }
}

/* ============================================================================
 * bootstrap
 * ========================================================================== */

async function assertReferenceDataSeeded(db: Db): Promise<void> {
  const settingsRow = await db
    .selectFrom('app_settings')
    .select('key')
    .limit(1)
    .executeTakeFirst();
  if (!settingsRow) {
    throw new Error(
      'Reference data is missing. Run `pnpm --filter @ims/api db:seed` before `db:seed:scenarios`.',
    );
  }

  const devUser = await db
    .selectFrom('users')
    .select('id')
    .where('email', '=', 'general@ims.local')
    .executeTakeFirst();
  if (!devUser) {
    throw new Error(
      'Dev personas are missing. Run `pnpm --filter @ims/api db:seed` before `db:seed:scenarios`.',
    );
  }
}

async function loadActors(ctx: TestApp): Promise<{
  requester: Actor;
  im: Actor;
  approver1: Actor;
  approver2: Actor;
  delegate: Actor;
  borrower: Actor;
}> {
  const requester = await loginActor(ctx.app, 'general@ims.local', 'Gina Requester', [Role.GENERAL]);
  const im = await loginActor(ctx.app, 'im@ims.local', 'Inara IM', [
    Role.GENERAL,
    Role.INVENTORY_MANAGER,
  ]);
  const approver1 = await loginActor(ctx.app, 'approver1@ims.local', 'Ayesha Approver', [
    Role.GENERAL,
    Role.APPROVER,
  ]);
  const approver2 = await loginActor(ctx.app, 'approver2@ims.local', 'Farhan Approver', [
    Role.GENERAL,
    Role.APPROVER,
  ]);

  // The global approver slots that determine who can decide slot 1 / slot 2 on a requisition
  // are seed.ts's first two APPROVER-role users alphabetically. On a long-lived dev DB that
  // surfaces as random real-employee users, not the dev personas. Repoint the slots so the
  // scenarios' login tokens match the slot assignments.
  await ctx.db
    .updateTable('approver_slots')
    .set({ user_id: approver1.id })
    .where('department_id', 'is', null)
    .where('slot_no', '=', 1)
    .execute();
  await ctx.db
    .updateTable('approver_slots')
    .set({ user_id: approver2.id })
    .where('department_id', 'is', null)
    .where('slot_no', '=', 2)
    .execute();

  // Fresh delegate — REQ-02's second approval records `acted_by_user_id != assigned_user_id`.
  // Each gets a fresh IP, same as the named personas above.
  const delegateHttp = httpClient(ctx.app);
  const delegateSession = await createUserAndLogin(ctx.db, delegateHttp, {
    roles: [Role.GENERAL, Role.APPROVER],
    fullName: 'Dana Delegate',
  });
  const delegate: Actor = {
    id: delegateSession.user.id,
    email: delegateSession.user.email,
    client: delegateSession.client,
    fullName: 'Dana Delegate',
    roles: [Role.GENERAL, Role.APPROVER],
  };

  // Fresh borrower for REQ-08's borrow-out.
  const borrowerHttp = httpClient(ctx.app);
  const borrowerSession = await createUserAndLogin(ctx.db, borrowerHttp, {
    roles: [Role.GENERAL],
    fullName: 'Ben Borrower',
  });
  const borrower: Actor = {
    id: borrowerSession.user.id,
    email: borrowerSession.user.email,
    client: borrowerSession.client,
    fullName: 'Ben Borrower',
    roles: [Role.GENERAL],
  };

  await seedSubthresholdApprover(ctx, approver1.id);

  // Insert the active delegations NOW — REQ-02's slot 2 approver (the delegate) needs the
  // delegation to be in place before the scenario runs. insertActiveDelegation is idempotent
  // and runs again at the end of the seed purely so the dev's got a fresh pair to look at.
  await insertActiveDelegationInActors(ctx, approver1, approver2, delegate);

  return { requester, im, approver1, approver2, delegate, borrower };
}

async function insertActiveDelegationInActors(
  ctx: TestApp,
  approver1: Actor,
  approver2: Actor,
  delegate: Actor,
): Promise<void> {
  const now = new Date();
  const endsAt = new Date(now.getTime() + 7 * 24 * 3_600_000);
  const startsAt = new Date(now.getTime() - 3_600_000);
  for (const approverId of [approver1.id, approver2.id]) {
    const existing = await ctx.db
      .selectFrom('delegations')
      .select('id')
      .where('approver_user_id', '=', approverId)
      .where('delegate_user_id', '=', delegate.id)
      .where('is_active', '=', true)
      .where('starts_at', '<=', now)
      .where('ends_at', '>', now)
      .executeTakeFirst();
    if (existing) continue;
    await ctx.db
      .insertInto('delegations')
      .values({
        approver_user_id: approverId,
        delegate_user_id: delegate.id,
        starts_at: startsAt,
        ends_at: endsAt,
        is_active: true,
      })
      .execute();
  }
}

async function loginActor(
  app: INestApplication,
  email: string,
  fullName: string,
  roles: Role[],
): Promise<Actor> {
  // Fresh IP per actor so the global ThrottlerGuard does not throttle the scenario
  // seed as one abusive client. The 9 scenarios fire hundreds of requests; sharing
  // one IP across approvers would 429 long before the suite finishes.
  const http = httpClient(app);
  const session = await login(http, email, DEV_PASSWORD);
  const userId = (session as unknown as { user?: { id: string } }).user?.id ?? '';
  return {
    id: userId,
    email,
    client: http.as(session.accessToken),
    fullName,
    roles,
  };
}

/**
 * Deletes scenarios from previous runs so a re-run produces a fresh, deterministic set.
 *
 * Production-style triggers block UPDATEs on requisitions and requisition_events. We disable
 * them for the duration of this reset, exactly like `factories.resetData` does for tests.
 */
async function clearPreviousScenarios(db: Db): Promise<void> {
  await sql`ALTER TABLE requisition_events DISABLE TRIGGER requisition_events_no_update`.execute(
    db,
  );
  try {
    const scenarioReqs = await db
      .selectFrom('requisitions')
      .select('id')
      .where('reason', 'like', 'seed-scenario-%')
      .execute();
    if (scenarioReqs.length === 0) return;
    const ids = scenarioReqs.map((r) => r.id);

    await db.deleteFrom('fund_returns').where('requisition_id', 'in', ids).execute();
    // purchase_lines and bom_lines point at requisition_items with ON DELETE RESTRICT,
    // so they have to go before the requisition_items row. Both are scoped to the
    // scenario requisitions so we never touch rows from other flows.
    await db.deleteFrom('purchase_lines').where('requisition_item_id', 'in', (eb) =>
      eb.selectFrom('requisition_items').select('id').where('requisition_id', 'in', ids),
    ).execute();
    await db.deleteFrom('purchases').where('requisition_id', 'in', ids).execute();
    await db.deleteFrom('fund_receipts').where('requisition_id', 'in', ids).execute();
    await db.deleteFrom('borrow_returns').execute();
    await db.deleteFrom('borrow_requests').execute();
    await db.deleteFrom('bom_lines').where('requisition_item_id', 'in', (eb) =>
      eb.selectFrom('requisition_items').select('id').where('requisition_id', 'in', ids),
    ).execute();
    await db.deleteFrom('bom_requisitions').where('requisition_id', 'in', ids).execute();
    await db.deleteFrom('boms').where('id', 'in', (eb) =>
      eb.selectFrom('bom_requisitions').select('bom_id').where('requisition_id', 'in', ids),
    ).execute();
    await db.deleteFrom('requisition_approvals').where('requisition_id', 'in', ids).execute();
    await db.deleteFrom('requisition_items').where('requisition_id', 'in', ids).execute();
    await db.deleteFrom('requisition_events').where('requisition_id', 'in', ids).execute();
    await db.deleteFrom('requisitions').where('id', 'in', ids).execute();
    // Delegations: previous-run scenario delegations are daisy-chained on the same
    // delegate user we just created, so they will be present when insertActiveDelegation
    // runs (it checks for existing rows first).
  } finally {
    await sql`ALTER TABLE requisition_events ENABLE TRIGGER requisition_events_no_update`.execute(
      db,
    );
  }
}

/* ============================================================================
 * shared helpers
 * ========================================================================== */

function approvalOf(detail: RequisitionDetail, stage: string, slot = 1) {
  const found = detail.approvals.find((a) => a.stage === stage && a.slot === slot);
  if (!found) throw new Error(`No approval row for stage=${stage} slot=${slot}`);
  return found as { id: string; action: string };
}

async function getDetail(client: HttpClient, id: string): Promise<RequisitionDetail> {
  const response = await client.get(`/requisitions/${id}`).send();
  if (response.status !== 200) {
    throw new Error(`Failed to fetch requisition ${id}: ${response.status}`);
  }
  return response.body as RequisitionDetail;
}

async function getFunding(client: HttpClient, id: string): Promise<RequisitionFunding> {
  const response = await client.get(`/requisitions/${id}/funding`).send();
  if (response.status !== 200) {
    throw new Error(`Failed to fetch funding ${id}: ${response.status}`);
  }
  return response.body as RequisitionFunding;
}

interface ApprovalActors {
  requester: Actor;
  im: Actor;
  approver1: Actor;
  approver2: Actor;
  delegate: Actor;
}

interface DriveApprovalOptions {
  amount: number;
  itemName: string;
  reason?: string;
  secondApprover?: Actor;
  approvedAmount?: number;
  reject?: 'im' | 'approver1';
  cancelInImReview?: boolean;
}

/**
 * Drives a requisition through the approval chain. Returns the latest detail.
 */
async function driveApproval(
  actors: ApprovalActors,
  options: DriveApprovalOptions,
): Promise<RequisitionDetail> {
  const created = await actors.requester.client.post('/requisitions').send({
    departmentId: null,
    urgency: 'NORMAL',
    reason: options.reason ?? `seed-scenario-${slugify(options.itemName)}`,
    items: [
      {
        itemName: options.itemName,
        quantity: 1,
        estimatedUnitPrice: options.amount,
        productId: null,
        note: null,
      },
    ],
  });
  if (created.status !== 201) {
    throw new Error(`Failed to create draft: ${created.status} ${JSON.stringify(created.body)}`);
  }

  const submitted = await actors.requester.client
    .post(`/requisitions/${created.body.id}/submit`)
    .send();
  if (submitted.status !== 200) {
    throw new Error(`Submit failed: ${submitted.status} ${JSON.stringify(submitted.body)}`);
  }
  let detail = submitted.body as RequisitionDetail;

  if (options.cancelInImReview) {
    const cancelled = await actors.requester.client
      .post(`/requisitions/${detail.id}/cancel`)
      .send();
    if (cancelled.status !== 200) {
      throw new Error(`Cancel failed: ${cancelled.status}`);
    }
    return cancelled.body as RequisitionDetail;
  }

  const imApproval = approvalOf(detail, ApprovalStage.INVENTORY_MANAGER).id;
  const imResponse = await actors.im.client
    .post(`/requisitions/approvals/${imApproval}/decision`)
    .send({ approve: options.reject !== 'im' });
  if (imResponse.status !== 200) {
    throw new Error(`IM decision failed: ${imResponse.status}`);
  }
  detail = imResponse.body as RequisitionDetail;
  if (options.reject === 'im') return detail;

  const approverCount = detail.requiredApproverCount ?? 1;
  for (let slot = 1; slot <= approverCount; slot += 1) {
    const approval = approvalOf(detail, ApprovalStage.APPROVER, slot);
    const actor = slot === 1 ? actors.approver1 : (options.secondApprover ?? actors.approver2);
    const response = await actor.client
      .post(`/requisitions/approvals/${approval.id}/decision`)
      .send({
        approve: options.reject !== 'approver1' || slot !== 1,
        ...(slot === 1 && options.approvedAmount !== undefined
          ? { approvedAmount: options.approvedAmount }
          : {}),
      });
    if (response.status !== 200) {
      throw new Error(`Approver ${slot} decision failed: ${response.status} ${JSON.stringify(response.body)}`);
    }
    detail = response.body as RequisitionDetail;
    // A rejection on one slot terminates the chain — the requisition is already REJECTED,
    // so slot 2 (and any later slot) cannot decide. Stop here.
    if (detail.status === RequisitionStatus.REJECTED) {
      return detail;
    }
  }

  return detail;
}

interface DriveFundsOptions {
  spend: number;
  funded?: number;
  vendor?: string;
  vendorCount?: number;
  attachInvoice?: boolean;
  returnedAmount?: number;
  returnNote?: string;
}

async function driveFundsAndPurchase(
  actors: ApprovalActors,
  req: RequisitionDetail,
  options: DriveFundsOptions,
): Promise<RequisitionFunding> {
  const fundedAmount = options.funded ?? req.approvedAmount ?? req.requestedAmount ?? 0;
  const lineCount = options.vendorCount ?? 1;
  const spendPerPurchase = options.spend / lineCount;
  const requisitionItemId = req.items[0]!.id;

  // Generate a BOM so the requisition moves to BOM_GENERATED. Without this step the
  // send-to-accounts endpoint refuses with REQUISITION_INVALID_TRANSITION.
  const bom = await actors.im.client
    .post('/boms')
    .send({
      requisitionIds: [req.id],
      lines: req.items.map((item) => ({
        requisitionItemId: item.id,
        unitCost: spendPerPurchase,
        vendor: options.vendor ?? `Vendor for ${req.requisitionNo}`,
      })),
    });
  if (bom.status !== 201) {
    throw new Error(`BOM generate failed: ${bom.status} ${JSON.stringify(bom.body)}`);
  }

  await actors.im.client.post(`/requisitions/${req.id}/send-to-accounts`).send({ note: null });

  await actors.im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
    amount: fundedAmount,
    receivedAt: new Date().toISOString(),
    reference: 'CHQ-SEED',
    note: null,
  });

  for (let i = 0; i < lineCount; i += 1) {
    const purchaseResponse = await actors.im.client
      .post(`/requisitions/${req.id}/purchases`)
      .send({
        vendor: options.vendor ?? `Vendor ${i + 1}`,
        invoiceNo: `INV-${req.requisitionNo}-${i + 1}`,
        purchasedAt: new Date().toISOString(),
        note: null,
        lines: [
          {
            requisitionItemId,
            quantity: 1,
            unitCost: spendPerPurchase,
            overBomQuantity: false,
            overBomNote: null,
          },
        ],
      });
    if (purchaseResponse.status !== 201) {
      throw new Error(`Purchase ${i + 1} failed: ${purchaseResponse.status} ${JSON.stringify(purchaseResponse.body)}`);
    }

    if (options.attachInvoice) {
      const funding = await getFunding(actors.im.client, req.id);
      const purchaseId = funding.purchases[i]!.id;
      await actors.im.client
        .post(`/requisitions/${req.id}/purchases/${purchaseId}/invoice`)
        .attach('file', Buffer.from('%PDF-1.4 invoice'), `invoice-${i + 1}.pdf`);
    }
  }

  const verify = await actors.im.client
    .post(`/requisitions/${req.id}/verify-purchase`)
    .send({
      returnedAmount: options.returnedAmount ?? 0,
      returnNote:
        options.returnedAmount && options.returnedAmount > 0 ? options.returnNote ?? null : null,
    });
  if (verify.status !== 200) {
    throw new Error(`Verify failed: ${verify.status}`);
  }

  return getFunding(actors.im.client, req.id);
}

function recordScenario(
  req: RequisitionDetail,
  scenario: string,
  funding?: RequisitionFunding,
): void {
  results.push({
    requisitionNo: req.requisitionNo,
    scenario,
    status: req.status,
    spent: funding?.spent ?? 0,
    returned: funding?.returned ?? 0,
    funded: funding?.funded ?? 0,
  });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ============================================================================
 * scenarios
 * ========================================================================== */

/**
 * REQ-01 — Sub-threshold, single approver, full spend, full receive, in stock.
 */
async function scenarioHappyPath(actors: ApprovalActors, ctx: TestApp): Promise<void> {
  const detail = await driveApproval(actors, { amount: 5_000, itemName: 'Happy path laptop' });
  if (detail.status !== RequisitionStatus.APPROVED) {
    throw new Error(`REQ-01: expected APPROVED, got ${detail.status}`);
  }

  const funding = await driveFundsAndPurchase(actors, detail, {
    spend: 4_800,
    vendor: 'Techshop BD',
    attachInvoice: true,
  });

  const compartmentId = await ensureCompartment(ctx.db, 'Main', 'A1');
  const categoryId = await ensureCategory(ctx.db);
  const productCode = `SC01-${Date.now() % 100000}`;

  const receive = await actors.im.client.post(`/requisitions/${detail.id}/receive-to-stock`).send({
    lines: [
      {
        purchaseLineId: funding.purchases[0]!.lines[0]!.id,
        compartmentId,
        quantity: 1,
        newProduct: {
          productCode,
          name: 'Happy path laptop',
          categoryId,
          unit: 'pcs',
        },
      },
    ],
  });
  if (receive.status !== 200) {
    throw new Error(`REQ-01 receive failed: ${receive.status}`);
  }

  const finalDetail = await getDetail(actors.requester.client, detail.id);
  if (finalDetail.status !== RequisitionStatus.STOCKED) {
    throw new Error(`REQ-01: expected STOCKED, got ${finalDetail.status}`);
  }

  recordScenario(finalDetail, 'Sub-threshold happy path', receive.body as RequisitionFunding);
}

/**
 * REQ-02 — At-threshold, two approvers; second approver acts through a delegate.
 */
async function scenarioAtThresholdTwoApprovers(actors: ApprovalActors, ctx: TestApp): Promise<void> {
  const detail = await driveApproval(actors, {
    amount: 20_000,
    itemName: 'At-threshold server',
    secondApprover: actors.delegate,
  });
  if (detail.status !== RequisitionStatus.APPROVED) {
    throw new Error(`REQ-02: expected APPROVED, got ${detail.status}`);
  }
  if (detail.requiredApproverCount !== 2) {
    throw new Error(`REQ-02: expected 2 approvers, got ${detail.requiredApproverCount}`);
  }

  const funding = await driveFundsAndPurchase(actors, detail, {
    spend: 18_500,
    vendor: 'Datacore',
    attachInvoice: true,
  });

  const compartmentId = await ensureCompartment(ctx.db, 'Main', 'B2');
  const categoryId = await ensureCategory(ctx.db);
  await receiveLine(actors.im, detail.id, funding.purchases[0]!.lines[0]!.id, {
    compartmentId,
    quantity: 1,
    productCode: `SC02-${Date.now() % 100000}`,
    name: 'At-threshold server',
    categoryId,
  });

  const finalDetail = await getDetail(actors.requester.client, detail.id);
  if (finalDetail.status !== RequisitionStatus.STOCKED) {
    throw new Error(`REQ-02: expected STOCKED, got ${finalDetail.status}`);
  }

  const delegateApproval = finalDetail.approvals.find(
    (a) => a.stage === ApprovalStage.APPROVER && a.slot === 2,
  );
  if (!delegateApproval || delegateApproval.actedByUserId !== actors.delegate.id) {
    throw new Error('REQ-02: delegate did not act on behalf of approver2');
  }

  recordScenario(finalDetail, 'At-threshold two-approver + delegate', funding);
}

/**
 * REQ-03 — Approved amount revised downward, then return-to-Accounts.
 */
async function scenarioAmountRevisedWithReturn(actors: ApprovalActors): Promise<void> {
  const detail = await driveApproval(actors, {
    amount: 10_000,
    itemName: 'Amount-revised sensors',
    approvedAmount: 8_000,
  });
  if (detail.status !== RequisitionStatus.APPROVED || detail.approvedAmount !== 8_000) {
    throw new Error(`REQ-03: expected APPROVED 8000, got ${detail.status} / ${detail.approvedAmount}`);
  }
  const hasRevisedEvent = detail.events.some(
    (e) => e.eventType === RequisitionEventType.AMOUNT_REVISED,
  );
  if (!hasRevisedEvent) {
    throw new Error('REQ-03: missing AMOUNT_REVISED event');
  }

  const funding = await driveFundsAndPurchase(actors, detail, {
    spend: 6_000,
    funded: 8_000,
    vendor: 'SensorMart',
    attachInvoice: true,
    returnedAmount: 2_000,
    returnNote: 'Vendor discount on the sensors',
  });
  if (funding.returned !== 2_000) {
    throw new Error(`REQ-03: expected returned=2000, got ${funding.returned}`);
  }
  const finalDetail = await getDetail(actors.requester.client, detail.id);
  recordScenario(finalDetail, 'Amount revised + return-to-Accounts', funding);
}

/**
 * REQ-04 — Approver rejected after sibling approved (terminal REJECTED).
 */
async function scenarioLateRejection(actors: ApprovalActors): Promise<void> {
  const detail = await driveApproval(actors, {
    amount: 25_000,
    itemName: 'Late rejection server',
    reject: 'approver1',
  });
  if (detail.status !== RequisitionStatus.REJECTED) {
    throw new Error(`REQ-04: expected REJECTED, got ${detail.status}`);
  }
  recordScenario(detail, 'Approver rejected after sibling approved');
}

/**
 * REQ-05 — Cancelled by requester in IM_REVIEW, plus one DRAFT left for the UI.
 */
async function scenarioCancelledInImReview(actors: ApprovalActors): Promise<void> {
  const cancelled = await driveApproval(actors, {
    amount: 4_500,
    itemName: 'Cancelled laptop',
    cancelInImReview: true,
  });
  if (cancelled.status !== RequisitionStatus.CANCELLED) {
    throw new Error(`REQ-05: expected CANCELLED, got ${cancelled.status}`);
  }
  recordScenario(cancelled, 'Cancelled in IM_REVIEW');

  const draft = await actors.requester.client.post('/requisitions').send({
    departmentId: null,
    urgency: 'LOW',
    reason: 'seed-scenario-draft-placeholder',
    items: [
      {
        itemName: 'Draft placeholder',
        quantity: 1,
        estimatedUnitPrice: 1_000,
        productId: null,
        note: null,
      },
    ],
  });
  if (draft.status !== 201) {
    throw new Error(`REQ-05 draft failed: ${draft.status} ${JSON.stringify(draft.body)}`);
  }
  recordScenario(draft.body as RequisitionDetail, 'DRAFT left for UI list');
}

/**
 * REQ-06 — Free-text line becomes catalogue product on receive.
 */
async function scenarioFreeTextBecomesProduct(actors: ApprovalActors, ctx: TestApp): Promise<void> {
  const detail = await driveApproval(actors, { amount: 3_000, itemName: 'Free-text widget' });
  if (detail.status !== RequisitionStatus.APPROVED) {
    throw new Error(`REQ-06: expected APPROVED, got ${detail.status}`);
  }
  const funding = await driveFundsAndPurchase(actors, detail, {
    spend: 2_700,
    vendor: 'WidgetWorks',
    attachInvoice: true,
  });
  const compartmentId = await ensureCompartment(ctx.db, 'Main', 'C3');
  const categoryId = await ensureCategory(ctx.db);
  const receive = await receiveLine(actors.im, detail.id, funding.purchases[0]!.lines[0]!.id, {
    compartmentId,
    quantity: 1,
    productCode: `SC06-${Date.now() % 100000}`,
    name: 'Free-text widget',
    categoryId,
  });
  if (!receive.purchases[0]!.lines[0]!.productId) {
    throw new Error('REQ-06: free-text line did not flip to a catalogue product');
  }
  const finalDetail = await getDetail(actors.requester.client, detail.id);
  recordScenario(finalDetail, 'Free-text → catalogue product on receive', receive);
}

/**
 * REQ-07 — Multi-vendor (two purchases, two invoices).
 */
async function scenarioMultiVendor(actors: ApprovalActors): Promise<void> {
  const detail = await driveApproval(actors, { amount: 15_000, itemName: 'Multi-vendor kit' });
  if (detail.status !== RequisitionStatus.APPROVED) {
    throw new Error(`REQ-07: expected APPROVED, got ${detail.status}`);
  }
  const funding = await driveFundsAndPurchase(actors, detail, {
    spend: 14_000,
    vendor: 'Vendor One',
    vendorCount: 2,
    attachInvoice: true,
  });
  if (funding.purchases.length !== 2) {
    throw new Error(`REQ-07: expected 2 purchases, got ${funding.purchases.length}`);
  }
  const finalDetail = await getDetail(actors.requester.client, detail.id);
  recordScenario(finalDetail, 'Multi-vendor (two purchases, two invoices)', funding);
}

/**
 * REQ-08 — Borrow straight from a verified purchase.
 */
async function scenarioBorrowFromVerified(
  actors: ApprovalActors & { borrower: Actor },
  ctx: TestApp,
): Promise<void> {
  const detail = await driveApproval(actors, { amount: 4_000, itemName: 'Borrow-out tool' });
  if (detail.status !== RequisitionStatus.APPROVED) {
    throw new Error(`REQ-08: expected APPROVED, got ${detail.status}`);
  }
  const funding = await driveFundsAndPurchase(actors, detail, {
    spend: 3_500,
    vendor: 'ToolVendor',
    attachInvoice: true,
  });

  const compartmentId = await ensureCompartment(ctx.db, 'Main', 'D4');
  const categoryId = await ensureCategory(ctx.db);
  const receive = await receiveLine(actors.im, detail.id, funding.purchases[0]!.lines[0]!.id, {
    compartmentId,
    quantity: 1,
    productCode: `SC08-${Date.now() % 100000}`,
    name: 'Borrow-out tool',
    categoryId,
  });

  const productId = receive.purchases[0]!.lines[0]!.productId!;

  const borrowCreate = await actors.im.client.post('/borrowing').send({
    productId,
    compartmentId,
    quantity: 1,
    isReturnable: true,
    expectedReturnDate: '2026-12-31',
    purpose: 'Seed-scenario borrow',
  });
  if (borrowCreate.status !== 201) {
    throw new Error(`REQ-08 borrow-create failed: ${borrowCreate.status}`);
  }
  const borrowId = borrowCreate.body.id as string;

  const decide = await actors.im.client
    .post(`/borrowing/${borrowId}/decision`)
    .send({ approve: true, note: 'ok' });
  if (decide.status !== 200 || decide.body.status !== BorrowStatus.ISSUED) {
    throw new Error(`REQ-08 borrow-decide failed: ${decide.status}`);
  }

  // Partial return: bring back less than was issued (borrow quantity 1, so we can only
  // demonstrate the path by issuing 2 — but the line is fixed at 1, so we settle for
  // recording a single return that fully settles it).
  const returned = await actors.im.client.post(`/borrowing/${borrowId}/returns`).send({
    quantity: 1,
    compartmentId,
    condition: 'GOOD',
  });
  if (returned.status !== 200 || returned.body.status !== BorrowStatus.RETURNED) {
    throw new Error(`REQ-08 return failed: ${returned.status}`);
  }

  const finalDetail = await getDetail(actors.requester.client, detail.id);
  recordScenario(finalDetail, 'Borrow straight from verified purchase', receive);
}

/* ============================================================================
 * small utilities
 * ========================================================================== */

async function ensureCompartment(db: Db, zoneName: string, code: string): Promise<string> {
  let zoneId: string | undefined = (
    await db.selectFrom('storage_zones').select('id').where('name', '=', zoneName).executeTakeFirst()
  )?.id;
  if (!zoneId) {
    zoneId = (
      await db
        .insertInto('storage_zones')
        .values({ name: zoneName })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  const existing = await db
    .selectFrom('storage_compartments')
    .select('id')
    .where('zone_id', '=', zoneId)
    .where('code', '=', code)
    .executeTakeFirst();
  if (existing) return existing.id;

  const created = await db
    .insertInto('storage_compartments')
    .values({ zone_id: zoneId, code })
    .returning('id')
    .executeTakeFirstOrThrow();
  return created.id;
}

async function ensureCategory(db: Db): Promise<string> {
  const existing = await db
    .selectFrom('categories')
    .select('id')
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (existing) return existing.id;

  const created = await db
    .insertInto('categories')
    .values({ name: 'Seed Scenarios', is_trackable: true })
    .returning('id')
    .executeTakeFirstOrThrow();
  return created.id;
}

interface ReceiveLineInput {
  compartmentId: string;
  quantity: number;
  productCode: string;
  name: string;
  categoryId: string;
}

async function receiveLine(
  im: Actor,
  requisitionId: string,
  purchaseLineId: string,
  input: ReceiveLineInput,
): Promise<RequisitionFunding> {
  const response = await im.client.post(`/requisitions/${requisitionId}/receive-to-stock`).send({
    lines: [
      {
        purchaseLineId,
        compartmentId: input.compartmentId,
        quantity: input.quantity,
        newProduct: {
          productCode: input.productCode,
          name: input.name,
          categoryId: input.categoryId,
          unit: 'pcs',
        },
      },
    ],
  });
  if (response.status !== 200) {
    throw new Error(`receive-line failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as RequisitionFunding;
}

/* ============================================================================
 * negative checks (do not persist)
 * ========================================================================== */

async function runNegativeChecks(actors: ApprovalActors, ctx: TestApp): Promise<void> {
  const db = ctx.db;

  // 1. Over-funding refused.
  await assertNegative('over-funding refused', async () => {
    const req = await driveApproval(actors, { amount: 5_000, itemName: 'Over-fund attempt' });
    await actors.im.client
      .post('/boms')
      .send({
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 5_000, vendor: 'V' }],
      });
    await actors.im.client.post(`/requisitions/${req.id}/send-to-accounts`).send({ note: null });
    const over = await actors.im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
      amount: 5_001,
      receivedAt: new Date().toISOString(),
    });
    return { ok: over.status === 409, requisitionId: req.id };
  });

  // 2. Verify without invoice refused.
  await assertNegative('verify without invoice refused', async () => {
    const req = await driveApproval(actors, {
      amount: 5_000,
      itemName: 'Verify-without-invoice attempt',
    });
    await actors.im.client
      .post('/boms')
      .send({
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 4_500, vendor: 'V' }],
      });
    await actors.im.client.post(`/requisitions/${req.id}/send-to-accounts`).send({ note: null });
    await actors.im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
      amount: 5_000,
      receivedAt: new Date().toISOString(),
    });
    await actors.im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'V',
      invoiceNo: 'INV-VW-1',
      purchasedAt: new Date().toISOString(),
      note: null,
      lines: [{ requisitionItemId: req.items[0]!.id, quantity: 1, unitCost: 4_500, overBomQuantity: false, overBomNote: null }],
    });
    const verify = await actors.im.client
      .post(`/requisitions/${req.id}/verify-purchase`)
      .send({});
    return { ok: verify.status === 409, requisitionId: req.id };
  });

  // 3. Return > unspent refused.
  await assertNegative('return > unspent refused', async () => {
    const req = await driveApproval(actors, { amount: 5_000, itemName: 'Over-return attempt' });
    await actors.im.client
      .post('/boms')
      .send({
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 4_000, vendor: 'V' }],
      });
    await actors.im.client.post(`/requisitions/${req.id}/send-to-accounts`).send({ note: null });
    await actors.im.client.post(`/requisitions/${req.id}/fund-receipts`).send({
      amount: 5_000,
      receivedAt: new Date().toISOString(),
    });
    const purchaseResp = await actors.im.client.post(`/requisitions/${req.id}/purchases`).send({
      vendor: 'V',
      invoiceNo: 'INV-OR-1',
      purchasedAt: new Date().toISOString(),
      note: null,
      lines: [{ requisitionItemId: req.items[0]!.id, quantity: 1, unitCost: 4_000, overBomQuantity: false, overBomNote: null }],
    });
    if (purchaseResp.status !== 201) {
      throw new Error(`purchase failed: ${purchaseResp.status} ${JSON.stringify(purchaseResp.body)}`);
    }
    const funding = await getFunding(actors.im.client, req.id);
    const purchaseId = funding.purchases[0]?.id;
    if (!purchaseId) {
      throw new Error(`no purchase row returned: ${JSON.stringify(funding)}`);
    }
    await actors.im.client
      .post(`/requisitions/${req.id}/purchases/${purchaseId}/invoice`)
      .attach('file', Buffer.from('%PDF-1.4 invoice'), 'inv.pdf');
    const over = await actors.im.client
      .post(`/requisitions/${req.id}/verify-purchase`)
      .send({ returnedAmount: 2_000, returnNote: 'too much' });
    return { ok: over.status === 409, requisitionId: req.id };
  });

  // 4. Cancel someone else's requisition refused.
  await assertNegative('cancel someone else refused', async () => {
    const created = await actors.requester.client.post('/requisitions').send({
      departmentId: null,
      urgency: 'NORMAL',
      reason: 'seed-scenario-cancel-attempt',
      items: [
        {
          itemName: 'Cancel attempt',
          quantity: 1,
          estimatedUnitPrice: 1_000,
          productId: null,
          note: null,
        },
      ],
    });
    const cancel = await actors.im.client
      .post(`/requisitions/${created.body.id}/cancel`)
      .send();
    return { ok: cancel.status === 403, requisitionId: created.body.id as string };
  });

  // 5. Submit twice refused.
  await assertNegative('submit twice refused', async () => {
    const created = await actors.requester.client.post('/requisitions').send({
      departmentId: null,
      urgency: 'NORMAL',
      reason: 'seed-scenario-double-submit-attempt',
      items: [
        {
          itemName: 'Double submit',
          quantity: 1,
          estimatedUnitPrice: 2_000,
          productId: null,
          note: null,
        },
      ],
    });
    await actors.requester.client
      .post(`/requisitions/${created.body.id}/submit`)
      .send();
    const again = await actors.requester.client
      .post(`/requisitions/${created.body.id}/submit`)
      .send();
    return { ok: again.status === 409, requisitionId: created.body.id as string };
  });

  void db;
}

async function assertNegative(
  label: string,
  attempt: () => Promise<{ ok: boolean; requisitionId?: string }>,
): Promise<void> {
  try {
    const result = await attempt();
    if (result.ok) {
      console.log(`  negative  ✓ ${label}`);
    } else {
      console.log(`  negative  ✗ ${label} (expected rejection but got success)`);
    }
    if (result.requisitionId) {
      await cleanupNegativeRow(result.requisitionId);
    }
  } catch (error: unknown) {
    console.log(`  negative  ✗ ${label} (${error instanceof Error ? error.message : error})`);
  }
}

async function cleanupNegativeRow(requisitionId: string): Promise<void> {
  const { db } = createDatabase(config);
  await sql`ALTER TABLE requisition_events DISABLE TRIGGER requisition_events_no_update`.execute(
    db,
  );
  try {
    // purchase_lines and bom_lines point at requisition_items with ON DELETE RESTRICT, so they
    // have to go first.
    await db.deleteFrom('purchase_lines').where('requisition_item_id', 'in', (eb) =>
      eb.selectFrom('requisition_items').select('id').where('requisition_id', '=', requisitionId),
    ).execute();
    await db.deleteFrom('purchases').where('requisition_id', '=', requisitionId).execute();
    await db.deleteFrom('fund_receipts').where('requisition_id', '=', requisitionId).execute();
    await db.deleteFrom('bom_lines').where('requisition_item_id', 'in', (eb) =>
      eb.selectFrom('requisition_items').select('id').where('requisition_id', '=', requisitionId),
    ).execute();
    await db.deleteFrom('bom_requisitions').where('requisition_id', '=', requisitionId).execute();
    await db.deleteFrom('requisition_approvals').where('requisition_id', '=', requisitionId).execute();
    await db.deleteFrom('requisition_items').where('requisition_id', '=', requisitionId).execute();
    await db.deleteFrom('requisition_events').where('requisition_id', '=', requisitionId).execute();
    await db.deleteFrom('requisitions').where('id', '=', requisitionId).execute();
  } finally {
    await sql`ALTER TABLE requisition_events ENABLE TRIGGER requisition_events_no_update`.execute(
      db,
    );
    await db.destroy();
  }
}

/* ============================================================================
 * DEL-01 + REQ-09 — direct inserts
 * ========================================================================== */

async function insertActiveDelegation(actors: ApprovalActors): Promise<void> {
  const { db } = createDatabase(config);
  try {
    const now = new Date();
    const endsAt = new Date(now.getTime() + 7 * 24 * 3_600_000);
    const startsAt = new Date(now.getTime() - 3_600_000);

    // REQ-02's slot 2 approval goes through the delegate — so the delegate must be delegated
    // by *approver2*, not approver1. We insert both so the scenarios plus the UI's "active
    // delegations" panel both have something to display.
    for (const [label, approverId] of [
      ['DEL-01 (approver1 → delegate)', actors.approver1.id],
      ['DEL-02 (approver2 → delegate)', actors.approver2.id],
    ] as const) {
      const existing = await db
        .selectFrom('delegations')
        .select('id')
        .where('approver_user_id', '=', approverId)
        .where('delegate_user_id', '=', actors.delegate.id)
        .where('is_active', '=', true)
        .where('starts_at', '<=', now)
        .where('ends_at', '>', now)
        .executeTakeFirst();
      if (existing) {
        console.log(`  delegation ✓ ${label} already present`);
        continue;
      }
      await db
        .insertInto('delegations')
        .values({
          approver_user_id: approverId,
          delegate_user_id: actors.delegate.id,
          starts_at: startsAt,
          ends_at: endsAt,
          is_active: true,
        })
        .execute();
      console.log(`  delegation ✓ ${label} active`);
    }
  } catch (error: unknown) {
    console.log(`  delegation - DEL (${error instanceof Error ? error.message : error})`);
  } finally {
    await db.destroy();
  }
}

async function insertOverdueBorrow(db: Db, actors: ApprovalActors): Promise<void> {
  try {
    const product = await db
      .selectFrom('products')
      .select('id')
      .where('product_code', '=', 'LAP-0001')
      .executeTakeFirst();
    const compartment = await db
      .selectFrom('storage_compartments')
      .innerJoin('storage_zones', 'storage_zones.id', 'storage_compartments.zone_id')
      .select('storage_compartments.id')
      .where('storage_zones.name', '=', 'Meta')
      .where('storage_compartments.code', '=', '1A')
      .executeTakeFirst();
    if (!product || !compartment) {
      console.log('  borrow    - REQ-09 (catalogue or compartment missing, skipping)');
      return;
    }

    // Use the existing placement: pick the LAP-0001 row in Meta/1A. The placement row is
    // required by the schema (placement_id is NOT NULL).
    const placement = await db
      .selectFrom('stock_placements')
      .select('id')
      .where('product_id', '=', product.id)
      .where('compartment_id', '=', compartment.id)
      .executeTakeFirst();
    if (!placement) {
      console.log('  borrow    - REQ-09 (no placement for LAP-0001 in Meta/1A, skipping)');
      return;
    }

    const yesterday = new Date(Date.now() - 24 * 3_600_000);
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3_600_000);

    // Generate a borrow_no via the sequence; the production path does this inside the
    // service.
    const seq = await sql<{ n: string }>`SELECT nextval('borrow_no_seq') as n`.execute(
      db,
    );
    const borrowNo = `BR-${String(seq.rows[0]!.n).padStart(6, '0')}`;

    const inserted = await db
      .insertInto('borrow_requests')
      .values({
        borrow_no: borrowNo,
        requester_id: actors.requester.id,
        product_id: product.id,
        placement_id: placement.id,
        compartment_id: compartment.id,
        quantity: 1,
        is_returnable: true,
        expected_return_date: yesterday.toISOString().slice(0, 10),
        purpose: 'Seed scenario overdue borrow',
        status: BorrowStatus.ISSUED,
        decided_by: actors.im.id,
        decided_at: fiveDaysAgo,
        issued_at: fiveDaysAgo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    console.log(`  borrow    ✓ REQ-09 overdue borrow inserted (${inserted.id})`);
  } catch (error: unknown) {
    console.log(`  borrow    - REQ-09 (${error instanceof Error ? error.message : error})`);
  }
}

/* ============================================================================
 * dev index
 * ========================================================================== */

async function printScenarioIndex(db: Db): Promise<void> {
  const rows = await db
    .selectFrom('requisitions')
    .select([
      'requisition_no as requisitionNo',
      'status',
      'requested_amount as requested',
      'approved_amount as approved',
      'reason',
    ])
    .where('reason', 'like', 'seed-scenario-%')
    .orderBy('requisition_no', 'asc')
    .execute();

  console.log('\n=== Dev scenario index ===');
  console.log(
    '| Requisition | Status            | Req     | Appr    | Funded   | Spent    | Returned | Scenario',
  );
  console.log(
    '|-------------|-------------------|---------|---------|----------|----------|----------|----------',
  );

  const scenarioByReqNo = new Map(results.map((r) => [r.requisitionNo, r.scenario]));

  for (const row of rows) {
    const req = results.find((r) => r.requisitionNo === row.requisitionNo);
    const reason = row.reason ?? '';
    const scenario =
      scenarioByReqNo.get(row.requisitionNo) ?? reason.replace('seed-scenario-', '');
    const status = String(row.status).padEnd(17);
    console.log(
      `| ${row.requisitionNo.padEnd(11)} | ${status} | ${formatAmount(row.requested ?? 0).padEnd(7)} | ${formatAmount(row.approved ?? 0).padEnd(7)} | ${formatAmount(req?.funded ?? 0).padEnd(8)} | ${formatAmount(req?.spent ?? 0).padEnd(8)} | ${formatAmount(req?.returned ?? 0).padEnd(8)} | ${scenario}`,
    );
  }
  console.log('\nDone.');
}

function formatAmount(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '0.00';
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(numeric)) return '0.00';
  return numeric.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
