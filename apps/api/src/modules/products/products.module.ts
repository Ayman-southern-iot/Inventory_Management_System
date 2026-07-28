import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { ProductsController } from './products.controller';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

/**
 * Imports StockModule for read-only placement data on the product card. Writes still go
 * through `StockService` — there is no placement repository to reach around it (ADR-0001).
 */
@Module({
  imports: [StockModule],
  controllers: [ProductsController],
  providers: [ProductsRepository, ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
