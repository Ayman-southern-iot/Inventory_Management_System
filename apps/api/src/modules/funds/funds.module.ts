import { Module, forwardRef } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { FilesModule } from '../files/files.module';
import { StockModule } from '../stock/stock.module';
import { ProductsModule } from '../products/products.module';
import { BorrowingModule } from '../borrowing/borrowing.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RequisitionsModule } from '../requisitions/requisitions.module';
import { FundsController } from './funds.controller';
import { FundsRepository } from './funds.repository';
import { FundsService } from './funds.service';

/**
 * Phase 05 — funds and purchasing. Owns the requisition lifecycle after the BOM exists.
 *
 * Imports `RequisitionsModule` (forward-ref) for the repository's `lockRequisition`, `setStatus`
 * and `appendEvent`, so the status write and the tracker event stay in one place rather than
 * being reimplemented here with subtly different rules. The forwardRef pair exists because
 * `RequisitionsService` also depends on `FundsRepository` for the snapshot writes — a straight
 * circular import would fail at Nest's instantiation step.
 */
@Module({
  imports: [
    forwardRef(() => RequisitionsModule),
    AuditModule,
    NotificationsModule,
    CommonModule,
    FilesModule,
    StockModule,
    ProductsModule,
    BorrowingModule,
  ],
  controllers: [FundsController],
  providers: [FundsService, FundsRepository],
  exports: [FundsService, FundsRepository],
})
export class FundsModule {}
