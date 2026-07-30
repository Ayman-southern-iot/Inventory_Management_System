import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, SettingKey } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { SettingsService } from '../src/modules/settings/settings.service';

/** A real 1x1 PNG. Magic bytes matter — the storage service validates them, not the header. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Phase 05 task 5.2.
 *
 * The property worth defending here is not "uploads work" — it is that a signature, once used on
 * an approval, is frozen. An approver who replaces theirs must not retroactively change what a
 * BOM printed last month appears to have been signed with.
 */
describe('signatures', () => {
  let ctx: TestApp;
  let approver: { id: string; client: HttpClient };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    approver = await signIn([Role.GENERAL, Role.APPROVER]);
  });

  /* ------------------------------------------------------------- upload */

  it('uploads a signature and reports it back', async () => {
    const uploaded = await approver.client
      .post('/me/signature')
      .attach('file', PNG, 'my-signature.png');

    expect(uploaded.status).toBe(200);
    expect(uploaded.body.signature.mimeType).toBe('image/png');
    expect(uploaded.body.signature.originalName).toBe('my-signature.png');

    const current = await approver.client.get('/me/signature');
    expect(current.body.signature.id).toBe(uploaded.body.signature.id);
  });

  it('refuses a file that is not really an image', async () => {
    const result = await approver.client
      .post('/me/signature')
      .attach('file', Buffer.from('<svg onload=alert(1)>'), 'sig.png');

    expect(result.status).toBe(400);
  });

  it('refuses an upload with no file', async () => {
    expect((await approver.client.post('/me/signature').send()).status).toBe(400);
  });

  it('refuses a user with no signing role', async () => {
    const general = await signIn([Role.GENERAL]);
    const result = await general.client.post('/me/signature').attach('file', PNG, 'x.png');
    expect(result.status).toBe(403);
  });

  it('replacing a signature creates a new file rather than overwriting the old one', async () => {
    const first = await approver.client.post('/me/signature').attach('file', PNG, 'first.png');
    const second = await approver.client.post('/me/signature').attach('file', PNG, 'second.png');

    expect(second.body.signature.id).not.toBe(first.body.signature.id);

    // Both rows still exist — the old one is what historical approvals point at.
    const rows = await ctx.db.selectFrom('stored_files').selectAll().execute();
    expect(rows).toHaveLength(2);
  });

  it('clearing a signature leaves the stored file in place', async () => {
    await approver.client.post('/me/signature').attach('file', PNG, 'x.png');

    expect((await approver.client.delete('/me/signature')).status).toBe(204);
    expect((await approver.client.get('/me/signature')).body.signature).toBeNull();
    expect(await ctx.db.selectFrom('stored_files').selectAll().execute()).toHaveLength(1);
  });

  /* ------------------------------------------------- signing an approval */

  it('refuses to approve with a signature when none has been uploaded', async () => {
    const { approvalId, client } = await requisitionAwaitingApprover();

    const decided = await client
      .post(`/requisitions/approvals/${approvalId}/decision`)
      .send({ approve: true, note: null, approvedAmount: null, withSignature: true });

    expect(decided.status).toBe(400);
    expect(decided.body.message).toContain('signature');
  });

  it('snapshots the signature at approval, and a later replacement does not change it', async () => {
    const uploaded = await approver.client.post('/me/signature').attach('file', PNG, 'sig.png');
    const originalId = uploaded.body.signature.id as string;

    const { approvalId, client } = await requisitionAwaitingApprover();
    const decided = await client
      .post(`/requisitions/approvals/${approvalId}/decision`)
      .send({ approve: true, note: null, approvedAmount: null, withSignature: true });
    expect(decided.status).toBe(200);

    const signedRow = await approvalRow(approvalId);
    expect(signedRow.signed_with_signature).toBe(true);
    expect(signedRow.signature_file_id).toBe(originalId);

    // Replace the signature. The completed approval must not move with it.
    await approver.client.post('/me/signature').attach('file', PNG, 'new.png');

    const afterReplacement = await approvalRow(approvalId);
    expect(afterReplacement.signature_file_id).toBe(originalId);
  });

  it('approving without a signature records the choice rather than a missing value', async () => {
    await approver.client.post('/me/signature').attach('file', PNG, 'sig.png');

    const { approvalId, client } = await requisitionAwaitingApprover();
    await client
      .post(`/requisitions/approvals/${approvalId}/decision`)
      .send({ approve: true, note: null, approvedAmount: null, withSignature: false });

    const row = await approvalRow(approvalId);
    // Had a signature available and still approved unsigned — a deliberate choice, recorded.
    expect(row.signed_with_signature).toBe(false);
    expect(row.signature_file_id).toBeNull();
  });

  it('a rejection never carries a signature', async () => {
    await approver.client.post('/me/signature').attach('file', PNG, 'sig.png');

    const { approvalId, client } = await requisitionAwaitingApprover();
    await client
      .post(`/requisitions/approvals/${approvalId}/decision`)
      .send({ approve: false, note: 'no', approvedAmount: null, withSignature: true });

    const row = await approvalRow(approvalId);
    expect(row.signed_with_signature).toBe(false);
    expect(row.signature_file_id).toBeNull();
  });

  /* ----------------------------------------------------------- helpers */

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const user = await createUser(ctx.db, { roles });
    const client = httpClient(ctx.app);
    const session = await login(client, user.email);
    return { id: user.id, client: client.as(session.accessToken) };
  }

  async function approvalRow(id: string) {
    return ctx.db
      .selectFrom('requisition_approvals')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  /**
   * Drives a requisition to the point where our approver holds a pending APPROVER-stage
   * approval: submit as a requester, then clear the IM stage.
   */
  async function requisitionAwaitingApprover(): Promise<{ approvalId: string; client: HttpClient }> {
    const settings = ctx.app.get(SettingsService);
    await settings.set(SettingKey.SUBTHRESHOLD_APPROVER_USER_ID, approver.id, {
      actorId: null, actorName: null, actorEmail: null, actorRoles: [],
      requestMethod: null, requestPath: null, requestIp: null, userAgent: null,
    });
    settings.clearCache();

    const im = await signIn([Role.GENERAL, Role.INVENTORY_MANAGER]);
    const requester = await signIn([Role.GENERAL]);

    const draft = await requester.client.post('/requisitions').send({
      urgency: 'NORMAL',
      reason: 'Signature test',
      items: [{ productId: null, itemName: 'Widget', quantity: 1, estimatedUnitPrice: 100, note: null }],
    });
    expect(draft.status).toBe(201);
    const submitted = await requester.client.post(`/requisitions/${draft.body.id}/submit`).send();
    expect(submitted.status).toBe(200);

    const imApproval = submitted.body.approvals.find(
      (a: { stage: string }) => a.stage === 'INVENTORY_MANAGER',
    );
    await im.client
      .post(`/requisitions/approvals/${imApproval.id}/decision`)
      .send({ approve: true, note: null, approvedAmount: null, withSignature: false });

    const detail = await requester.client.get(`/requisitions/${draft.body.id}`);
    const mine = detail.body.approvals.find(
      (a: { stage: string; action: string }) => a.stage === 'APPROVER' && a.action === 'PENDING',
    );
    expect(mine).toBeDefined();
    return { approvalId: mine.id, client: approver.client };
  }
});
