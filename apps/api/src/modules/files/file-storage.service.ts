import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type StoredFileKind } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { DomainError } from '../../common/errors';

export class FileRejectedError extends DomainError {
  constructor(reason: string) {
    // The reason is safe to surface: it describes the caller's own upload, not our internals.
    super(ErrorCode.VALIDATION_FAILED, reason, HttpStatus.BAD_REQUEST);
  }
}

/**
 * What a file is allowed to be, decided by its **first bytes**, not its `Content-Type`.
 *
 * A caller sets the header; a caller does not set the magic number. Trusting the header would let
 * anyone store an HTML or SVG payload as `image/png` — and an SVG served back to a browser is a
 * scripting vector, which is exactly why SVG is absent from this table.
 */
interface FileType {
  mime: string;
  extension: string;
  /** Byte prefix that identifies the format. */
  magic: readonly number[];
}

const FILE_TYPES: readonly FileType[] = [
  { mime: 'image/png', extension: '.png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', extension: '.jpg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'application/pdf', extension: '.pdf', magic: [0x25, 0x50, 0x44, 0x46] },
];

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg']);

/**
 * The one format with no magic number, and the only kinds allowed to carry it.
 *
 * A CSV is plain text: there is no byte prefix to check, so the rule above cannot decide it and
 * the import would otherwise be refused before the importer ever saw a byte. Plan §3.7 / C22
 * names the fallback — extension, a strict UTF-8 decode, and a header match — and it is
 * deliberately split: the first two are here, the third is `parseImportCsv`, where "is this
 * *our* file, at this schema version, from this deployment" already lives with its own message.
 * Duplicating the fingerprint constant into this module would be a second definition of our own
 * format, which is the drift the import work has spent its whole time avoiding.
 *
 * **Gated by kind, not by content.** A signature or an invoice can never reach this branch, so
 * the magic-byte rule for images and PDFs is untouched rather than loosened — the spec asserts
 * that a CSV uploaded as a supporting document is still refused, which is what goes red if this
 * set is ever widened.
 */
const TEXT_KINDS = new Set<StoredFileKind>(['PRODUCT_IMPORT', 'PRODUCT_SNAPSHOT']);
const CSV_TYPE = { mime: 'text/csv', extension: '.csv' } as const;

export interface StoreFileInput {
  kind: StoredFileKind;
  contents: Buffer;
  /** The client's filename. Recorded for display; never used to build a path. */
  originalName: string;
}

export interface StoredFileLocation {
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Writes and reads uploaded bytes. Knows nothing about signatures or invoices beyond the size
 * and format rules each `kind` implies — the owning module records what the file *means*.
 */
@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /**
   * Validate, then write. Returns the server-generated relative path for the caller to record.
   *
   * Order matters: everything that can reject the upload runs before a single byte is written, so
   * a rejected file never exists on disk even briefly.
   */
  async store(input: StoreFileInput): Promise<StoredFileLocation> {
    const isText = TEXT_KINDS.has(input.kind);
    const detected = isText ? this.detectCsv(input) : this.detectType(input.contents);

    if (!detected) {
      throw new FileRejectedError(
        isText
          ? 'That file could not be read as a CSV. Export the products, edit that file, and upload it back — saved as CSV, not as a spreadsheet.'
          : 'That file type is not accepted. Upload a PNG, JPEG or PDF.',
      );
    }

    // A signature is a few hundred pixels of ink; an invoice may be a scan. Different limits,
    // both from config, chosen by kind rather than by what the caller claims.
    const isSignature = input.kind === 'SIGNATURE';
    if (isSignature && !IMAGE_MIMES.has(detected.mime)) {
      throw new FileRejectedError('A signature must be a PNG or JPEG image.');
    }

    // An import has its own ceiling and reads it, rather than inheriting whichever of the two
    // document limits happens to be smaller — see IMPORT_MAX_FILE_BYTES.
    const maxBytes = isText
      ? this.config.imports.maxFileBytes
      : isSignature
        ? this.config.uploads.maxImageBytes
        : this.config.uploads.maxDocumentBytes;
    if (input.contents.byteLength > maxBytes) {
      throw new FileRejectedError(
        `That file is too large. The limit is ${Math.floor(maxBytes / 1_000_000)} MB.`,
      );
    }
    if (input.contents.byteLength === 0) {
      throw new FileRejectedError('That file is empty.');
    }

    // The whole path is server-generated. The client's name never reaches the filesystem, so
    // `../../etc/passwd` as a filename is simply recorded as a curious display string.
    const relativePath = `${input.kind.toLowerCase()}/${randomUUID()}${detected.extension}`;
    const absolute = this.absolutePathFor(relativePath);
    await mkdir(dirname(absolute), { recursive: true });

    // Write-then-rename, as the PDF renderer does: a reader can never see a partial file.
    const temp = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, input.contents);
      await rename(temp, absolute);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }

    return {
      relativePath,
      mimeType: detected.mime,
      sizeBytes: input.contents.byteLength,
    };
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.absolutePathFor(relativePath));
  }

  /** Best-effort cleanup. A missing file is not an error — the row is the record, not the disk. */
  async remove(relativePath: string): Promise<void> {
    await unlink(this.absolutePathFor(relativePath)).catch((error: unknown) => {
      this.logger.warn(`Could not remove ${relativePath}: ${String(error)}`);
    });
  }

  /**
   * Resolve a relative path inside the storage root, refusing anything that escapes it.
   *
   * Paths are server-generated, so this should be unreachable — which is exactly why it stays:
   * the day someone adds a code path that passes a stored value straight through, this is what
   * stops it becoming an arbitrary file read.
   */
  absolutePathFor(relativePath: string): string {
    const base = resolve(this.config.uploads.storageDir);
    const absolute = resolve(join(base, relativePath));
    // `base + sep`, not a bare prefix check: `/storage/files-evil` starts with `/storage/files`
    // but is a different directory.
    if (absolute !== base && !absolute.startsWith(base + sep)) {
      throw new FileRejectedError('Refusing a path outside the storage directory');
    }
    const known = [...FILE_TYPES.map((type) => type.extension), CSV_TYPE.extension];
    if (!known.includes(extname(absolute).toLowerCase())) {
      throw new FileRejectedError('Refusing an unexpected file extension');
    }
    return absolute;
  }

  private detectType(contents: Buffer): FileType | undefined {
    return FILE_TYPES.find((type) => type.magic.every((byte, index) => contents[index] === byte));
  }

  /**
   * C22's first two checks, for the kinds that carry a CSV.
   *
   * The extension is the client's filename and therefore worth exactly what client input is
   * worth — it catches the honest mistake, not the dishonest one. **The strict decode is the
   * check with teeth**: `fatal: true` throws on any byte sequence that is not valid UTF-8, which
   * is what a PNG, a zip or an .xlsx renamed to `.csv` will be. A file that passes both and is
   * still not ours is caught by the fingerprint in `parseImportCsv`, with a message that tells
   * the person what to do about it.
   */
  private detectCsv(input: StoreFileInput): { mime: string; extension: string } | undefined {
    if (extname(input.originalName).toLowerCase() !== CSV_TYPE.extension) return undefined;

    try {
      new TextDecoder('utf-8', { fatal: true }).decode(input.contents);
    } catch {
      return undefined;
    }

    return CSV_TYPE;
  }
}
