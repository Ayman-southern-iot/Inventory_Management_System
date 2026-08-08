import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { ErrorCode, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';

interface Actor {
  id: string;
  client: HttpClient;
}

const PDF_HEADER = Buffer.from('%PDF-1.4\n%fake-but-plausible-bytes\n');

/**
 * Pre-draft supporting-document upload (orphan-upload + claim-on-create).
 *
 * The flow: a requester picks a file on the empty Make Requisition form. The file
 * is written to `stored_files` immediately with `pending_claim_by = actor.id` —
 * no requisition row yet. When the draft is saved, the create service claims the
 * file in the same transaction: ownership check (only the uploader), FK repoint,
 * and `pending_claim_by` clear.
 *
 * The orphan upload is a route the form uses only between "form opened" and
 * "draft saved"; the existing DRAFT-only endpoint is unchanged.
 */
describe('orphan supporting document upload', () => {
  let ctx: TestApp;
  let requester: Actor;
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
    otherRequester = await actorFor([Role.GENERAL]);
  });

  const uploadOrphan = async (actor: Actor, filename = 'quote.pdf', buffer = PDF_HEADER) =>
    actor.client
      .post('/uploads/supporting-document')
      .attach('file', buffer, filename);

  const createDraft = async (actor: Actor, body: Record<string, unknown>) =>
    actor.client.post('/requisitions').send(body);

  it('creates an orphan stored_files row with the actor as pending owner', async () => {
    const response = await uploadOrphan(requester);
    expect(response.status).toBe(200);

    const row = await ctx.db
      .selectFrom('stored_files')
      .select(['id', 'kind', 'pending_claim_by', 'uploaded_by'])
      .where('id', '=', response.body.fileId)
      .executeTakeFirstOrThrow();
    expect(row.kind).toBe('SUPPORTING_DOCUMENT');
    expect(row.pending_claim_by).toBe(requester.id);
    expect(row.uploaded_by).toBe(requester.id);
  });

  it('rejects an empty file with a validation error', async () => {
    const response = await requester.client
      .post('/uploads/supporting-document')
      .attach('file', Buffer.alloc(0), 'empty.pdf');
    expect(response.status).toBe(400);
  });

  it('records a requisition.supporting_document_pending audit row', async () => {
    const response = await uploadOrphan(requester);
    expect(response.status).toBe(200);
    const fileId = response.body.fileId as string;

    const audit = await ctx.db
      .selectFrom('audit_log')
      .select(['action', 'actor_id', 'entity_type', 'entity_id', 'metadata'])
      .where('action', '=', 'requisition.supporting_document_pending')
      .where('entity_id', '=', fileId)
      .executeTakeFirstOrThrow();
    expect(audit.actor_id).toBe(requester.id);
    expect(audit.entity_type).toBe('stored_file');
    expect((audit.metadata as { fileId: string }).fileId).toBe(fileId);
  });

  it('claims the orphan atomically when the draft is saved', async () => {
    const uploaded = await uploadOrphan(requester);
    const fileId = uploaded.body.fileId as string;

    const created = await createDraft(requester, {
      urgency: 'NORMAL',
      reason: 'quote attached pre-save',
      items: [
        { itemName: 'Cable', quantity: 2, estimatedUnitPrice: 300, productId: null, note: null },
      ],
      pendingSupportingDocumentId: fileId,
    });
    expect(created.status).toBe(201);
    const requisitionId = created.body.id as string;

    // The requisition now points at the file, and the file is no longer an orphan.
    const requisition = await ctx.db
      .selectFrom('requisitions')
      .select(['supporting_document_file_id'])
      .where('id', '=', requisitionId)
      .executeTakeFirstOrThrow();
    expect(requisition.supporting_document_file_id).toBe(fileId);

    const file = await ctx.db
      .selectFrom('stored_files')
      .select(['pending_claim_by'])
      .where('id', '=', fileId)
      .executeTakeFirstOrThrow();
    expect(file.pending_claim_by).toBeNull();
  });

  it('writes a supporting_document_attached audit row on claim', async () => {
    const uploaded = await uploadOrphan(requester);
    const fileId = uploaded.body.fileId as string;
    const created = await createDraft(requester, {
      urgency: 'NORMAL',
      reason: null,
      items: [
        { itemName: 'Cable', quantity: 1, estimatedUnitPrice: 100, productId: null, note: null },
      ],
      pendingSupportingDocumentId: fileId,
    });
    const requisitionId = created.body.id as string;

    const audit = await ctx.db
      .selectFrom('audit_log')
      .select(['metadata', 'action'])
      .where('action', '=', 'requisition.supporting_document_attached')
      .where('entity_id', '=', requisitionId)
      .executeTakeFirstOrThrow();
    expect((audit.metadata as { fileId: string; via: string }).fileId).toBe(fileId);
    expect((audit.metadata as { fileId: string; via: string }).via).toBe('claim-on-create');
  });

  it('refuses the claim when another user attempts to attach someone else\'s orphan', async () => {
    const uploaded = await uploadOrphan(requester);
    const fileId = uploaded.body.fileId as string;

    // otherRequester tries to claim requester's file by submitting a draft with
    // requester's orphan id.
    const response = await createDraft(otherRequester, {
      urgency: 'NORMAL',
      reason: null,
      items: [
        { itemName: 'Cable', quantity: 1, estimatedUnitPrice: 100, productId: null, note: null },
      ],
      pendingSupportingDocumentId: fileId,
    });
    expect(response.status).toBe(403);

    // The file is still pending — the failed claim did not mutate it.
    const file = await ctx.db
      .selectFrom('stored_files')
      .select(['pending_claim_by'])
      .where('id', '=', fileId)
      .executeTakeFirstOrThrow();
    expect(file.pending_claim_by).toBe(requester.id);

    // The original requester can still claim it themselves.
    const later = await createDraft(requester, {
      urgency: 'NORMAL',
      reason: null,
      items: [
        { itemName: 'Cable', quantity: 1, estimatedUnitPrice: 100, productId: null, note: null },
      ],
      pendingSupportingDocumentId: fileId,
    });
    expect(later.status).toBe(201);
  });

  it('refuses the claim when the pending id does not exist', async () => {
    const response = await createDraft(requester, {
      urgency: 'NORMAL',
      reason: null,
      items: [
        { itemName: 'Cable', quantity: 1, estimatedUnitPrice: 100, productId: null, note: null },
      ],
      // A valid uuid that no row points at.
      pendingSupportingDocumentId: '00000000-0000-0000-0000-000000000000',
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('creates a draft with no supporting document when the field is omitted', async () => {
    // Sanity: the new optional field is truly optional — existing clients
    // (no field) still produce a clean draft with `supporting_document_file_id = null`.
    const created = await createDraft(requester, {
      urgency: 'NORMAL',
      reason: null,
      items: [
        { itemName: 'Cable', quantity: 1, estimatedUnitPrice: 100, productId: null, note: null },
      ],
    });
    expect(created.status).toBe(201);
    const requisitionId = created.body.id as string;
    const requisition = await ctx.db
      .selectFrom('requisitions')
      .select(['supporting_document_file_id'])
      .where('id', '=', requisitionId)
      .executeTakeFirstOrThrow();
    expect(requisition.supporting_document_file_id).toBeNull();
  });

  it('drops orphans older than the TTL and keeps fresh ones (sweep behaviour)', async () => {
    const uploaded = await uploadOrphan(requester);
    const fileId = uploaded.body.fileId as string;

    // Simulate "older than the TTL": backdate `created_at` to 25 hours ago. The
    // schema intentionally types `created_at` as `never`-updatable on the Kysely
    // table so production code can't backdate a row, so the test path goes
    // through a raw SQL update.
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await sql`UPDATE stored_files SET created_at = ${twentyFiveHoursAgo} WHERE id = ${fileId}`.execute(
      ctx.db,
    );

    // Run the sweep directly. The job is registered on @Cron; the test path
    // exercises the same method body.
    const { PendingUploadSweepJob } = await import(
      '../src/modules/files/pending-upload-sweep.job'
    );
    const job = ctx.app.get(PendingUploadSweepJob);
    const removed = await job.run();
    expect(removed).toBe(1);

    const file = await ctx.db
      .selectFrom('stored_files')
      .select(['id'])
      .where('id', '=', fileId)
      .executeTakeFirst();
    expect(file).toBeUndefined();
  });

  it('keeps an orphan that is younger than the TTL', async () => {
    const uploaded = await uploadOrphan(requester);
    const fileId = uploaded.body.fileId as string;

    const { PendingUploadSweepJob } = await import(
      '../src/modules/files/pending-upload-sweep.job'
    );
    const job = ctx.app.get(PendingUploadSweepJob);
    const removed = await job.run();
    expect(removed).toBe(0);

    const file = await ctx.db
      .selectFrom('stored_files')
      .select(['id', 'pending_claim_by'])
      .where('id', '=', fileId)
      .executeTakeFirstOrThrow();
    expect(file.pending_claim_by).toBe(requester.id);
  });
});