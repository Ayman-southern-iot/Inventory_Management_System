import { Injectable } from '@nestjs/common';
import { SettingKey, type StoredFile, type StoredFileKind } from '@ims/shared';
import { NotFoundError, PendingUploadLimitReachedError } from '../../common/errors';
import { SettingsService } from '../settings/settings.service';
import { FileStorageService } from './file-storage.service';
import { FilesRepository, toStoredFile, type StoredFileRow, type Tx } from './files.repository';

export interface UploadInput {
  kind: StoredFileKind;
  contents: Buffer;
  originalName: string;
  uploadedBy: string;
  /**
   * Optional. When set, the row is created in the orphan state — uploaded but
   * not yet linked to a parent row. The owning user's id. The parent-create
   * transaction must clear this atomically; the daily sweep deletes rows that
   * have been pending for >24h.
   *
   * Default null — every existing call site uploads into a row whose parent
   * already exists, so it stays the same shape for signatures and invoices.
   */
  pendingClaimBy?: string | null;
}

/**
 * Storing an upload is two things that must not drift apart: bytes on disk and a row describing
 * them. This is the only place both happen.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly storage: FileStorageService,
    private readonly repo: FilesRepository,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Validate and write the bytes, then record the row.
   *
   * Bytes first, deliberately. If the row insert then fails, we are left with an unreferenced
   * file — wasted disk, harmless, and cleanable. The other order risks a row pointing at a file
   * that does not exist, which every reader would then have to defend against.
   *
   * `tx` lets the caller commit the row with whatever it belongs to (the approval that used the
   * signature, the purchase that carries the invoice).
   */
  async upload(input: UploadInput, tx?: Tx): Promise<StoredFileRow> {
    // Checked before the bytes are written, not after: the point of the ceiling is to stop the
    // disk filling, and a check that runs once the file is already on disk does not do that.
    // Only the orphan path is bounded — a signature or an invoice is attached to a row that
    // already exists, so it cannot accumulate unclaimed.
    if (input.pendingClaimBy) {
      const limit = await this.settings.get(SettingKey.MAX_PENDING_UPLOADS_PER_USER);
      const held = await this.repo.countPendingFor(input.pendingClaimBy, input.kind);
      if (held >= limit) throw new PendingUploadLimitReachedError(limit);
    }

    const stored = await this.storage.store({
      kind: input.kind,
      contents: input.contents,
      originalName: input.originalName,
    });

    return this.repo.insert(tx, {
      kind: input.kind,
      relative_path: stored.relativePath,
      // Cap it: this is display text from an untrusted source and the column should not become
      // a dumping ground for a 4 KB filename.
      original_name: input.originalName.slice(0, 255),
      mime_type: stored.mimeType,
      size_bytes: stored.sizeBytes,
      uploaded_by: input.uploadedBy,
      pending_claim_by: input.pendingClaimBy ?? null,
    });
  }

  /**
   * Remove a stored file and its row, for the one case that genuinely wants the bytes back:
   * an import snapshot an admin has chosen to delete (`importing_data.md` §10).
   *
   * The row goes first. Every foreign key that can point at a `stored_files` row is either
   * `SET NULL` or `RESTRICT`, so a caller that has not already cleared a `RESTRICT` reference
   * gets a constraint error here rather than an orphaned row and a missing file.
   */
  async remove(id: string): Promise<void> {
    const row = await this.requireRow(id);
    await this.repo.deleteById(id);
    // Best-effort, as the sweep job's is: the row is the record, not the disk.
    await this.storage.remove(row.relative_path);
  }

  async requireRow(id: string): Promise<StoredFileRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError('File');
    return row;
  }

  /** Metadata for display, including who uploaded it. */
  async describe(id: string): Promise<StoredFile> {
    const row = await this.repo.findWithUploader(id);
    if (!row) throw new NotFoundError('File');
    return toStoredFile(row, row.uploader_name);
  }

  /**
   * The bytes. Callers must authorize first — this method deliberately takes no actor, so that
   * "who may read this" is a decision the owning module makes about its own entity rather than
   * something half-enforced here on a table that does not know what the file is for.
   */
  async readContents(id: string): Promise<{ contents: Buffer; row: StoredFileRow }> {
    const row = await this.requireRow(id);
    return { contents: await this.storage.read(row.relative_path), row };
  }
}
