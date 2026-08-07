import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalAction, ApprovalStage, ErrorCode, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';

interface Actor {
  id: string;
  client: HttpClient;
}

const PDF_HEADER = Buffer.from('%PDF-1.4\n%fake-but-plausible-bytes\n');

/**
 * Supporting documents on a requisition.
 *
 * The contract here is intentionally small: a requester can attach (and replace) one optional
 * PDF/PNG/JPEG while the requisition is DRAFT, and the requester / IM / Admin / any approver
 * assigned to that requisition can open it. The frozen-at-submit rule is the same one the
 * amount figures follow.
 */
describe('requisition supporting document', () => {
  let ctx: TestApp;
  let requester: Actor;
  let im: Actor;
  let approver1: Actor;
  let approver2: Actor;
  let otherRequester: Actor;

  const actorFor = async (roles: Role[]): Promise<Actor> => {
    const user = await createUser(ctx.db, { roles });
    const http = httpClient(ctx.app);
    const session = await login(http, user.email);
    return { id: user.id, client: http.as(session.accessToken) };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    requester = await actorFor([Role.GENERAL]);
    im = await actorFor([Role.GENERAL, Role.INVENTORY_MANAGER]);
    approver1 = await actorFor([Role.GENERAL, Role.APPROVER]);
    approver2 = await actorFor([Role.GENERAL, Role.APPROVER]);
    otherRequester = await actorFor([Role.GENERAL]);
  });

  const draft = async (author: Actor = requester) =>
    author.client.post('/requisitions').send({
      urgency: 'NORMAL',
      reason: 'With a quote sheet',
      items: [
        { itemName: 'Cable', quantity: 4, estimatedUnitPrice: 250, productId: null, note: null },
      ],
    });

  /**
   * The DRAFT → AWAITING_APPROVAL transition requires an IM row and submit figures frozen on
   * the requisition. Rather than exercise the whole submit pipeline (which depends on settings
   * and slots not under test here) we set the status and seed an approval row directly —
   * exactly the shape `submit` would produce, minus the machinery that's already covered by
   * `requisitions.int-spec.ts`.
   */
  const seedSubmitted = async (id: string, assignedApprover: Actor) => {
    // The `requisitions_submit_figures_together` check (migration 0022) refuses a row with
    // `submitted_at` set but the other three figures NULL, so the set has to carry all four.
    await ctx.db
      .updateTable('requisitions')
      .set({
        status: 'AWAITING_APPROVAL',
        submitted_at: new Date(),
        requested_amount: '1000',
        approved_amount: '1000',
        required_approver_count: 1,
        threshold_at_submit: '15000',
      })
      .where('id', '=', id)
      .execute();
    await ctx.db
      .insertInto('requisition_approvals')
      .values([
        {
          requisition_id: id,
          stage: ApprovalStage.INVENTORY_MANAGER,
          slot: 1,
          assigned_user_id: im.id,
          action: ApprovalAction.APPROVED,
          acted_by_user_id: im.id,
          acted_at: new Date(),
        },
        {
          requisition_id: id,
          stage: ApprovalStage.APPROVER,
          slot: 1,
          assigned_user_id: assignedApprover.id,
          action: ApprovalAction.PENDING,
        },
      ])
      .execute();
  };

  /* ------------------------------------------------- happy path */

  it('attaches a PDF on a DRAFT and exposes it on the detail', async () => {
    const created = await draft();
    const id = created.body.id;

    const uploaded = await requester.client
      .post(`/requisitions/${id}/supporting-document`)
      .attach('file', PDF_HEADER, 'quote.pdf');
    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toMatchObject({
      originalName: 'quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF_HEADER.length,
    });

    // A stored_files row exists with the right kind.
    const stored = await ctx.db
      .selectFrom('stored_files')
      .where('id', '=', uploaded.body.fileId)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(stored.kind).toBe('SUPPORTING_DOCUMENT');

    // The FK on the requisition row points at it.
    const req = await ctx.db
      .selectFrom('requisitions')
      .where('id', '=', id)
      .select(['supporting_document_file_id'])
      .executeTakeFirstOrThrow();
    expect(req.supporting_document_file_id).toBe(uploaded.body.fileId);

    // And the detail endpoint carries both the metadata and the URL.
    const detail = await requester.client.get(`/requisitions/${id}`);
    expect(detail.body.supportingDocument).toMatchObject({
      originalName: 'quote.pdf',
      mimeType: 'application/pdf',
    });
    expect(detail.body.supportingDocumentUrl).toBe(`/api/v1/requisitions/${id}/supporting-document`);

    // And the requester can download the bytes back.
    const download = await requester.client.get(`/requisitions/${id}/supporting-document`);
    expect(download.status).toBe(200);
    expect(download.body).toEqual(PDF_HEADER);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['content-disposition']).toContain('inline');
  });

  /* ---------------------------------------------------- gate: status */

  it('refuses to attach after the requisition is submitted', async () => {
    const created = await draft();
    await seedSubmitted(created.body.id, approver1);

    const uploaded = await requester.client
      .post(`/requisitions/${created.body.id}/supporting-document`)
      .attach('file', PDF_HEADER, 'quote.pdf');
    expect(uploaded.status).toBe(409);
    expect(uploaded.body.code).toBe(ErrorCode.REQUISITION_INVALID_TRANSITION);
  });

  it('refuses to remove after the requisition is submitted', async () => {
    const created = await draft();
    // Attach first so the row has an FK to clear.
    await requester.client
      .post(`/requisitions/${created.body.id}/supporting-document`)
      .attach('file', PDF_HEADER, 'quote.pdf');
    await seedSubmitted(created.body.id, approver1);

    const removed = await requester.client.delete(
      `/requisitions/${created.body.id}/supporting-document`,
    );
    expect(removed.status).toBe(409);
  });

  /* ---------------------------------------------------- gate: actor */

  it('refuses a non-requester user from attaching', async () => {
    const created = await draft();
    const uploaded = await im.client
      .post(`/requisitions/${created.body.id}/supporting-document`)
      .attach('file', PDF_HEADER, 'quote.pdf');
    expect(uploaded.status).toBe(403);
  });

  it('refuses a different requester from attaching', async () => {
    const created = await draft();
    const uploaded = await otherRequester.client
      .post(`/requisitions/${created.body.id}/supporting-document`)
      .attach('file', PDF_HEADER, 'quote.pdf');
    expect(uploaded.status).toBe(403);
  });

  /* ---------------------------------------------------- file checks */

  it('rejects something that is not a real document', async () => {
    const created = await draft();
    // Named .pdf, but the magic bytes say otherwise.
    const uploaded = await requester.client
      .post(`/requisitions/${created.body.id}/supporting-document`)
      .attach('file', Buffer.from('<svg onload=alert(1)>'), 'quote.pdf');
    expect(uploaded.status).toBe(400);
  });

  it('rejects an oversize upload at the interceptor', async () => {
    const created = await draft();
    // The default cap is 10 MB; crossing it has to be the only thing that rejects this upload,
    // so the magic bytes still have to be a valid PDF and the payload goes past the cap.
    const oversized = Buffer.concat([PDF_HEADER, Buffer.alloc(11 * 1024 * 1024, 0)]);
    const uploaded = await requester.client
      .post(`/requisitions/${created.body.id}/supporting-document`)
      .attach('file', oversized, 'quote.pdf');
    // multer rejects oversize uploads with a 413 Payload Too Large.
    expect(uploaded.status).toBe(413);
  });

  /* -------------------------------------------------- replace / remove */

  it('replaces by inserting a new stored_files row and repointing the FK', async () => {
    const created = await draft();
    const id = created.body.id;

    const first = await requester.client
      .post(`/requisitions/${id}/supporting-document`)
      .attach('file', Buffer.from('%PDF-1.4 first'), 'first.pdf');
    const second = await requester.client
      .post(`/requisitions/${id}/supporting-document`)
      .attach('file', Buffer.from('%PDF-1.4 second-and-longer'), 'second.pdf');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.fileId).not.toBe(second.body.fileId);

    // Both rows still exist (insert-only — the old one is what the audit trail points to).
    const all = await ctx.db
      .selectFrom('stored_files')
      .where('id', 'in', [first.body.fileId, second.body.fileId])
      .select(['id', 'kind'])
      .execute();
    expect(all).toHaveLength(2);
    expect(all.every((row) => row.kind === 'SUPPORTING_DOCUMENT')).toBe(true);

    // The FK on the requisition now points at the new one.
    const req = await ctx.db
      .selectFrom('requisitions')
      .where('id', '=', id)
      .select(['supporting_document_file_id'])
      .executeTakeFirstOrThrow();
    expect(req.supporting_document_file_id).toBe(second.body.fileId);
  });

  it('removes the pointer but keeps the stored_files row', async () => {
    const created = await draft();
    const id = created.body.id;
    const uploaded = await requester.client
      .post(`/requisitions/${id}/supporting-document`)
      .attach('file', PDF_HEADER, 'quote.pdf');
    const fileId = uploaded.body.fileId;

    const removed = await requester.client.delete(`/requisitions/${id}/supporting-document`);
    expect(removed.status).toBe(204);

    const req = await ctx.db
      .selectFrom('requisitions')
      .where('id', '=', id)
      .select(['supporting_document_file_id'])
      .executeTakeFirstOrThrow();
    expect(req.supporting_document_file_id).toBeNull();

    const stored = await ctx.db
      .selectFrom('stored_files')
      .where('id', '=', fileId)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(stored.kind).toBe('SUPPORTING_DOCUMENT');
  });

  /* ---------------------------------------------- read authorisation */

  describe('read authorisation', () => {
    /** Builds a submitted requisition with attached doc and a configured approver chain. */
    const submittedWithDoc = async () => {
      const created = await draft();
      const id = created.body.id;
      await requester.client
        .post(`/requisitions/${id}/supporting-document`)
        .attach('file', PDF_HEADER, 'quote.pdf');
      await seedSubmitted(id, approver1);
      return id;
    };

    const path = (id: string) => `/requisitions/${id}/supporting-document`;

    it('lets the requester read', async () => {
      const id = await submittedWithDoc();
      const download = await requester.client.get(path(id));
      expect(download.status).toBe(200);
    });

    it('lets the IM read', async () => {
      const id = await submittedWithDoc();
      const download = await im.client.get(path(id));
      expect(download.status).toBe(200);
    });

    it('lets an approver assigned to THIS requisition read', async () => {
      const id = await submittedWithDoc();
      // seedSubmitted assigned approver1 to slot 1; approver2 has no row.
      const download = await approver1.client.get(path(id));
      expect(download.status).toBe(200);
    });

    it('refuses an approver NOT assigned to this requisition', async () => {
      const id = await submittedWithDoc();
      const download = await approver2.client.get(path(id));
      expect(download.status).toBe(403);
    });

    it('refuses an unrelated requester', async () => {
      const id = await submittedWithDoc();
      const download = await otherRequester.client.get(path(id));
      expect(download.status).toBe(403);
    });

    it('refuses a missing document with 404', async () => {
      const created = await draft();
      // No doc attached — the slot is empty.
      const download = await requester.client.get(path(created.body.id));
      expect(download.status).toBe(404);
    });
  });

  /* ------------------------------------------------------- audit */

  it('writes an audit row on attach and another on remove', async () => {
    const created = await draft();
    const id = created.body.id;

    await requester.client
      .post(`/requisitions/${id}/supporting-document`)
      .attach('file', PDF_HEADER, 'quote.pdf');
    await requester.client.delete(`/requisitions/${id}/supporting-document`);

    const audits = await ctx.db
      .selectFrom('audit_log')
      .where('entity_id', '=', id)
      .select('action')
      .execute();
    const actions = audits.map((row) => row.action);
    expect(actions).toContain('requisition.supporting_document_attached');
    expect(actions).toContain('requisition.supporting_document_removed');
  });

  /* ------------------------------------------- end-to-end: DRAFT empty */

  it('a DRAFT with no supporting document yields null on the detail', async () => {
    const created = await draft();
    const detail = await requester.client.get(`/requisitions/${created.body.id}`);
    expect(detail.body.supportingDocument).toBeNull();
    expect(detail.body.supportingDocumentUrl).toBeNull();
  });
});