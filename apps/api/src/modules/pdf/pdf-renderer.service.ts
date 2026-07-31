import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, resolve, sep } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { DomainError } from '../../common/errors';

export class PdfRenderFailedError extends DomainError {
  /**
   * `reason` is kept as a field and deliberately **not** passed as `details`. DomainError's fourth
   * argument is serialised straight into the response body, so passing it there shipped the
   * Chromium launch failure — container paths, executable location, library-loading detail —
   * to the caller. Same mistake PdfDownloadTokenInvalidError was fixed for; the log keeps it.
   * Named `reason` rather than `cause` so it does not shadow `Error.cause`.
   */
  constructor(readonly reason: string) {
    super(
      ErrorCode.PDF_RENDER_FAILED,
      'The document could not be generated. Try again in a moment.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export type PageOrientation = 'portrait' | 'landscape';

/**
 * Headless Chromium, one instance, reused.
 *
 * Chromium is the memory hog in this stack (§3.3), so launching one per render would be the
 * fastest way to exhaust a 4 GB VM. The browser is started lazily on the first document and
 * closed on shutdown; each render gets its own page, which is cheap.
 *
 * Every measurement comes from config (OQ-11): the real company pad has not been supplied, so
 * a hardcoded margin would be a guess that becomes wrong the day it arrives.
 */
@Injectable()
export class PdfRendererService implements OnApplicationShutdown {
  private readonly logger = new Logger(PdfRendererService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async onApplicationShutdown(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }

  /** Renders HTML to a PDF buffer. Nothing here knows what a BOM is. */
  async render(html: string, orientation: PageOrientation = 'portrait'): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // `setContent` rather than a data: URL — a large document blows the URL length limit.
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: this.config.pdf.renderTimeoutMs,
      });

      return Buffer.from(
        await page.pdf({
          format: this.config.pdf.pageFormat,
          landscape: orientation === 'landscape',
          margin: this.config.pdf.margins,
          // Without this the letterhead background layer is dropped entirely.
          printBackground: true,
          timeout: this.config.pdf.renderTimeoutMs,
        }),
      );
    } catch (error) {
      this.logger.error(`PDF render failed: ${String(error)}`);
      throw new PdfRenderFailedError(String(error));
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /**
   * Writes a rendered document under the files volume and returns its relative path.
   *
   * Write-then-rename, not write-in-place. The path is derived from the BOM number, so a
   * re-render targets the same file a concurrent `GET /boms/:id/pdf` may be streaming —
   * and idempotency keys are scoped per user, so an IM and an Admin clicking Render on the
   * same BOM genuinely do run two renders at once. `rename` within one filesystem is atomic:
   * a reader sees either the old complete PDF or the new one, never a truncated file.
   */
  async store(relativePath: string, contents: Buffer): Promise<string> {
    const absolute = this.absolutePathFor(relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    // The pid/random suffix keeps two concurrent renders from sharing a temp file.
    const temp = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, contents);
      await rename(temp, absolute);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    return relativePath;
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.absolutePathFor(relativePath));
  }

  exists(relativePath: string): boolean {
    return existsSync(this.absolutePathFor(relativePath));
  }

  /** Resolves a relative storage path to its absolute form (used by callers that need to unlink). */
  absolutePathFor(relativePath: string): string {
    const base = resolve(this.config.pdf.storageDir);
    const absolute = resolve(join(base, relativePath));
    // `base + sep`, not a bare prefix check: `/storage/pdf-evil` starts with `/storage/pdf`
    // but is a different directory. Same guard as FileStorageService.absolutePathFor.
    if (absolute !== base && !absolute.startsWith(base + sep)) {
      throw new PdfRenderFailedError(`Refusing a path outside the storage directory`);
    }
    return absolute;
  }

  /**
   * The letterhead, inlined as a data URI.
   *
   * Chromium renders `setContent` HTML with no base URL, so a relative `<img src>` resolves to
   * nothing and the pad silently disappears. Returns null when no asset has been supplied —
   * the template then draws its placeholder, which is honest about OQ-11 being unanswered.
   */
  async letterheadDataUri(): Promise<string | null> {
    return this.imageDataUri(this.config.pdf.letterheadPath, 'PDF_LETTERHEAD_PATH');
  }

  /** The company logo for the BOM letterhead block, inlined for the same reason. */
  async companyLogoDataUri(): Promise<string | null> {
    return this.imageDataUri(this.config.company.logoPath, 'COMPANY_LOGO_PATH');
  }

  /**
   * Read an image and inline it.
   *
   * The MIME type comes from the **file's magic bytes**, not its extension. The supplied Southern
   * IoT logo was named `.png` and was in fact a JPEG; trusting the extension would have emitted
   * `data:image/png` for JPEG bytes, which some renderers accept and others silently drop.
   */
  private async imageDataUri(path: string, settingName: string): Promise<string | null> {
    if (!path) return null;

    const absolute = resolve(path);
    if (!existsSync(absolute)) {
      this.logger.warn(`${settingName} is set to ${absolute} but no file is there`);
      return null;
    }

    const bytes = await readFile(absolute);
    const mime = sniffImageMime(bytes) ?? MIME_BY_EXTENSION[extname(absolute).toLowerCase()];
    if (!mime) {
      this.logger.warn(`Unsupported image type at ${absolute}; ignoring it`);
      return null;
    }

    return `data:${mime};base64,${bytes.toString('base64')}`;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;

    // Concurrent first renders must share one launch, not race to start two Chromiums.
    this.launching ??= puppeteer
      .launch({
        headless: true,
        // --no-sandbox is required in the container, where the process is already unprivileged
        // and there is no user namespace to sandbox into.
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      })
      .then((browser) => {
        this.browser = browser;
        this.launching = null;
        this.logger.log('Chromium started for PDF rendering');
        return browser;
      })
      .catch((error: unknown) => {
        this.launching = null;
        throw new PdfRenderFailedError(String(error));
      });

    return this.launching;
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/**
 * Identify a raster image by its first bytes. Used in preference to the file extension, which
 * lies more often than you would hope — see `imageDataUri`. SVG has no magic number and falls
 * back to the extension map, which is fine: it is text either way.
 */
function sniffImageMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  }
  // WEBP is "RIFF" .... "WEBP".
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF') {
    if (bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  }
  return undefined;
}
