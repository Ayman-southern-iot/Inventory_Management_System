import { Module } from '@nestjs/common';
import { StockService } from './stock.service';

/**
 * Exports `StockService` and nothing else. There is deliberately no placement repository to
 * import: borrowing, requisitions and BOM must go through the service, because the locking
 * and the ledger append live inside it (ADR-0001).
 */
@Module({
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
