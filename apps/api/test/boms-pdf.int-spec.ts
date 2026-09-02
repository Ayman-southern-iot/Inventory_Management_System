import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  ErrorCode,
  RequisitionEventType,
  Role,
  type BomDetail,
} from '@ims/shared';
import { AppModule } from '../src/app.module';
import { CONFIG, config } from '../src/config';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { DB } from '../src/database/database.module';
import type { Db } from '../src/database/create-db';
import { PdfRendererService } from '../src/modules/pdf/pdf-renderer.service';
import { renderBomHtml } from '../src/modules/boms/bom-pdf.template';
import { httpClient, nextClientIp, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData, seedSubthresholdApprover , futureDeadline} from './factories';

/**
 * A stand-in signature file id. The template is a pure function of the detail plus the resolved
 * image map, so these tests drive it directly rather than uploading a real signature — that path
 * is covered end to end in `signatures.int-spec.ts`.
 */
const FAKE_FILE_ID = '11111111-2222-3333-4444-555555555555';

/**
 * Phase 04 task 4.3 — BOM PDF template + signed download URL.
 *
 * The renderer is replaced by an in-memory stub at the testing-module level (see
 * `createPdfTestApp`) so the suite stays quick. The stub records every `render` call so an
 * assertion can prove a second `POST /boms/:id/render` did NOT hit Chromium. The template
 * still runs against the real `BomDetail`, so the HTML contract is asserted end-to-end.
 *
 * A real end-to-end test (`real chromium`) is gated by `RUN_PDF_E2E=1` and stays out of the
 * default suite — Chromium cold start is a few seconds, which the suite cannot afford on every
 * `pnpm test:int` invocation.
 */
describe('BOMs PDF', () => {
  interface Actor {
    id: string;
    client: HttpClient;
  }

  const TEST_STORAGE = resolve(process.cwd(), `./storage/pdf-test-${process.pid}`);

  /** Trivial renderer that writes a deterministic 32-byte payload where a PDF would land. */
  class StubRenderer {
    private readonly files = new Map<string, Buffer>();
    readonly renderCalls: Array<{ html: string; orientation: 'portrait' | 'landscape' }> = [];
    readonly letterheadDataUriCalls: number[] = [];
    readonly companyLogoDataUriCalls: number[] = [];

    absolutePathFor(relativePath: string): string {
      const base = TEST_STORAGE;
      const absolute = resolve(join(base, relativePath));
      if (!absolute.startsWith(base)) throw new Error('escape attempt');
      return absolute;
    }

    async render(html: string, orientation: 'portrait' | 'landscape' = 'portrait'): Promise<Buffer> {
      this.renderCalls.push({ html, orientation });
      return Buffer.from(`pdf-bytes:${html.length}:${orientation}`);
    }

    async store(relativePath: string, contents: Buffer): Promise<string> {
      const absolute = this.absolutePathFor(relativePath);
      await mkdir(resolve(absolute, '..'), { recursive: true });
      await writeFile(absolute, contents);
      this.files.set(relativePath, contents);
      return relativePath;
    }

    async read(relativePath: string): Promise<Buffer> {
      const buf = this.files.get(relativePath);
      if (!buf) throw new Error(`missing ${relativePath}`);
      return buf;
    }

    exists(relativePath: string): boolean {
      return this.files.has(relativePath);
    }

    async letterheadDataUri(): Promise<string | null> {
      this.letterheadDataUriCalls.push(1);
      return null;
    }

    /**
     * The stub must implement everything `BomsService` calls on the renderer. Omitting this is
     * what turned the render endpoint into a 500 while the real service was fine — a stub that
     * silently lacks a method is indistinguishable from a broken service.
     */
    async companyLogoDataUri(): Promise<string | null> {
      this.companyLogoDataUriCalls.push(1);
      return null;
    }
  }

  let stub: StubRenderer;

  async function createPdfTestApp(): Promise<TestApp> {
    stub = new StubRenderer();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PdfRendererService)
      .useValue(stub)
      // The document has to show an approved figure that differs from the requested one, so
      // this suite needs revision switched on even though production ships it off.
      .overrideProvider(CONFIG)
      .useValue({
        ...config,
        money: { ...config.money, allowApprovedAmountRevision: true },
      })
      .compile();

    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.setGlobalPrefix(config.http.globalPrefix, { exclude: ['health'] });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.set('trust proxy', 1);

    await app.init();
    return {
      app,
      moduleRef,
      db: app.get<Db>(DB),
      close: async () => {
        await app.close();
      },
    };
  }

  let ctx: TestApp;
  let requester: Actor;
  let im: Actor;
  let approver1: Actor;
  let approver2: Actor;
  let departmentId: string;

  const actorFor = async (roles: Role[]): Promise<Actor> => {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return { id: user.id, client: http.as(session.accessToken) };
  };

  beforeAll(async () => {
    if (existsSync(TEST_STORAGE)) await rm(TEST_STORAGE, { recursive: true, force: true });
    await mkdir(TEST_STORAGE, { recursive: true });
    ctx = await createPdfTestApp();
  });

  afterAll(async () => {
    await ctx.close();
    if (existsSync(TEST_STORAGE)) await rm(TEST_STORAGE, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    stub.renderCalls.length = 0;
    stub.letterheadDataUriCalls.length = 0;

    requester = await actorFor([Role.GENERAL]);
    im = await actorFor([Role.GENERAL, Role.INVENTORY_MANAGER]);
    approver1 = await actorFor([Role.GENERAL, Role.APPROVER]);
    approver2 = await actorFor([Role.GENERAL, Role.APPROVER]);

    const department = await ctx.db
      .insertInto('departments')
      .values({ name: `Dept ${Date.now()}-${Math.random()}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    departmentId = department.id;

    await ctx.db
      .insertInto('approver_slots')
      .values([
        { department_id: null, slot_no: 1, user_id: approver1.id },
        { department_id: null, slot_no: 2, user_id: approver2.id },
      ])
      .execute();

    await seedSubthresholdApprover(ctx, approver1.id);
  });

  /**
   * `approvedAmount` lets a test revise the sanctioned figure down at the approver stage, which
   * is what makes a non-zero "Remaining" (requested − approved) reachable.
   */
  const approveRequisition = async (
    amount: number,
    lineName = 'Widget',
    approvedAmount: number | null = null,
  ) => {
    const created = await requester.client.post('/requisitions').send({
      approvalDeadline: futureDeadline(),
      departmentId,
      urgency: 'NORMAL',
      reason: 'PDF test requisition',
      items: [
        {
          itemName: lineName,
          quantity: 1,
          estimatedUnitPrice: amount,
          productId: null,
          note: 'For the PDF test',
        },
      ],
    });
    expect(created.status).toBe(201);

    const submitted = (
      await requester.client.post(`/requisitions/${created.body.id}/submit`).send()
    ).body;
    const imApprovalId = submitted.approvals.find(
      (a: { stage: string; slot: number }) => a.stage === 'INVENTORY_MANAGER',
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
        .send({ approve: true, ...(approvedAmount === null ? {} : { approvedAmount }) });
    }

    return (
      await requester.client.get(`/requisitions/${created.body.id}`)
    ).body as {
      id: string;
      requisitionNo: string;
      items: Array<{ id: string; itemName: string; quantity: number; estimatedUnitPrice: number }>;
      approvedAmount: number;
      approvals: Array<{
        id: string;
        stage: string;
        slot: number;
        assignedUserName: string;
        assignedUserDesignation: string;
        action: string;
      }>;
    };
  };

  const generatePayload = (
    requisitionId: string,
    items: Array<{ id: string }>,
  ) => ({
    requisitionIds: [requisitionId],
    lines: items.map((item) => ({
      requisitionItemId: item.id,
      unitCost: 250,
      vendor: 'Acme',
    })),
  });

  const generateApprovedBom = async (amount: number): Promise<{ bomId: string; bomNo: string }> => {
    const req = await approveRequisition(amount);
    const created = (
      await im.client.post('/boms').send(generatePayload(req.id, req.items))
    ).body;
    return { bomId: created.id, bomNo: created.bomNo };
  };

  /* --------------------------------------------------------------- render */

  describe('rendering', () => {
    it('renders a PDF, stores it, stamps pdf_generated_at, and returns the updated detail', async () => {
      const { bomId } = await generateApprovedBom(5000);

      const response = await im.client.post(`/boms/${bomId}/render`).send();

      expect(response.status).toBe(200);
      expect(response.body.bom.id).toBe(bomId);
      // The contract collapses the timestamp into `hasPdf` — the row in the DB is the
      // source of truth for the timestamp.
      expect(response.body.bom.hasPdf).toBe(true);

      expect(stub.renderCalls).toHaveLength(1);

      const stored = await ctx.db
        .selectFrom('boms')
        .select(['pdf_path', 'pdf_generated_at'])
        .where('id', '=', bomId)
        .executeTakeFirstOrThrow();
      expect(stored.pdf_path).not.toBeNull();
      expect(stub.exists(stored.pdf_path!)).toBe(true);
      expect(stored.pdf_generated_at).not.toBeNull();
    });

    it('is idempotent: a second render skips Chromium', async () => {
      const { bomId } = await generateApprovedBom(5000);

      await im.client.post(`/boms/${bomId}/render`).send();
      const secondCallCountBefore = stub.renderCalls.length;

      const second = await im.client.post(`/boms/${bomId}/render`).send();
      expect(second.status).toBe(200);
      expect(stub.renderCalls.length).toBe(secondCallCountBefore); // no new render call
    });

    it('renders a BOM that spends the approved amount to the last taka', async () => {
      // Was "renders an over-budget BOM": the 2026-08-09 retirement of the ceiling made an
      // over-budget BOM creatable, so rendering one was worth asserting. The ceiling came back
      // on 2026-08-29 (Ayman's ruling) and such a BOM can no longer exist, so the premise is
      // gone. What the test was actually for — a BOM at the very edge of its budget still
      // renders — is kept, at the boundary the new rule cares about.
      const req = await approveRequisition(5000, 'AtCeiling');
      const create = await im.client.post('/boms').send({
        requisitionIds: [req.id],
        lines: req.items.map((item) => ({
          requisitionItemId: item.id,
          unitCost: 5000,
          vendor: 'Acme',
        })),
      });
      expect(create.status).toBe(201);
      expect(create.body.overBudgetBounced).toBe(false);
      expect(create.body.subtotal).toBe(5000);

      const render = await im.client.post(`/boms/${create.body.id}/render`).send();
      expect(render.status).toBe(200);
      expect(stub.renderCalls).toHaveLength(1);
    });

    it('forbids anyone but IM / Admin', async () => {
      const { bomId } = await generateApprovedBom(5000);

      const denied = await requester.client.post(`/boms/${bomId}/render`).send();
      expect(denied.status).toBe(403);
      expect(stub.renderCalls).toHaveLength(0);
    });
  });

  /* --------------------------------------------------------- HTML contract */

  describe('HTML template', () => {
    /** Minimal render context; individual tests override what they are asserting on. */
    const CONTEXT = {
      company: {
        name: 'Southern IoT',
        addressLines: ['House 26, Road 13, Sector 14', 'Uttara, Dhaka - 1230', 'Bangladesh'],
        logoUri: null,
      },
      signatureUris: {},
    };

    it('prints the letterhead: company name and every address line', async () => {
      const req = await approveRequisition(5000, 'Widget');
      const bom = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body as BomDetail;

      const html = renderBomHtml(bom, CONTEXT);

      expect(html).toContain('Southern IoT');
      expect(html).toContain('House 26, Road 13, Sector 14');
      expect(html).toContain('Uttara, Dhaka - 1230');
      expect(html).toContain('Bangladesh');
    });

    it('embeds the logo as a data URI when one is configured', async () => {
      const req = await approveRequisition(5000);
      const bom = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body as BomDetail;

      const html = renderBomHtml(bom, {
        ...CONTEXT,
        company: { ...CONTEXT.company, logoUri: 'data:image/jpeg;base64,AAAA' },
      });

      expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
    });

    it('prints the header fields, the item table and a subtotal', async () => {
      const req = await approveRequisition(5000, 'Widget');
      const bom = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body as BomDetail;

      const html = renderBomHtml(bom, CONTEXT);

      for (const label of [
        'BOM Number',
        'Requisition From',
        'Date',
        'Department',
        'Project',
        'Description',
        'Approved amount',
      ]) {
        expect(html, `header is missing "${label}"`).toContain(label);
      }

      // One money figure, and it is the payable one (Ayman, 2026-08-29). The requested and
      // remaining amounts moved off the document entirely — see the note on the Remaining
      // test below for what they were for and where they still live.
      expect(html).not.toContain('Total Money Requested');
      expect(html).not.toContain('Remaining');

      expect(html).toContain(bom.bomNo);
      expect(html).toContain('Widget');
      expect(html).toContain('5,000.00');
      // Either the ICU literal `BDT` or the `৳` glyph, depending on the Node build's locale data.
      expect(html).toMatch(/BDT|৳/);
      expect(html).toMatch(/<table class="items">/);
      expect(html).toContain('Subtotal');

      // The congested first draft is gone: no per-line vendor/purpose/project, no footprints
      // table. This is what "clean and standard" means, so it is asserted rather than assumed.
      expect(html).not.toMatch(/<table class="lines">/);
      expect(html).not.toMatch(/<table class="footprints">/);
    });

    /**
     * Was "prints Remaining as requested minus approved" (OQ-18).
     *
     * Reversed by Ayman on 2026-08-29: "bom will only show the approved money so that no
     * confusion will occur". OQ-18 was reasoning about somebody auditing the approval; this
     * document goes to Accounts to be paid against, and three figures where one is payable
     * invites the wrong one being read. The requested and remaining amounts are still computed
     * and still on the requisition — they have left the printed BOM, not the system.
     *
     * The figures stay **below** SETTING_EXPENSE_THRESHOLD_BDT (15,000) on purpose: at or above
     * it the chain needs two approvers in two slots, and `approveRequisition` drives only
     * approver1.
     */
    it('prints only the approved amount, not the requested or the remainder', async () => {
      const req = await approveRequisition(12_000, 'Widget', 8_000);
      const bom = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body as BomDetail;

      // The snapshot still carries all three — the document simply prints one of them.
      expect(bom.sources[0]!.requestedAmount).toBe(12_000);
      expect(bom.sources[0]!.approvedAmount).toBe(8_000);
      expect(bom.sources[0]!.remainingAmount).toBe(4_000);

      const html = renderBomHtml(bom, CONTEXT);
      expect(html).toMatch(/Approved amount[\s\S]{0,80}8,000\.00/);
      expect(html).not.toContain('12,000.00');
      expect(html).not.toContain('4,000.00');
    });

    it('prints the name and "Approved" for every approver, signed or not', async () => {
      const req = await approveRequisition(5000);
      const bom = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body as BomDetail;

      const html = renderBomHtml(bom, CONTEXT);

      expect(html).toMatch(/<section class="signatures">/);
      // Nobody signed in this fixture, so no image — but the block still says Approved.
      expect(html).toContain('Approved');
      // Matches the tag, not the bare class name: the `<style>` block declares
      // `.signature-image`, so a substring check would always find it.
      expect(html).not.toMatch(/<img class="signature-image"/);
      for (const footprint of bom.sources[0]!.footprints) {
        expect(html).toContain(footprint.name);
      }
    });

    it('places the signature image only where the approval was actually signed', async () => {
      const req = await approveRequisition(5000);
      const bom = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body as BomDetail;

      // Simulate one signed footprint against a supplied image.
      const signed: BomDetail = {
        ...bom,
        sources: bom.sources.map((source, index) =>
          index === 0
            ? {
                ...source,
                footprints: source.footprints.map((footprint, i) =>
                  i === 0
                    ? { ...footprint, signedWithSignature: true, signatureFileId: FAKE_FILE_ID }
                    : footprint,
                ),
              }
            : source,
        ),
      };

      const html = renderBomHtml(signed, {
        ...CONTEXT,
        signatureUris: { [FAKE_FILE_ID]: 'data:image/png;base64,BBBB' },
      });

      expect(html).toContain('data:image/png;base64,BBBB');
      // Exactly one image tag, not one per approver. Counts tags, not the CSS declaration.
      expect(html.match(/<img class="signature-image"/g)).toHaveLength(1);
    });

    it('falls back to a blank signature line when the image cannot be resolved', async () => {
      const req = await approveRequisition(5000);
      const bom = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body as BomDetail;

      const claimsSigned: BomDetail = {
        ...bom,
        sources: bom.sources.map((source) => ({
          ...source,
          footprints: source.footprints.map((footprint) => ({
            ...footprint,
            signedWithSignature: true,
            signatureFileId: FAKE_FILE_ID,
          })),
        })),
      };

      // Empty signatureUris — the file was unreadable. A document with a blank line is still
      // usable; a broken image tag is not.
      const html = renderBomHtml(claimsSigned, CONTEXT);
      expect(html).not.toMatch(/<img class="signature-image"/);
      expect(html).toContain('Approved');
    });

    it('reads footprints from the snapshot, not live users', async () => {
      const req = await approveRequisition(5000);
      const generated = (
        await im.client.post('/boms').send(generatePayload(req.id, req.items))
      ).body as BomDetail;

      // Rename the IM out of the snapshot.
      await ctx.db
        .updateTable('users')
        .set({ full_name: 'Renamed Iam', designation: 'Renamed Designation' })
        .where('id', '=', im.id)
        .execute();

      const html = renderBomHtml(generated, CONTEXT);
      expect(html).toContain('Test'); // factory-name prefix
      expect(html).not.toContain('Renamed');
    });
  });

  /* --------------------------------------------------------- signed URL */

  describe('signed download URL', () => {
    it('returns a relative URL bound to the BOM, with TTL', async () => {
      const { bomId, bomNo } = await generateApprovedBom(5000);
      await im.client.post(`/boms/${bomId}/render`).send();

      const response = await im.client.get(`/boms/${bomId}/pdf-url`).send();
      expect(response.status).toBe(200);
      // The URL is a *relative* path under the API prefix, with a `token=` query param.
      expect(response.body.url.startsWith(`/api/v1/boms/${bomId}/pdf?token=`)).toBe(true);
      // The token itself is appended with at least one character.
      const token = response.body.url.split('token=')[1];
      expect(token.length).toBeGreaterThan(20);
      expect(token).toContain('.');
      expect(response.body.expiresAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(response.body.ttlSeconds).toBeGreaterThan(0);
      expect(bomNo).toBeTruthy();
    });

    it('serves the stored PDF with the right Content-Type when the token is valid', async () => {
      const { bomId } = await generateApprovedBom(5000);
      await im.client.post(`/boms/${bomId}/render`).send();
      const { url } = (await im.client.get(`/boms/${bomId}/pdf-url`).send()).body as {
        url: string;
      };

      // Public download — no Authorization header.
      const anonIp = nextClientIp();
      const response = await request(ctx.app.getHttpServer())
        .get(url)
        .set('X-Forwarded-For', anonIp);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toBe('inline');
      // Body is the bytes the stub renderer returned.
      const body = response.body as Buffer;
      expect(body.length).toBeGreaterThan(0);
      expect(body.toString('utf8')).toContain('pdf-bytes:');
    });

    it('rejects a tampered token with 403 PDF_DOWNLOAD_TOKEN_INVALID', async () => {
      const { bomId } = await generateApprovedBom(5000);
      await im.client.post(`/boms/${bomId}/render`).send();

      const anonIp = nextClientIp();
      const response = await request(ctx.app.getHttpServer())
        .get(`/api/v1/boms/${bomId}/pdf?token=tampered.token`)
        .set('X-Forwarded-For', anonIp);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ErrorCode.PDF_DOWNLOAD_TOKEN_INVALID);
    });

    it('rejects a token issued for a different BOM with 403', async () => {
      const a = await generateApprovedBom(5000);
      const b = await generateApprovedBom(5000);
      await im.client.post(`/boms/${a.bomId}/render`).send();
      await im.client.post(`/boms/${b.bomId}/render`).send();

      // Sign for A but fetch B.
      const { url } = (await im.client.get(`/boms/${a.bomId}/pdf-url`).send()).body as {
        url: string;
      };

      const anonIp = nextClientIp();
      const mismatched = url.replace(`/boms/${a.bomId}/pdf`, `/boms/${b.bomId}/pdf`);
      const response = await request(ctx.app.getHttpServer())
        .get(mismatched)
        .set('X-Forwarded-For', anonIp);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ErrorCode.PDF_DOWNLOAD_TOKEN_INVALID);
    });

    it('returns 404 once the BOM is voided and its file is unlinked', async () => {
      const { bomId } = await generateApprovedBom(5000);
      await im.client.post(`/boms/${bomId}/render`).send();
      const { url } = (await im.client.get(`/boms/${bomId}/pdf-url`).send()).body as {
        url: string;
      };
      const voided = await im.client
        .post(`/boms/${bomId}/void`)
        .send({ reason: 'duplicate PDF test' });
      expect(voided.status).toBe(200);

      const anonIp = nextClientIp();
      const response = await request(ctx.app.getHttpServer())
        .get(url)
        .set('X-Forwarded-For', anonIp);

      expect(response.status).toBe(404);
    });

    it('returns 404 when the cached file was deleted out-of-band', async () => {
      const { bomId } = await generateApprovedBom(5000);
      await im.client.post(`/boms/${bomId}/render`).send();
      const { url } = (await im.client.get(`/boms/${bomId}/pdf-url`).send()).body as {
        url: string;
      };

      // Wipe both the on-disk file *and* the stub's in-memory tracker — the latter is what
      // `exists()` consults, so leaving it populated would still answer "yes" and the 404
      // contract would never trip.
      const stored = await ctx.db
        .selectFrom('boms')
        .select(['pdf_path'])
        .where('id', '=', bomId)
        .executeTakeFirstOrThrow();
      expect(stored.pdf_path).not.toBeNull();
      const relative = stored.pdf_path!;
      try {
        await rm(stub.absolutePathFor(relative));
      } catch {
        // The file may not exist if a prior test already wiped it; that's fine — we are
        // simulating an out-of-band delete, and either side covers the contract.
      }
      // Force the stub's `exists()` to answer false too.
      (stub as unknown as { files: Map<string, Buffer> }).files.delete(relative);

      const anonIp = nextClientIp();
      const response = await request(ctx.app.getHttpServer())
        .get(url)
        .set('X-Forwarded-For', anonIp);

      expect(response.status).toBe(404);
    });
  });

  /* ------------------------------------------------------- appended event */

  describe('audit trail', () => {
    it('appends a BOM_RENDERED event on each source requisition', async () => {
      const { bomId } = await generateApprovedBom(5000);
      const detail = (
        await im.client.post(`/boms/${bomId}/render`).send()
      ).body.bom as BomDetail;

      for (const source of detail.sources) {
        const reqDetail = (await requester.client.get(`/requisitions/${source.requisitionId}`)).body;
        const events = reqDetail.events.map((e: { eventType: string }) => e.eventType);
        expect(events).toContain(RequisitionEventType.BOM_RENDERED);
      }
    });
  });
});
