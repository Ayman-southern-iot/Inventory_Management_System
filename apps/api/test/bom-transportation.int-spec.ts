import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  Role,
  type BomDetail,
} from '@ims/shared';
import { AppModule } from '../src/app.module';
import { config } from '../src/config';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { DB } from '../src/database/database.module';
import type { Db } from '../src/database/create-db';
import { renderBomHtml } from '../src/modules/boms/bom-pdf.template';
import { httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData, seedSubthresholdApprover } from './factories';

/**
 * Transportation cost on a requisition, as it lands on the BOM.
 *
 * Two surfaces are pinned here:
 *
 *   1. The snapshot. `bom.sources[0].transportationCost` and `…Description` are read straight off
 *      the `bom_requisitions.approval_snapshot` JSON. A test there means the snapshot writer
 *      captured the values, so the historical record (and a future re-render of the PDF) still
 *      carries the description even if the live requisition is later edited.
 *
 *   2. The PDF HTML. The template prints a `<tr class="transportation">` row per source that
 *      carries a non-zero transportation cost. The same row is omitted when nothing was set,
 *      so the PDF stays the same shape for the existing 99% of requisitions that don't carry
 *      one.
 *
 * The renderer (Chromium) is not exercised here — `renderBomHtml` is a pure function of the
 * detail + context, so the HTML contract is the surface area the rest of the app depends on.
 */
describe('BOM transportation cost', () => {
  interface Actor {
    id: string;
    client: HttpClient;
  }

  let ctx: TestApp;
  let requester: Actor;
  let im: Actor;
  let approver1: Actor;
  let departmentId: string;

  const actorFor = async (roles: Role[]): Promise<Actor> => {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return { id: user.id, client: http.as(session.accessToken) };
  };

  /** Same minimal render context the BOM PDF tests use. */
  const CONTEXT = {
    company: {
      name: 'Southern IoT',
      addressLines: ['House 26, Road 13, Sector 14', 'Uttara, Dhaka - 1230', 'Bangladesh'],
      logoUri: null,
    },
    signatureUris: {},
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.setGlobalPrefix(config.http.globalPrefix, { exclude: ['health'] });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.set('trust proxy', 1);

    await app.init();
    ctx = {
      app,
      moduleRef,
      db: app.get<Db>(DB),
      close: async () => {
        await app.close();
      },
    };
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);

    requester = await actorFor([Role.GENERAL]);
    im = await actorFor([Role.GENERAL, Role.INVENTORY_MANAGER]);
    approver1 = await actorFor([Role.GENERAL, Role.APPROVER]);

    const department = await ctx.db
      .insertInto('departments')
      .values({ name: `Dept ${Date.now()}-${Math.random()}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    departmentId = department.id;

    await ctx.db
      .insertInto('approver_slots')
      .values([{ department_id: null, slot_no: 1, user_id: approver1.id }])
      .execute();

    await seedSubthresholdApprover(ctx, approver1.id);
  });

  /**
   * Drive a requisition all the way through IM review + approver approval, with an optional
   * transportation cost. Returns the approved requisition detail so the BOM generator has the
   * item ids it needs to build `lines`.
   */
  const approveRequisition = async (options: {
    itemsTotal: number;
    transportationCost?: number;
    transportationDescription?: string;
  }) => {
    const { itemsTotal, transportationCost = 0, transportationDescription = null } = options;
    const transportationBody =
      transportationCost > 0
        ? { transportationCost, transportationDescription }
        : {};

    const created = await requester.client.post('/requisitions').send({
      departmentId,
      urgency: 'NORMAL',
      reason: 'BOM transportation test',
      items: [
        {
          itemName: 'Cable',
          quantity: 4,
          estimatedUnitPrice: itemsTotal / 4,
          productId: null,
          note: null,
        },
      ],
      ...transportationBody,
    });
    expect(created.status).toBe(201);

    const submitted = (await requester.client.post(`/requisitions/${created.body.id}/submit`).send())
      .body;
    const imApprovalId = submitted.approvals.find(
      (a: { stage: string }) => a.stage === 'INVENTORY_MANAGER',
    ).id;
    const afterIm = (
      await im.client.post(`/requisitions/approvals/${imApprovalId}/decision`).send({ approve: true })
    ).body;

    const approverCount = submitted.requiredApproverCount as number;
    for (let slot = 1; slot <= approverCount; slot += 1) {
      const approvalId = afterIm.approvals.find(
        (a: { stage: string; slot: number }) => a.stage === 'APPROVER' && a.slot === slot,
      )?.id;
      await approver1.client
        .post(`/requisitions/approvals/${approvalId}/decision`)
        .send({ approve: true });
    }

    return (await requester.client.get(`/requisitions/${created.body.id}`)).body as {
      id: string;
      requisitionNo: string;
      items: Array<{ id: string; itemName: string; quantity: number; estimatedUnitPrice: number }>;
      approvedAmount: number;
      approvals: Array<{ id: string; stage: string; slot: number; action: string }>;
    };
  };

  const generateBom = async (
    requisitionId: string,
    items: Array<{ id: string }>,
  ): Promise<BomDetail> => {
    const created = (
      await im.client.post('/boms').send({
        requisitionIds: [requisitionId],
        lines: items.map((item) => ({
          requisitionItemId: item.id,
          unitCost: 250,
          vendor: 'Acme',
        })),
      })
    ).body as BomDetail;
    return created;
  };

  /* ------------------------------------------------------- snapshot fields */

  it('the snapshot carries the transportation cost and description when set', async () => {
    const req = await approveRequisition({
      itemsTotal: 1000,
      transportationCost: 1200,
      transportationDescription: 'Pickup truck to Gazipur',
    });
    const bom = await generateBom(req.id, req.items);

    expect(bom.sources).toHaveLength(1);
    expect(bom.sources[0]!.transportationCost).toBe(1200);
    expect(bom.sources[0]!.transportationDescription).toBe('Pickup truck to Gazipur');
  });

  it('the snapshot has null transportation fields when the requisition did not set them', async () => {
    const req = await approveRequisition({ itemsTotal: 1000 });
    const bom = await generateBom(req.id, req.items);

    expect(bom.sources[0]!.transportationCost).toBeNull();
    expect(bom.sources[0]!.transportationDescription).toBeNull();
  });

  it('the snapshot includes transportation in the frozen requested amount', async () => {
    const req = await approveRequisition({
      itemsTotal: 1000,
      transportationCost: 200,
      transportationDescription: 'CNG',
    });
    const bom = await generateBom(req.id, req.items);

    // Items total = 1000, transportation = 200 → requestedAmount is frozen at 1200.
    expect(bom.sources[0]!.requestedAmount).toBe(1200);
    expect(bom.subtotal).toBe(1000);
  });

  /* --------------------------------------------------------- PDF rendering */

  it('PDF prints a Transportation row per source when cost is set', async () => {
    const req = await approveRequisition({
      itemsTotal: 1000,
      transportationCost: 1200,
      transportationDescription: 'Pickup truck to Gazipur',
    });
    const bom = await generateBom(req.id, req.items);

    const html = renderBomHtml(bom, CONTEXT);

    // The dedicated row class is what marks this as a non-item entry; substring checks would
    // catch the CSS rule too, which is the wrong surface.
    expect(html).toMatch(/<tr class="transportation">/);
    expect(html).toContain('Pickup truck to Gazipur');
    expect(html).toMatch(/1,200\.00/);
    // The header echoes the requisition number so Accounts can trace which source the line
    // belongs to on a batched BOM.
    expect(html).toContain(req.requisitionNo);
  });

  it('PDF subtotal reconciles against the header (items + transportation)', async () => {
    // itemsTotal 1,000 + transportation 200 → both the header "Total Money Requested" and the
    // bottom Subtotal must read 1,200.00. A previous build showed the header right and the
    // bottom wrong because `detail.subtotal` is items-only; this pins the fix.
    const req = await approveRequisition({
      itemsTotal: 1000,
      transportationCost: 200,
      transportationDescription: 'CNG',
    });
    const bom = await generateBom(req.id, req.items);

    const html = renderBomHtml(bom, CONTEXT);

    // The header field is rendered as `Total Money Requested ... BDT 1,200.00`. The bottom
    // Subtotal sits in the tfoot and must carry the same figure — proven by an anchored
    // match around the Subtotal label, so the assertion cannot pass by catching the header
    // figure by accident.
    expect(html).toMatch(/Subtotal[\s\S]{0,80}1,200\.00/);
  });

  it('PDF omits the Transportation row when no cost was set', async () => {
    const req = await approveRequisition({ itemsTotal: 1000 });
    const bom = await generateBom(req.id, req.items);

    const html = renderBomHtml(bom, CONTEXT);

    // The tag, not the bare class name: the `<style>` block declares `tr.transportation`.
    expect(html).not.toMatch(/<tr class="transportation">/);
    // The label "Transportation" only appears inside the row we just excluded.
    expect(html).not.toMatch(/— Transportation/);
  });

  it('PDF truncates a long transportation description to 60 chars', async () => {
    const longDescription =
      'Hired a pickup truck from Mirpur to Gazipur wholesale market via the airport bypass road.';
    expect(longDescription.length).toBeGreaterThan(60);

    const req = await approveRequisition({
      itemsTotal: 1000,
      transportationCost: 1500,
      transportationDescription: longDescription,
    });
    const bom = await generateBom(req.id, req.items);

    const html = renderBomHtml(bom, CONTEXT);

    expect(html).toContain('…');
    // The full text must NOT land on the page — Accounts reads the snapshot for the long form.
    expect(html).not.toContain(longDescription);
  });
});