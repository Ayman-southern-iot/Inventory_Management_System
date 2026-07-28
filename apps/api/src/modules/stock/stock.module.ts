import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockLedgerRepository } from './stock-ledger.repository';
import { StockReconciliationJob } from './stock-reconciliation.job';
import { StockService } from './stock.service';

/**
 * Exports `StockService` and nothing else that can write. There is deliberately no placement
 * repository to import: borrowing, requisitions and BOM must go through the service, because
 * the row locking and the ledger append live inside it (ADR-0001).
 */
@Module({
  controllers: [StockController],
  providers: [StockService, StockLedgerRepository, StockReconciliationJob],
  exports: [StockService, StockReconciliationJob],
})
export class StockModule {}
