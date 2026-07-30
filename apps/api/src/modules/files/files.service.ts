import { Injectable } from '@nestjs/common';
import type { StoredFile, StoredFileKind } from '@ims/shared';
import { NotFoundError } from '../../common/errors';
import { FileStorageService } from './file-storage.service';
import { FilesRepository, toStoredFile, type StoredFileRow, type Tx } from './files.repository';

export interface UploadInput {
  kind: StoredFileKind;
  contents: Buffer;
  originalName: string;
  uploadedBy: string;
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
    });
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
