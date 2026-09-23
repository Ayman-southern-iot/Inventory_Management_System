import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { CategoriesModule } from '../categories/categories.module';
import { FilesModule } from '../files/files.module';
import { LocationsModule } from '../locations/locations.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { StockModule } from '../stock/stock.module';
import { ImportApplyService } from './import-apply.service';
import { ImportJobsRepository } from './import-jobs.repository';
import { ImportLockGuard } from './import-lock.guard';
import { ImportLockService } from './import-lock.service';
import { ImportJobsService } from './import-jobs.service';
import { ImportValidationService } from './import-validation.service';
import { ImportsController } from './imports.controller';
import { ProductExportService } from './product-export.service';

/**
 * CSV product import (`importing_data.md`).
 *
 * Part B ships the export alone. The parser, validator, preview, apply, lockout and restore land
 * here too, in that order — one module, because the reader and the writer of a format belong
 * together. Splitting them is how the column list ends up defined twice and drifting once.
 *
 * It composes the modules that already own this data and holds no repository of its own, for the
 * same reason `CatalogueModule` does not: a second definition of "what a product row is" is
 * exactly the drift this feature would otherwise introduce.
 */
@Module({
  imports: [
    ProductsModule,
    CategoriesModule,
    LocationsModule,
    StockModule,
    SettingsModule,
    FilesModule,
    AuditModule,
  ],
  controllers: [ImportsController],
  providers: [
    ProductExportService,
    ImportValidationService,
    ImportJobsRepository,
    ImportJobsService,
    ImportApplyService,
    ImportLockService,
    /*
     * Global, because a lockout that only covered this module's routes would let every other
     * screen keep writing while the catalogue is rewritten underneath them (§8, deny by default).
     *
     * It is a *global* guard, so it runs before any route-level one — including the `RolesGuard`
     * that `@Roles` attaches. A user who lacks the role for a route therefore sees 503 during an
     * import rather than 403, and the ordering spec asserts exactly that rather than inferring
     * it from the allow-listed routes alone.
     */
    { provide: APP_GUARD, useClass: ImportLockGuard },
  ],
  exports: [
    ProductExportService,
    ImportValidationService,
    ImportJobsService,
    ImportApplyService,
    ImportLockService,
  ],
})
export class ImportsModule {}
