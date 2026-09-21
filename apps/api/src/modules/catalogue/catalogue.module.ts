import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { LocationsModule } from '../locations/locations.module';
import { ProductsModule } from '../products/products.module';
import { StockModule } from '../stock/stock.module';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';

/**
 * Composes the four modules that already own this data. It holds no repository of its own —
 * a second definition of "what a product row is" is exactly the drift this endpoint would
 * otherwise introduce.
 */
@Module({
  imports: [ProductsModule, CategoriesModule, LocationsModule, StockModule],
  controllers: [CatalogueController],
  providers: [CatalogueService],
})
export class CatalogueModule {}
