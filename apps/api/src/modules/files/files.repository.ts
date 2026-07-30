import { Inject, Injectable } from '@nestjs/common';
import type { Selectable, Transaction } from 'kysely';
import type { StoredFile, StoredFileKind } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database, StoredFilesTable } from '../../database/schema';

export type Tx = Transaction<Database>;
export type StoredFileRow = Selectable<StoredFilesTable>;

export interface StoredFileInsert {
  kind: StoredFileKind;
  relative_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
}

export function toStoredFile(
  row: StoredFileRow,
  uploadedByName: string | null = null,
): StoredFile {
  return {
    id: row.id,
    kind: row.kind,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedByName,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class FilesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Insert only. There is deliberately no `update` — replacing a signature or an invoice means
   * inserting a new row and repointing the owner, so a document that referenced the old file
   * keeps referencing exactly what it was signed with.
   */
  async insert(tx: Tx | undefined, row: StoredFileInsert): Promise<StoredFileRow> {
    return (tx ?? this.db)
      .insertInto('stored_files')
      .values(row)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(id: string): Promise<StoredFileRow | undefined> {
    return this.db.selectFrom('stored_files').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Joined form for display, where the uploader's name is wanted alongside the metadata. */
  async findWithUploader(id: string): Promise<(StoredFileRow & { uploader_name: string | null }) | undefined> {
    return this.db
      .selectFrom('stored_files')
      .leftJoin('users', 'users.id', 'stored_files.uploaded_by')
      .where('stored_files.id', '=', id)
      .selectAll('stored_files')
      .select('users.full_name as uploader_name')
      .executeTakeFirst();
  }
}
