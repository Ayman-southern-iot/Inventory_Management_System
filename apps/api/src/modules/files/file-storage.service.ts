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
    const detected = this.detectType(input.contents);
    if (!detected) {
      throw new FileRejectedError(
        'That file type is not accepted. Upload a PNG, JPEG or PDF.',
      );
    }

    // A signature is a few hundred pixels of ink; an invoice may be a scan. Different limits,
    // both from config, chosen by kind rather than by what the caller claims.
    const isSignature = input.kind === 'SIGNATURE';
    if (isSignature && !IMAGE_MIMES.has(detected.mime)) {
      throw new FileRejectedError('A signature must be a PNG or JPEG image.');
    }

    const maxBytes = isSignature
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
    if (!FILE_TYPES.some((type) => type.extension === extname(absolute).toLowerCase())) {
      throw new FileRejectedError('Refusing an unexpected file extension');
    }
    return absolute;
  }

  private detectType(contents: Buffer): FileType | undefined {
    return FILE_TYPES.find((type) =>
      type.magic.every((byte, index) => contents[index] === byte),
    );
  }
}
