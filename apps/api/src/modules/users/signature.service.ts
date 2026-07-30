import { Inject, Injectable, Logger } from '@nestjs/common';
import type { StoredFile } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { NotFoundError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { FilesService } from '../files/files.service';
import { toStoredFile } from '../files/files.repository';

/**
 * An approver's signature: upload, read, clear.
 *
 * The rule that shapes all of it — **a signature file is never overwritten or reused**. Uploading
 * a replacement creates a new `stored_files` row and moves the user's pointer. Old approvals keep
 * referencing the old row, so a document signed in July still renders July's signature. Anything
 * else would let someone retroactively change what they appeared to sign.
 */
@Injectable()
export class SignatureService {
  private readonly logger = new Logger(SignatureService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  async currentFor(userId: string): Promise<StoredFile | null> {
    const user = await this.db
      .selectFrom('users')
      .where('id', '=', userId)
      .select('signature_file_id')
      .executeTakeFirst();
    if (!user?.signature_file_id) return null;
    return this.files.describe(user.signature_file_id);
  }

  /**
   * The caller's own signature bytes. Takes a user id and reads only that user's pointer, so
   * there is no path by which one approver reaches another's image.
   */
  async readOwn(userId: string): Promise<{ contents: Buffer; mimeType: string }> {
    const user = await this.db
      .selectFrom('users')
      .where('id', '=', userId)
      .select('signature_file_id')
      .executeTakeFirst();
    if (!user?.signature_file_id) throw new NotFoundError('Signature');

    const { contents, row } = await this.files.readContents(user.signature_file_id);
    return { contents, mimeType: row.mime_type };
  }

  async upload(
    userId: string,
    file: { buffer: Buffer; originalname?: string },
    context: AuditContext,
  ): Promise<StoredFile> {
    // The bytes are written and validated before the transaction opens: file I/O has no business
    // inside a transaction holding a row lock (rules/20 — never an external call in a transaction).
    const row = await this.files.upload({
      kind: 'SIGNATURE',
      contents: file.buffer,
      originalName: file.originalname ?? 'signature',
      uploadedBy: userId,
    });

    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('users')
        .set({ signature_file_id: row.id })
        .where('id', '=', userId)
        .execute();

      await this.audit.record(
        {
          action: 'user.update',
          entityType: 'user',
          entityId: userId,
          entityRef: context.actorEmail,
          summary: 'Uploaded a signature',
          // Never the bytes, and never a path — just enough to prove who changed what, when.
          metadata: { signatureFileId: row.id, sizeBytes: row.size_bytes, mimeType: row.mime_type },
        },
        context,
        tx,
      );
    });

    this.logger.log(`User ${userId} uploaded a signature (${row.size_bytes} bytes)`);
    return toStoredFile(row);
  }

  async clear(userId: string, context: AuditContext): Promise<void> {
    const user = await this.db
      .selectFrom('users')
      .where('id', '=', userId)
      .select('signature_file_id')
      .executeTakeFirst();
    if (!user) throw new NotFoundError('User');
    if (!user.signature_file_id) return;

    await this.db.transaction().execute(async (tx) => {
      // Only the pointer is cleared. The file and its row stay, because completed approvals
      // reference them — and the FK on those rows is RESTRICT, so a delete would fail anyway.
      await tx
        .updateTable('users')
        .set({ signature_file_id: null })
        .where('id', '=', userId)
        .execute();

      await this.audit.record(
        {
          action: 'user.update',
          entityType: 'user',
          entityId: userId,
          entityRef: context.actorEmail,
          summary: 'Removed their signature',
          metadata: { clearedSignatureFileId: user.signature_file_id },
        },
        context,
        tx,
      );
    });
  }
}
