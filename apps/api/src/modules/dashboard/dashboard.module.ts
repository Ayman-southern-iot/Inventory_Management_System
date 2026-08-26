import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';

/**
 * Read-only, and dependency-free by design.
 *
 * Every figure is an aggregate over the requisition, borrowing and purchase tables, computed on
 * each request. It imports no other feature module: pulling in RequisitionsModule or FundsModule
 * for their services would drag their write paths — and their forward-ref knots — behind a screen
 * that only counts rows.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
