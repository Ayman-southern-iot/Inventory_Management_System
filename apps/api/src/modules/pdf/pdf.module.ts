import { Module } from '@nestjs/common';
import { PdfRendererService } from './pdf-renderer.service';
import { PdfSigningService } from './pdf-signing.service';

/**
 * Wraps the BOM's PDF dependencies behind a Nest module.
 *
 * Two providers:
 *
 *   - `PdfRendererService` — headless Chromium, file I/O, letterhead inlining. Already
 *     self-contained: `@Inject(CONFIG)` and a single `@Injectable()`. No imports.
 *   - `PdfSigningService` — HMAC signer for short-lived download URLs. Same story:
 *     it reads the signing secret from config and nothing else.
 *
 * No controller — `BomsController` owns the routes (URL `/boms/:id/pdf*` belongs under the
 * BOM resource). The renderer + signer are exposed here so `BomsModule` can import them
 * without having to reach into a sibling module's source file.
 */
@Module({
  providers: [PdfRendererService, PdfSigningService],
  exports: [PdfRendererService, PdfSigningService],
})
export class PdfModule {}