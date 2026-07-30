import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StockModule } from '../stock/stock.module';
import { BorrowingController } from './borrowing.controller';
import { BorrowingRepository } from './borrowing.repository';
import { BorrowingService } from './borrowing.service';
import { OverdueBorrowJob } from './overdue.job';
import { ProjectsService } from './projects.service';

/**
 * Borrowing owns no stock arithmetic of its own — every reserve, issue, release and return
 * goes through `StockService` (ADR-0001).
 */
@Module({
  imports: [AuditModule, StockModule, NotificationsModule],
  controllers: [BorrowingController],
  providers: [
    BorrowingService,
    BorrowingRepository,
    ProjectsService,
    OverdueBorrowJob,
  ],
  exports: [BorrowingService, BorrowingRepository],
})
export class BorrowingModule {}
