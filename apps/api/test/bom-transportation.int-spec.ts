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
import { createUser, login, resetData, seedSubthresholdApprover , futureDeadline} from './factories';

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
  /** A second requester, for the one-requester-per-BOM guard. */
  let otherRequester: Actor;
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

    otherRequester = await actorFor([Role.GENERAL]);
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
  }) => approveRequisitionAs(requester, options);

  /** The same walk, raised by whichever requester the caller names. */
  const approveRequisitionAs = async (
    raisedBy: Actor,
    options: {
      itemsTotal: number;
      transportationCost?: number;
      transportationDescription?: string;
    },
  ) => {
    const { itemsTotal, transportationCost = 0, transportationDescription = null } = options;
    const transportationBody =
      transportationCost > 0
        ? { transportationCost, transportationDescription }
        : {};

    const created = await raisedBy.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
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

    const submitted = (await raisedBy.client.post(`/requisitions/${created.body.id}/submit`).send())
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

    return (await raisedBy.client.get(`/requisitions/${created.body.id}`)).body as {
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

  /* ------------------------------------------------------------- pagination */

  /**
   * A BOM with more items than fit a page.
   *
   * Ayman, 2026-09-01: "if item is too many then it will auto go to next page, no need to be
   * congested in one page". Chromium will always break a long table somewhere; left alone it
   * breaks rows through the middle and never repeats the column headings, so page three of a
   * document somebody pays against is a wall of unlabelled numbers.
   *
   * Asserted on the rules rather than on a rendered page count: the page size and margins come
   * from config (`PDF_PAGE_FORMAT`, `PDF_MARGIN_*_MM`), so how many rows reach page two is an
   * operator setting, while whether a row may be split is a property of this document.
   */
  it('carries its column headings onto every page and never splits a row', async () => {
    const req = await approveRequisition({ itemsTotal: 4_000 });
    const bom = (
      await im.client.post(`/boms`).send({
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 250, vendor: 'Acme' }],
      })
    ).body;

    const html = renderBomHtml(bom, CONTEXT);

    // The heading row repeats on continuation pages.
    expect(html).toMatch(/thead\s*\{\s*display:\s*table-header-group/);
    // An item is never cut in half across the fold.
    expect(html).toMatch(/tr\s*\{[^}]*page-break-inside:\s*avoid/);
    // ...while the table itself is allowed to flow onto as many pages as it needs.
    expect(html).toMatch(/table\.items\s*\{\s*page-break-inside:\s*auto/);
  });

  it('keeps the blocks that are meaningless in halves whole', async () => {
    const req = await approveRequisition({ itemsTotal: 1_000 });
    const bom = (
      await im.client.post(`/boms`).send({
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 250, vendor: 'Acme' }],
      })
    ).body;

    const html = renderBomHtml(bom, CONTEXT);

    // Half a signature block reads as a document that was tampered with; half an approved
    // amount reads as a different number.
    for (const block of [
      'section.signatures',
      '.signature-cell',
      '.approved-summary',
      '.desc-block',
      'header.letterhead',
    ]) {
      expect(html, `${block} may be split across a page`).toContain(block);
    }
    expect(html).toMatch(/footer\s*\{\s*page-break-inside:\s*avoid/);
  });

  /** No `@page` rule here: margins are an operator setting, and two sources would fight. */
  it('leaves the page margins to the renderer config', async () => {
    const req = await approveRequisition({ itemsTotal: 1_000 });
    const bom = (
      await im.client.post(`/boms`).send({
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 250, vendor: 'Acme' }],
      })
    ).body;

    expect(renderBomHtml(bom, CONTEXT)).not.toContain('@page');
  });

  /* ------------------------------------------------------ the printed document */

  describe('the BOM document', () => {
    /**
     * The total, restated in words.
     *
     * This is what Accounts pays against. Digits on a printout can be altered with a pen and a
     * misplaced comma is invisible; the words are here to disagree loudly when either happens.
     */
    it('prints the grand total in words, carriage included', async () => {
      const req = await approveRequisition({
        itemsTotal: 1_000,
        transportationCost: 500,
        transportationDescription: 'Van hire',
      });
      const bom = (
        await im.client.post(`/boms`).send({
          requisitionIds: [req.id],
          lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 250, vendor: 'Acme' }],
        })
      ).body;

      const html = renderBomHtml(bom, CONTEXT);

      // 1,000 of items plus the 500 van. The words restate the grand total, not the subtotal —
      // restating only the items would put a smaller number in words directly beneath a larger
      // one in digits, which is worse than printing no words at all.
      expect(html).toContain('Taka One Thousand Five Hundred Only');
      expect(html).toMatch(/In words:/);
    });

    it('prints the words on a BOM with no carriage too', async () => {
      const req = await approveRequisition({ itemsTotal: 4_000 });
      const bom = (
        await im.client.post(`/boms`).send({
          requisitionIds: [req.id],
          lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 1_000, vendor: 'Acme' }],
        })
      ).body;

      const html = renderBomHtml(bom, CONTEXT);

      expect(html).toContain('Taka Four Thousand Only');
    });

    /**
     * The letterhead. `COMPANY_LOGO_PATH` already resolves and inlines the file as a data URI —
     * this asserts the template actually places it, so a configured logo cannot silently fail to
     * reach the page.
     */
    it('places the company logo on the letterhead when one is configured', async () => {
      const req = await approveRequisition({ itemsTotal: 1_000 });
      const bom = (
        await im.client.post(`/boms`).send({
          requisitionIds: [req.id],
          lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 250, vendor: 'Acme' }],
        })
      ).body;

      const withLogo = renderBomHtml(bom, {
        ...CONTEXT,
        company: { ...CONTEXT.company, logoUri: 'data:image/jpeg;base64,AAAA' },
      });

      expect(withLogo).toContain('<img class="logo" src="data:image/jpeg;base64,AAAA"');
      // And no broken image element when there is none to place.
      expect(renderBomHtml(bom, CONTEXT)).not.toContain('<img class="logo"');
    });
  });

  /* --------------------------------------------------------- document numbers */

  /**
   * `REQ-000015-GINA` and `BOM-000004-GINA`. Ayman's ruling, 2026-08-29: the number says whose
   * it is, so a stack of printouts sorts by hand without opening any of them.
   *
   * The serial is the identity and the name is decoration — two people called Gina still get
   * different numbers. Rows created before the change keep their plain form, which is why
   * nothing here asserts that *every* number has a suffix.
   */
  describe('document numbers carry the requester', () => {
    it('names the requester on the requisition and on its BOM', async () => {
      const req = await approveRequisition({ itemsTotal: 1_000 });

      // The requester fixture is created by `createUser`, so assert the shape rather than a
      // specific name: serial, then a dash, then an all-caps Latin token.
      expect(req.requisitionNo).toMatch(/^REQ-\d{6}-[A-Z0-9]+$/);

      const bom = await im.client.post(`/boms`).send({
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 250, vendor: 'Acme' }],
      });
      expect(bom.status).toBe(201);
      expect(bom.body.bomNo).toMatch(/^BOM-\d{6}-[A-Z0-9]+$/);

      // Same person, so the same token on both documents — that is the point of putting it
      // there at all.
      const reqToken = req.requisitionNo.split('-')[2];
      const bomToken = (bom.body.bomNo as string).split('-')[2];
      expect(bomToken).toBe(reqToken);
    });

    /**
     * The guard that makes the BOM number honest. Without it a batched BOM would be named after
     * whichever requester the query returned first — a printed, filed claim about whose money
     * this is, pointing at the wrong person.
     */
    it('refuses a BOM covering two requesters', async () => {
      const mine = await approveRequisition({ itemsTotal: 1_000 });
      const theirs = await approveRequisitionAs(otherRequester, { itemsTotal: 1_000 });

      const response = await im.client.post(`/boms`).send({
        requisitionIds: [mine.id, theirs.id],
        lines: [
          { requisitionItemId: mine.items[0]!.id, unitCost: 250, vendor: 'Acme' },
          { requisitionItemId: theirs.items[0]!.id, unitCost: 250, vendor: 'Acme' },
        ],
      });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('BOM_SPANS_MULTIPLE_REQUESTERS');
      // Grouped by requester, named by requisition: two fixture users can share a display
      // name, and the requisition numbers are what the IM actually un-ticks.
      expect(response.body.details.groups).toHaveLength(2);
      const listed = response.body.details.groups.flatMap(
        (group: { requisitionNos: string[] }) => group.requisitionNos,
      );
      expect(listed).toContain(mine.requisitionNo);
      expect(listed).toContain(theirs.requisitionNo);
    });

    it('still batches several requisitions from the same requester', async () => {
      const first = await approveRequisition({ itemsTotal: 1_000 });
      const second = await approveRequisition({ itemsTotal: 1_000 });

      const response = await im.client.post(`/boms`).send({
        requisitionIds: [first.id, second.id],
        lines: [
          { requisitionItemId: first.items[0]!.id, unitCost: 250, vendor: 'Acme' },
          { requisitionItemId: second.items[0]!.id, unitCost: 250, vendor: 'Acme' },
        ],
      });

      expect(response.status).toBe(201);
    });
  });

  /* ------------------------------------------------- the approved-amount ceiling */

  /**
   * Ayman's ruling, 2026-08-29. A BOM may not commit more than the requisition was approved
   * for, and the transportation counts towards that ceiling because the approved figure already
   * includes it (`requested = items + carriage` at submit).
   *
   * The IM reaches the ceiling by adjusting quantity and unit cost until the BOM fits — that is
   * the whole purpose of the builder — and only then may it be generated. Nothing downstream can
   * absorb an overspend: Accounts funds against the approved figure, so a BOM above it commits
   * money nobody sanctioned and the shortfall surfaces at purchase time with the goods ordered.
   */
  describe('a BOM cannot commit more than was approved', () => {
    it('refuses when the items alone exceed the approved amount', async () => {
      // 4,000 of items, no carriage, approved at 4,000. Buying at 1,500 a unit is 6,000.
      const req = await approveRequisition({ itemsTotal: 4_000 });

      const response = await im.client.post(`/boms`).send({
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 1_500, vendor: 'Acme' }],
      });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('BOM_EXCEEDS_APPROVED_AMOUNT');
      const overspent = response.body.details.overspent[0];
      expect(overspent.requisitionNo).toBe(req.requisitionNo);
      expect(overspent.approved).toBe(4_000);
      expect(overspent.committed).toBe(6_000);
    });

    /**
     * The trap this rule exists to close, and the one QA-019 found on the builder: a BOM whose
     * *items* fit exactly, on a requisition that also has to pay for a van. The old comparison
     * read the item total against an approved figure that already contained the carriage, so it
     * reported room that was never there.
     */
    it('counts the transportation against the ceiling, not just the items', async () => {
      // Items 1,000 + carriage 500 = approved 1,500. Items alone at 1,500 fit the approved
      // figure exactly — and commit 2,000 once the van is paid for.
      const req = await approveRequisition({
        itemsTotal: 1_000,
        transportationCost: 500,
        transportationDescription: 'Van hire',
      });
      expect(req.approvedAmount).toBe(1_500);

      const response = await im.client.post(`/boms`).send({
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 375, vendor: 'Acme' }],
      });

      expect(response.status).toBe(409);
      const overspent = response.body.details.overspent[0];
      expect(overspent.items).toBe(1_500);
      expect(overspent.transportation).toBe(500);
      expect(overspent.committed).toBe(2_000);
      expect(overspent.approved).toBe(1_500);
    });

    it('allows a BOM the IM has adjusted to fit exactly, carriage included', async () => {
      const req = await approveRequisition({
        itemsTotal: 1_000,
        transportationCost: 500,
        transportationDescription: 'Van hire',
      });

      // Four units at 250 is 1,000 of items; plus the 500 van that is exactly the 1,500
      // approved. Equal to the ceiling is inside it.
      const response = await im.client.post(`/boms`).send({
        requisitionIds: [req.id],
        lines: [{ requisitionItemId: req.items[0]!.id, unitCost: 250, vendor: 'Acme' }],
      });

      expect(response.status).toBe(201);
    });

    it('lets a smaller quantity bring an over-priced line back inside the ceiling', async () => {
      const req = await approveRequisition({ itemsTotal: 4_000 });

      // 1,500 a unit is over at four units (6,000) and inside at two (3,000). Adjusting the
      // quantity is the other half of what the builder is for.
      const response = await im.client.post(`/boms`).send({
        requisitionIds: [req.id],
        lines: [
          { requisitionItemId: req.items[0]!.id, quantity: 2, unitCost: 1_500, vendor: 'Acme' },
        ],
      });

      expect(response.status).toBe(201);
    });
  });

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
    // The label is now just "Transportation" — the REQ-XXXX prefix was dropped because the
    // source requisition is already in the header block immediately above. The cell carries
    // a `colspan` before the class, so the match tolerates attributes in any order.
    expect(html).toMatch(
      /<td[^>]*class="transportation-source"[^>]*>\s*Transportation\s*<\/td>/,
    );
    expect(html).toContain('Pickup truck to Gazipur');
    expect(html).toMatch(/1,200\.00/);
    // The requisition number itself lives in the BOM list endpoint, not the PDF — the PDF
    // header block carries the requester, department and project, but the row itself just
    // says "Transportation". On a batched BOM the dedup was confusing anyway.
  });

  it('PDF subtotal reconciles against the header (items + transportation)', async () => {
    // itemsTotal 1,000 + transportation 200. The header now prints only the approved amount
    // (Ayman, 2026-08-29), which is also 1,200 here since nothing was revised down — so the
    // reconciliation is between that single header figure and the Grand total. The breakdown
    // prints three tfoot rows when transportation exists: Items subtotal (1,000.00) /
    // Transportation / Grand total (1,200.00). Each label is anchored, so the assertion cannot
    // pass by catching the header figure by accident.
    const req = await approveRequisition({
      itemsTotal: 1000,
      transportationCost: 200,
      transportationDescription: 'CNG',
    });
    const bom = await generateBom(req.id, req.items);

    const html = renderBomHtml(bom, CONTEXT);

    expect(html).toMatch(/Items subtotal[\s\S]{0,80}1,000\.00/);
    expect(html).toMatch(/Grand total[\s\S]{0,80}1,200\.00/);
  });

  it('PDF omits the Transportation row when no cost was set', async () => {
    const req = await approveRequisition({ itemsTotal: 1000 });
    const bom = await generateBom(req.id, req.items);

    const html = renderBomHtml(bom, CONTEXT);

    // The tag, not the bare class name: the `<style>` block declares `tr.transportation`.
    expect(html).not.toMatch(/<tr class="transportation">/);
    // The "Transportation" label only appears inside the row we just excluded, and the
    // em-dash-prefixed form was retired on 2026-08-10. The cell carries a `colspan` before
    // the class, so the negative match tolerates attributes in any order.
    expect(html).not.toMatch(/— Transportation/);
    expect(html).not.toMatch(
      /<td[^>]*class="transportation-source"[^>]*>\s*Transportation\s*<\/td>/,
    );
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