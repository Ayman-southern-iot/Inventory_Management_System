import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { LocationsModule } from '../locations/locations.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { StockModule } from '../stock/stock.module';
import { ImportJobsRepository } from './import-jobs.repository';
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
  imports: [ProductsModule, CategoriesModule, LocationsModule, StockModule, SettingsModule],
  controllers: [ImportsController],
  providers: [
    ProductExportService,
    ImportValidationService,
    ImportJobsRepository,
    ImportJobsService,
  ],
  exports: [ProductExportService, ImportValidationService, ImportJobsService],
})
export class ImportsModule {}
