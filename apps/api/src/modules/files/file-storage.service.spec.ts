import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageService, FileRejectedError } from './file-storage.service';
import type { AppConfig } from '../../config';

/**
 * These are the tests that matter for 5.1. Everything else in the service is bookkeeping; this
 * is the part that decides whether a caller can put arbitrary bytes at an arbitrary path.
 */
describe('FileStorageService', () => {
  let dir: string;
  let service: FileStorageService;

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ims-files-'));
    service = new FileStorageService({
      uploads: { storageDir: dir, maxImageBytes: 1_000, maxDocumentBytes: 5_000 },
      imports: { maxFileBytes: 5_000 },
    } as AppConfig);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts a real PNG and gives it a server-generated name', async () => {
    const stored = await service.store({
      kind: 'SIGNATURE',
      contents: PNG,
      originalName: 'my signature.png',
    });

    expect(stored.mimeType).toBe('image/png');
    expect(stored.sizeBytes).toBe(PNG.byteLength);
    // The caller's filename appears nowhere in the path.
    expect(stored.relativePath).not.toContain('my signature');
    expect(stored.relativePath).toMatch(/^signature\/[0-9a-f-]{36}\.png$/);
    await expect(service.read(stored.relativePath)).resolves.toEqual(PNG);
  });

  it('accepts JPEG and PDF for a document', async () => {
    await expect(
      service.store({ kind: 'INVOICE', contents: JPEG, originalName: 'a.jpg' }),
    ).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    await expect(
      service.store({ kind: 'INVOICE', contents: PDF, originalName: 'a.pdf' }),
    ).resolves.toMatchObject({ mimeType: 'application/pdf' });
  });

  /** The header is the caller's to set. The first four bytes are not. */
  it('rejects a file whose bytes do not match any accepted type, whatever it is called', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');

    await expect(
      service.store({ kind: 'SIGNATURE', contents: html, originalName: 'innocent.png' }),
    ).rejects.toBeInstanceOf(FileRejectedError);

    // Nothing was written.
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it('refuses a PDF as a signature even though PDFs are otherwise accepted', async () => {
    await expect(
      service.store({ kind: 'SIGNATURE', contents: PDF, originalName: 'sig.pdf' }),
    ).rejects.toBeInstanceOf(FileRejectedError);
  });

  it('enforces the per-kind size limit', async () => {
    const bigImage = Buffer.concat([PNG, Buffer.alloc(1_100)]);
    await expect(
      service.store({ kind: 'SIGNATURE', contents: bigImage, originalName: 'big.png' }),
    ).rejects.toBeInstanceOf(FileRejectedError);

    // The same bytes are fine as an invoice, which has the larger limit.
    await expect(
      service.store({ kind: 'INVOICE', contents: bigImage, originalName: 'big.png' }),
    ).resolves.toBeTruthy();
  });

  it('rejects an empty file', async () => {
    await expect(
      service.store({ kind: 'SIGNATURE', contents: Buffer.alloc(0), originalName: 'e.png' }),
    ).rejects.toBeInstanceOf(FileRejectedError);
  });

  describe('the CSV branch, which has no magic bytes to check', () => {
    const CSV = Buffer.from(
      ['# ims-product-import v1', 'product_id,product_name', ',Widget', ''].join('\r\n'),
      'utf8',
    );

    it('accepts a CSV for an import', async () => {
      const stored = await service.store({
        kind: 'PRODUCT_IMPORT',
        contents: CSV,
        originalName: 'ims-products-2026-09-23.csv',
      });

      expect(stored.mimeType).toBe('text/csv');
      expect(stored.relativePath).toMatch(/^product_import\/[0-9a-f-]{36}\.csv$/);
      await expect(service.read(stored.relativePath)).resolves.toEqual(CSV);
    });

    it('accepts one for a snapshot too, since a snapshot is the same file', async () => {
      await expect(
        service.store({ kind: 'PRODUCT_SNAPSHOT', contents: CSV, originalName: 'snap.csv' }),
      ).resolves.toMatchObject({ mimeType: 'text/csv' });
    });

    /**
     * **The guard on the gate.** If the kind check were ever widened — to all kinds, or to one
     * more than it should be — this is what goes red. Without it, the only thing standing
     * between "images are validated by their bytes" and "anything with a .csv name is accepted
     * anywhere" would be somebody noticing.
     */
    it.each(['SIGNATURE', 'SUPPORTING_DOCUMENT', 'INVOICE'] as const)(
      'still refuses a CSV uploaded as a %s',
      async (kind) => {
        await expect(
          service.store({ kind, contents: CSV, originalName: 'products.csv' }),
        ).rejects.toThrow(FileRejectedError);
      },
    );

    /** And the reverse: the import kinds do not become a hole for arbitrary bytes. */
    it('refuses a PNG uploaded as an import', async () => {
      await expect(
        service.store({ kind: 'PRODUCT_IMPORT', contents: PNG, originalName: 'products.csv' }),
      ).rejects.toThrow(/could not be read as a CSV/);
    });

    /** The check with teeth: a renamed binary is not valid UTF-8. */
    it('refuses a spreadsheet renamed to .csv', async () => {
      const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x80, 0x81]);

      await expect(
        service.store({ kind: 'PRODUCT_IMPORT', contents: xlsx, originalName: 'products.csv' }),
      ).rejects.toThrow(/could not be read as a CSV/);
    });

    it('refuses a CSV whose name does not say csv', async () => {
      await expect(
        service.store({ kind: 'PRODUCT_IMPORT', contents: CSV, originalName: 'products.txt' }),
      ).rejects.toThrow(/could not be read as a CSV/);
    });

    /** Excel writes it, the exporter writes it, and it must survive the decode. */
    it('accepts a CSV carrying a byte-order mark', async () => {
      const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), CSV]);

      await expect(
        service.store({ kind: 'PRODUCT_IMPORT', contents: withBom, originalName: 'p.csv' }),
      ).resolves.toMatchObject({ mimeType: 'text/csv' });
    });

    it('keeps its own size ceiling, not the document one', async () => {
      const service2 = new FileStorageService({
        uploads: { storageDir: dir, maxImageBytes: 1_000, maxDocumentBytes: 5_000 },
        imports: { maxFileBytes: 10 },
      } as AppConfig);

      await expect(
        service2.store({ kind: 'PRODUCT_IMPORT', contents: CSV, originalName: 'p.csv' }),
      ).rejects.toThrow(/too large/);
    });
  });

  it('refuses to resolve a path outside the storage root', () => {
    expect(() => service.absolutePathFor('../../../etc/passwd.png')).toThrow(FileRejectedError);
    expect(() => service.absolutePathFor('signature/../../escape.png')).toThrow(FileRejectedError);
  });

  it('refuses a path with an extension it does not recognise', () => {
    expect(() => service.absolutePathFor('signature/x.sh')).toThrow(FileRejectedError);
  });

  it('does not treat a sibling directory with the same prefix as inside the root', () => {
    // `<dir>-evil` starts with `<dir>` as a string but is a different directory.
    expect(() => service.absolutePathFor(`../${'ims-files-evil'}/x.png`)).toThrow(FileRejectedError);
  });

  it('never leaves a temp file behind on success', async () => {
    await service.store({ kind: 'SIGNATURE', contents: PNG, originalName: 'a.png' });
    const entries = await readdir(join(dir, 'signature'));
    expect(entries.filter((name) => name.endsWith('.tmp'))).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });
});
