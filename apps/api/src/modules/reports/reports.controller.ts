import { Controller, Get, Inject, Query, Res, StreamableFile } from '@nestjs/common';
import {
  Role,
  expenseReportQuerySchema,
  inventoryReportQuerySchema,
  type ExpenseReport,
  type ExpenseReportQuery,
  type InventoryReport,
  type InventoryReportQuery,
} from '@ims/shared';
import type { Response } from 'express';
import { CONFIG, type AppConfig } from '../../config';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { Roles } from '../auth/auth.decorators';
import { PdfRendererService } from '../pdf/pdf-renderer.service';
import { inventoryReportToCsv, inventoryReportToHtml } from './inventory.export';
import { expenseReportToCsv, expenseReportToHtml } from './reports.export';
import { ReportsService } from './reports.service';

/**
 * Organisation-wide spend.
 *
 * `@Roles` excludes General deliberately: an approver needs the shape of the spend they are
 * sanctioning and an IM needs it to plan, but a requester browsing every department's figures is
 * not a use case anyone asked for, and money is the one thing worth being conservative about.
 *
 * The on-screen JSON endpoint and the two export endpoints share the same `ExpenseReportQuery`
 * contract and the same `ReportsService.expenses` query — so the export is mathematically the
 * same report the user is looking at, not a second computation that could drift.
 */
@AuthenticatedThrottle
@Controller('reports')
@Roles(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly pdf: PdfRendererService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('expenses')
  async expenses(
    @Query(zodPipe(expenseReportQuerySchema)) query: ExpenseReportQuery,
  ): Promise<ExpenseReport> {
    return this.reports.expenses(query);
  }

  /** CSV export. `content-disposition: attachment` triggers the browser download prompt. */
  @Get('expenses/export.csv')
  async expensesCsv(
    @Query(zodPipe(expenseReportQuerySchema)) query: ExpenseReportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.expenses(query);
    const body = expenseReportToCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${Date.now()}.csv"`);
    // StreamableFile defers the body to the platform, so memory stays flat regardless of file size.
    return new StreamableFile(Buffer.from(body, 'utf-8'));
  }

  /** PDF export. Landscape A4 (set in the renderer) so the eight money columns fit. */
  @Get('expenses/export.pdf')
  async expensesPdf(
    @Query(zodPipe(expenseReportQuerySchema)) query: ExpenseReportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.expenses(query);
    const html = expenseReportToHtml(report, this.config.reportingTimeZone);
    const pdf = await this.pdf.render(html, 'landscape');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${Date.now()}.pdf"`);
    return new StreamableFile(pdf);
  }

  /* ------------------------------------------------------- inventory (EX-02) */

  /**
   * requirements §10 asks for two exports: the BOM, which shipped in phase 04, and **inventory
   * records**, which never did. It was the only REQUIRED obligation in the document with no
   * implementation, filed by QA under D-024 without its own defect id.
   *
   * Same three-endpoint shape as the expense report above, and for the same reason: the JSON the
   * screen reads and the two files Accounts receives all come from one `ReportsService.inventory`
   * call, so the printed copy cannot drift from what the IM was looking at when they printed it.
   */
  @Get('inventory')
  async inventory(
    @Query(zodPipe(inventoryReportQuerySchema)) query: InventoryReportQuery,
  ): Promise<InventoryReport> {
    return this.reports.inventory(query);
  }

  @Get('inventory/export.csv')
  async inventoryCsv(
    @Query(zodPipe(inventoryReportQuerySchema)) query: InventoryReportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.inventory(query);
    const body = inventoryReportToCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-${Date.now()}.csv"`);
    return new StreamableFile(Buffer.from(body, 'utf-8'));
  }

  /** Portrait, not landscape: five columns fit, and the store room prints on A4 portrait. */
  @Get('inventory/export.pdf')
  async inventoryPdf(
    @Query(zodPipe(inventoryReportQuerySchema)) query: InventoryReportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.inventory(query);
    const html = inventoryReportToHtml(report, this.config.reportingTimeZone);
    const pdf = await this.pdf.render(html, 'portrait');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-${Date.now()}.pdf"`);
    return new StreamableFile(pdf);
  }
}
