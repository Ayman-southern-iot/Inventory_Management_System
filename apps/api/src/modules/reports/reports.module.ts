import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

/**
 * Read-only. Every figure is derived from the requisition and money tables on each request.
 *
 * The PDF export shares Chromium with the BOM PDF (one launch, one Browser instance) — that's
 * what `PdfModule` exports. Bringing the renderer in here means `ReportsModule` depends on the
 * shared module the BOM PDF lives behind, which is the right granularity: a renderer is a
 * renderer, irrespective of which document it is producing.
 */
@Module({
  imports: [PdfModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsRepository],
  exports: [ReportsService],
})
export class ReportsModule {}