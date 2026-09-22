import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Role, queryBoolean } from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { Roles } from '../auth/auth.decorators';
import { UTF8_BOM } from './import-format';
import { ProductExportService } from './product-export.service';

const exportQuerySchema = z.object({
  /**
   * `queryBoolean`, never `z.coerce.boolean()`: this arrives as query-string text and coercion
   * reads every non-empty string — `"false"` included — as `true`.
   *
   * Defaults to **true**, unlike every other `includeInactive` in the codebase. This file is the
   * desired state of the whole catalogue, and one that silently omitted retired products would
   * look complete while telling the next import to deactivate things it had simply not been shown.
   */
  includeInactive: queryBoolean(true),
});

/**
 * The round-trip CSV (`importing_data.md` part B).
 *
 * Deliberately the first thing built, and useful on its own: it is the file you hand to Claude,
 * the format the importer will read back, and the shape a pre-import snapshot is taken in.
 * Nothing else in the feature can be built honestly until this exists, because everything else
 * is defined in terms of it.
 *
 * IM and Admin only. The file carries the whole catalogue including retired products and
 * internal ids — more than the browse screens show, and not something every signed-in user needs.
 */
@AuthenticatedThrottle
@Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
@Controller('inventory')
export class ImportsController {
  constructor(private readonly exporter: ProductExportService) {}

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(
    @Query(zodPipe(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>,
    @Res() response: Response,
  ): Promise<void> {
    const csv = await this.exporter.toCsv({ includeInactive: query.includeInactive });
    const stamp = new Date().toISOString().slice(0, 10);

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="ims-products-${stamp}.csv"`,
    );
    /*
     * A byte-order mark, because the single most likely reader is Excel on Windows and without
     * one it decodes UTF-8 as the system code page — so a product named "Ø-ring 12mm" opens as
     * mojibake, gets "corrected" by hand, and comes back as a rename. The parser strips it.
     */
    response.send(`${UTF8_BOM}${csv}`);
  }
}
