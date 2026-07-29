import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { DomainError } from '../../common/errors';

export class PdfRenderFailedError extends DomainError {
  constructor(cause: string) {
    // The caller gets a stable code; the reason goes to the log, never to the user.
    super(
      ErrorCode.PDF_RENDER_FAILED,
      'The document could not be generated. Try again in a moment.',
      HttpStatus.INTERNAL_SERVER_ERROR,
      { cause },
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

  /** Writes a rendered document under the files volume and returns its relative path. */
  async store(relativePath: string, contents: Buffer): Promise<string> {
    const absolute = this.absolutePathFor(relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents);
    return relativePath;
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.absolutePathFor(relativePath));
  }

  exists(relativePath: string): boolean {
    return existsSync(this.absolutePathFor(relativePath));
  }

  /**
   * The letterhead, inlined as a data URI.
   *
   * Chromium renders `setContent` HTML with no base URL, so a relative `<img src>` resolves to
   * nothing and the pad silently disappears. Returns null when no asset has been supplied —
   * the template then draws its placeholder, which is honest about OQ-11 being unanswered.
   */
  async letterheadDataUri(): Promise<string | null> {
    const path = this.config.pdf.letterheadPath;
    if (!path) return null;

    const absolute = resolve(path);
    if (!existsSync(absolute)) {
      this.logger.warn(`PDF_LETTERHEAD_PATH is set to ${absolute} but no file is there`);
      return null;
    }

    const mime = MIME_BY_EXTENSION[extname(absolute).toLowerCase()];
    if (!mime) {
      this.logger.warn(`Unsupported letterhead type ${extname(absolute)}; ignoring it`);
      return null;
    }

    const bytes = await readFile(absolute);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }

  private absolutePathFor(relativePath: string): string {
    // Anything that escapes the storage directory is a path-traversal attempt, not a filename.
    const base = resolve(this.config.pdf.storageDir);
    const absolute = resolve(join(base, relativePath));
    if (!absolute.startsWith(base)) {
      throw new PdfRenderFailedError(`Refusing a path outside the storage directory`);
    }
    return absolute;
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
